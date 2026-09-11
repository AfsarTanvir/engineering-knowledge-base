# Circuit Breakers & Retries with Backoff

When a downstream service is slow or failing, the instinct is to retry —
but a naive retry loop across many callers can turn a struggling service
into a dead one, and a caller that keeps calling a dead service wastes its
own resources waiting on a response that will never come. Retries and
circuit breakers are two halves of handling this correctly: retries
recover from transient blips, circuit breakers stop hammering something
that's genuinely down.

## Table of Contents

1. [Retries: The Basic Idea](#retries-the-basic-idea)
2. [Exponential Backoff](#exponential-backoff)
3. [Jitter: Avoiding Retry Storms](#jitter-avoiding-retry-storms)
4. [What NOT to Retry](#what-not-to-retry)
5. [Circuit Breakers: The Basic Idea](#circuit-breakers-the-basic-idea)
6. [The Three States](#the-three-states)
7. [Implementation](#implementation)
8. [Circuit Breakers + Retries Together](#circuit-breakers--retries-together)
9. [Quick Reference](#quick-reference)

---

## Retries: The Basic Idea

Some failures are transient — a dropped packet, a momentary GC pause on
the other end, a load balancer routing to an instance that just restarted.
Retrying the exact same request a moment later often just works:

```python
def call_with_retry(fn, max_attempts=3):
    for attempt in range(max_attempts):
        try:
            return fn()
        except TransientError:
            if attempt == max_attempts - 1:
                raise
            time.sleep(1)  # naive fixed delay — see backoff below
```

A fixed 1-second delay is a starting point, not the answer — it doesn't
adapt to how overloaded the downstream service actually is.

## Exponential Backoff

Instead of retrying at a fixed interval, double the wait time after each
failure. This gives a struggling service increasing breathing room instead
of the same pressure repeated on a clock:

```python
def call_with_backoff(fn, max_attempts=5, base_delay=1, max_delay=30):
    for attempt in range(max_attempts):
        try:
            return fn()
        except TransientError:
            if attempt == max_attempts - 1:
                raise
            delay = min(base_delay * (2 ** attempt), max_delay)
            time.sleep(delay)
```

```
Attempt 1 fails -> wait 1s
Attempt 2 fails -> wait 2s
Attempt 3 fails -> wait 4s
Attempt 4 fails -> wait 8s
Attempt 5 fails -> wait 16s (capped at max_delay)
```

`max_delay` caps how long a single retry sequence can stretch out — without
it, a long enough attempt count makes the wait absurd (and the caller
irrelevant to whoever's still waiting on the original request).

## Jitter: Avoiding Retry Storms

Plain exponential backoff has its own failure mode: if a service goes
down and 10,000 clients all started retrying at the same moment, they all
retry again at exactly 2s, then exactly 4s, then exactly 8s — synchronized
waves of load hitting the recovering service right as it comes back.

**Jitter** adds randomness to the delay so retries spread out instead of
arriving in lockstep:

```python
def call_with_jittered_backoff(fn, max_attempts=5, base_delay=1, max_delay=30):
    for attempt in range(max_attempts):
        try:
            return fn()
        except TransientError:
            if attempt == max_attempts - 1:
                raise
            capped = min(base_delay * (2 ** attempt), max_delay)
            delay = random.uniform(0, capped)  # "full jitter"
            time.sleep(delay)
```

**Full jitter** (random between 0 and the capped delay, shown above) is
the most effective at spreading load; **equal jitter** (half fixed, half
random) is a gentler middle ground when you still want some predictability
in retry timing.

## What NOT to Retry

Retrying only helps for failures that might succeed on a second attempt.
Blindly retrying everything wastes time and can cause harm:

- **4xx client errors** (bad request, unauthorized, not found) — the
  request itself is wrong; retrying an identical malformed request fails
  identically every time.
- **Non-idempotent writes without an idempotency key** — retrying a
  "charge $50" request that actually succeeded but timed out on the
  response can charge the customer twice. See
  [idempotency.md](idempotency.md) before retrying any write.
- **Already-exhausted resources** — retrying immediately into a service
  returning 429 (rate limited) or 503 (overloaded) just adds to the load
  that caused the problem; respect `Retry-After` if provided.

Retry `5xx` server errors and network-level failures (timeouts, connection
resets) — these are the transient category retries are built for.

---

## Circuit Breakers: The Basic Idea

Retries assume the failure is temporary. A circuit breaker is what
protects the caller once it becomes clear the failure isn't temporary —
after enough failures, it "opens" and stops trying entirely for a while,
failing fast instead of piling up slow, doomed requests.

This matters for two reasons: it stops wasting the caller's own resources
(threads, connections) waiting on a dead service, and it stops adding
retry load onto a service that's already struggling.

## The Three States

```
CLOSED --(failure threshold exceeded)--> OPEN
  ^                                         |
  |                                (timeout elapses)
  |                                         v
  +----(test request succeeds)---- HALF_OPEN --(test request fails)--> OPEN
```

- **Closed** — normal operation; requests pass through, failures are
  counted
- **Open** — too many recent failures; requests fail immediately without
  even attempting the call, for a cooldown period
- **Half-open** — after the cooldown, let a single trial request through;
  success closes the circuit again, failure re-opens it

## Implementation

```python
import time

class CircuitBreaker:
    def __init__(self, failure_threshold=5, recovery_timeout=30):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failure_count = 0
        self.state = "CLOSED"
        self.opened_at = None

    def call(self, fn):
        if self.state == "OPEN":
            if time.time() - self.opened_at > self.recovery_timeout:
                self.state = "HALF_OPEN"
            else:
                raise CircuitOpenError("Circuit is open, failing fast")

        try:
            result = fn()
        except Exception:
            self.failure_count += 1
            if self.failure_count >= self.failure_threshold:
                self.state = "OPEN"
                self.opened_at = time.time()
            raise
        else:
            self.failure_count = 0
            self.state = "CLOSED"
            return result

breaker = CircuitBreaker(failure_threshold=5, recovery_timeout=30)
result = breaker.call(lambda: call_downstream_service())
```

Production libraries (`resilience4j` for Java, `pybreaker` for Python,
`opossum` for Node) add refinements worth using over a hand-rolled
version: counting failures as a rolling percentage over a time window
rather than a raw consecutive count, and emitting metrics/events on state
transitions for monitoring.

---

## Circuit Breakers + Retries Together

These compose — retries handle a single request's transient hiccup;
the circuit breaker sits above that, deciding whether it's even worth
attempting (with retries) right now:

```python
def resilient_call(fn):
    return breaker.call(lambda: call_with_jittered_backoff(fn))
```

**Order matters:** retry *inside* the circuit breaker's call, not outside
it — otherwise each of your retry attempts independently counts toward
tripping the breaker in a confusing way, and a caller retrying against an
already-open circuit just fails fast repeatedly instead of backing off
meaningfully.

---

## Quick Reference

| Situation                                          | Response                                          |
| :------------------------------------------------------ | :------------------------------------------------------ |
| A single request fails with a network blip               | Retry with exponential backoff + jitter                    |
| Request fails with a 4xx client error                     | Don't retry — fix the request                              |
| Downstream service has failed repeatedly, recently        | Circuit breaker opens — fail fast, stop adding load          |
| Downstream service failed but might have recovered        | Circuit breaker's half-open state — send one trial request    |
| Retrying a write (charge, create-order, etc.)             | Use an idempotency key first — see [idempotency.md](idempotency.md) |

**Bottom line:** retries with backoff and jitter handle the failures that
fix themselves in seconds; circuit breakers handle the failures that
don't, by giving up temporarily instead of piling on. Use both together,
and never retry a write you haven't made idempotent.
