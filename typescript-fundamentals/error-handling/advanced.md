# Error Handling — Advanced

The basics cover try/catch, custom error classes, catching at the right layer, and centralized error middleware. This file covers what happens once your system is distributed and long-running: preserving the *original* cause of a wrapped error, recovering automatically from transient failures without hammering a dead dependency, stopping cascading failures across services, and making sure a truly uncaught error doesn't take your whole process down silently. See [error-handling.md](./error-handling.md) for the basics this builds on.

## Table of Contents

1. [Error Cause Chaining with `Error.cause`](#error-cause-chaining-with-errorcause)
2. [Retry Strategies with Exponential Backoff](#retry-strategies-with-exponential-backoff)
3. [The Circuit Breaker Pattern](#the-circuit-breaker-pattern)
4. [Distributed Tracing of Errors Across Services](#distributed-tracing-of-errors-across-services)
5. [Global Handlers for Unhandled Rejections and Uncaught Exceptions](#global-handlers-for-unhandled-rejections-and-uncaught-exceptions)
6. [Why It Matters](#why-it-matters)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)

---

## Error Cause Chaining with `Error.cause`

When you catch a low-level error and throw a more meaningful one, it's tempting to discard the original — but that original stack trace/message is often the only clue to what *actually* went wrong. `Error.cause` (standard since ES2022) preserves it.

```ts
async function loadUserProfile(userId: string) {
  try {
    return await db.query("SELECT * FROM profiles WHERE user_id = ?", [userId]);
  } catch (err) {
    // BROKEN (loses the original error) — the caller only sees "Failed to load profile"
    // throw new Error("Failed to load profile");

    // FIXED — wrap it, but keep the original as `cause`
    throw new Error("Failed to load profile", { cause: err });
  }
}

try {
  await loadUserProfile("123");
} catch (err) {
  console.error(err.message); // "Failed to load profile" — the high-level, user-facing meaning
  console.error(err.cause);   // the ORIGINAL db error — connection timeout, syntax error, etc.
}
```

This chains naturally through multiple layers, and `console.error` on a modern runtime prints the full chain (`... caused by: ...`), which is exactly what you want in logs.

```ts
class ServiceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ServiceError";
  }
}

async function handleCheckout(orderId: string) {
  try {
    await chargeCard(orderId);
  } catch (err) {
    throw new ServiceError(`Checkout failed for order ${orderId}`, { cause: err });
  }
}
// logs show: ServiceError: Checkout failed for order 123
//              [cause]: Error: card declined (insufficient funds)
// — you get BOTH the business-level meaning AND the root cause, without picking one
```

Without `cause`, teams historically resorted to concatenating messages (`"Checkout failed: " + err.message`), which loses the original stack trace entirely and makes root-causing production incidents much harder.

## Retry Strategies with Exponential Backoff

Many failures (network blips, a database briefly overloaded, a third-party API rate limit) are transient — retrying often succeeds. Retrying immediately and repeatedly, however, can make things worse by hammering an already-struggling dependency. Exponential backoff spaces retries out, and jitter avoids many clients retrying in lockstep.

```ts
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  { maxAttempts = 5, baseDelayMs = 200 }: { maxAttempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break; // out of attempts, give up

      const exponentialDelay = baseDelayMs * 2 ** (attempt - 1); // 200, 400, 800, 1600...
      const jitter = Math.random() * exponentialDelay * 0.5;     // avoid synchronized retries
      const delay = exponentialDelay + jitter;

      console.warn(`Attempt ${attempt} failed, retrying in ${Math.round(delay)}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error(`All ${maxAttempts} attempts failed`, { cause: lastError });
}

const data = await retryWithBackoff(() => fetchFromFlakyApi(), { maxAttempts: 4 });
```

Not every error is worth retrying — retrying a `400 Bad Request` or a validation error just wastes time and resources, since the input is wrong, not the network. Retry logic should distinguish:

```ts
function isRetryable(err: any): boolean {
  // network errors, timeouts, and 5xx/429 responses are usually worth retrying
  // 4xx (except 429) usually means "your request is wrong" — retrying won't help
  if (err.code === "ECONNRESET" || err.code === "ETIMEDOUT") return true;
  if (err.status === 429 || (err.status >= 500 && err.status < 600)) return true;
  return false;
}

async function retryIfRetryable<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isRetryable(err)) throw err; // fail fast on non-transient errors
    return retryWithBackoff(fn);
  }
}
```

## The Circuit Breaker Pattern

Retrying helps with occasional blips, but if a downstream service is genuinely *down*, every request that hits it (retries included) just wastes time and resources while waiting to time out — and can even prevent that service from recovering by continuously bombarding it with traffic. A circuit breaker tracks recent failures and, once a threshold is crossed, "opens" and fails fast without even attempting the call, giving the downstream service room to recover.

```ts
class CircuitBreaker {
  private failureCount = 0;
  private state: "closed" | "open" | "half-open" = "closed";
  private nextAttemptTime = 0;

  constructor(
    private readonly failureThreshold = 5,
    private readonly resetTimeoutMs = 30_000
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() < this.nextAttemptTime) {
        throw new Error("Circuit breaker is OPEN — failing fast without calling downstream");
      }
      this.state = "half-open"; // give it one trial call to see if the dependency recovered
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    this.state = "closed"; // fully healthy again
  }

  private onFailure() {
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) {
      this.state = "open"; // stop trying, downstream is unhealthy
      this.nextAttemptTime = Date.now() + this.resetTimeoutMs;
    }
  }
}

const paymentServiceBreaker = new CircuitBreaker(5, 30_000);

async function chargeCustomer(orderId: string) {
  return paymentServiceBreaker.execute(() => callPaymentApi(orderId));
}
// after 5 failures, further calls fail INSTANTLY for 30s instead of each
// waiting for (and adding to) a slow/timed-out call to a struggling service
```

States, plainly:

```text
closed     → normal operation, calls go through, failures are counted
open       → too many recent failures; fail immediately without calling downstream at all
half-open  → after a cooldown, allow ONE trial call through to test if it recovered
```

This is exactly the pattern behind libraries like `opossum` (Node) or Netflix's Hystrix — and it's what prevents one slow/down dependency from cascading into a full outage of every service that depends on it (a "thundering herd" all waiting on the same dead service).

## Distributed Tracing of Errors Across Services

In a single process, a stack trace tells you the whole story. Across microservices, an error in `payments-service` might be *caused* by a failure three hops away in `inventory-service` — and without a shared identifier, you're grepping through unrelated logs across multiple systems trying to correlate timestamps.

The standard fix is a **trace ID** (sometimes called a correlation ID) generated at the edge (the first service to receive the request) and propagated through every downstream call, usually via an HTTP header, so every log line and every error across every service can be tied back to one originating request.

```ts
// generated once, at the entry point (e.g., API gateway or first service)
import { randomUUID } from "crypto";

function withTraceId(req: Request, res: Response, next: NextFunction) {
  const traceId = (req.headers["x-trace-id"] as string) ?? randomUUID();
  (req as any).traceId = traceId;
  res.setHeader("x-trace-id", traceId);
  next();
}

// propagated to every downstream call this request makes
async function callInventoryService(traceId: string, sku: string) {
  return fetch(`https://inventory-service/stock/${sku}`, {
    headers: { "x-trace-id": traceId }, // downstream service picks this up and logs with it too
  });
}

// every log line and thrown error includes it
class TracedError extends Error {
  constructor(message: string, public traceId: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TracedError";
  }
}

async function processOrder(req: Request) {
  const traceId = (req as any).traceId;
  try {
    await callInventoryService(traceId, "SKU-123");
  } catch (err) {
    console.error(`[trace:${traceId}] inventory check failed`);
    throw new TracedError("Order processing failed", traceId, { cause: err });
  }
}
```

In practice teams use OpenTelemetry (or a vendor APM like Datadog/Honeycomb) rather than hand-rolled header propagation — but the underlying idea is the same conceptual sketch above: one ID, generated once, threaded through every hop, attached to every log line and every thrown error, so an on-call engineer can pull up "everything that happened for request X" across every service instead of correlating timestamps by hand across a dozen log streams.

## Global Handlers for Unhandled Rejections and Uncaught Exceptions

Even with careful try/catch everywhere, something will eventually slip through — a promise rejection nobody `.catch()`ed, a genuinely unexpected thrown error outside any try block. Node lets you attach last-resort global handlers, but they're a safety net for logging and graceful shutdown, **not** a substitute for real error handling.

```ts
process.on("unhandledRejection", (reason, promise) => {
  // a promise rejected and NOTHING caught it anywhere in the call chain
  console.error("Unhandled Rejection:", reason);
  // log it to your error tracking service (Sentry, Datadog, etc.) — this is a real bug to fix
});

process.on("uncaughtException", (err) => {
  // a synchronous error was thrown and nothing caught it — the process is now in an
  // UNKNOWN, potentially corrupted state (a half-finished operation, a partially open resource)
  console.error("Uncaught Exception:", err);
  // best practice: log it, then EXIT — do not try to keep running in an unknown state
  process.exit(1);
});
```

The critical nuance: `uncaughtException` should almost always be followed by a controlled `process.exit`, not by "swallowing" the error and continuing. The Node docs explicitly warn against resuming normal operation after one, because the process may be in an inconsistent state (a lock not released, a partially written file, a half-updated in-memory cache) — trying to "handle" it and continue can cause worse, harder-to-debug corruption later. The correct pattern in production is: log the error (with the trace ID above, if available), alert, gracefully close existing connections, and let a process manager (PM2, Kubernetes, systemd) restart the process cleanly.

```ts
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception, shutting down");
  server.close(() => process.exit(1)); // stop accepting new requests, finish in-flight ones, then exit
  setTimeout(() => process.exit(1), 5000).unref(); // force-exit if close() hangs
});
```

## Why It Matters

Discarding the original error when wrapping it (`throw new Error("failed")` instead of using `cause`) turns every production incident into forensic archaeology — you know *that* something failed but not *why*. Retrying blindly (no backoff, no distinguishing retryable from non-retryable errors) can turn a brief blip into a self-inflicted denial-of-service against your own dependency. Skipping a circuit breaker means one slow dependency's failures cascade and pile up across every service that calls it. And treating global unhandled-rejection/uncaught-exception handlers as optional means a single slipped-through error can either crash your process with zero diagnostic trail, or — worse — leave it silently running in a corrupted state.

## Common Mistakes

- Wrapping an error with a new message and losing the original (`throw new Error("x failed")` instead of `{ cause: err }`), destroying the actual root cause for whoever debugs it later.
- Retrying every error the same way, including non-transient ones (bad input, auth failures) that will never succeed no matter how many times you retry.
- Retrying immediately in a tight loop with no backoff, amplifying load on an already-struggling dependency.
- Having no circuit breaker, so one slow/down dependency causes every caller to pile up waiting on timeouts, cascading the outage.
- Treating `process.on("uncaughtException", ...)` as a way to "catch and continue" instead of "log and shut down cleanly" — continuing after an uncaught exception risks running in a corrupted state.
- No trace/correlation ID propagated across service calls, making cross-service incidents far harder to debug than they need to be.

## Questions to Test Yourself

1. Why is `throw new Error("Failed to load profile", { cause: err })` better for debugging than `throw new Error("Failed to load profile")`?
2. Why shouldn't a retry strategy treat every error the same way — what's the difference between a retryable and a non-retryable failure?
3. What problem does a circuit breaker solve that retries with backoff do not?
4. Why does the Node documentation recommend exiting the process after an `uncaughtException` instead of just logging it and continuing?
5. What does a trace/correlation ID actually solve in a multi-service system, and what would debugging look like without one?
