# Part 7 — Error Handling

Most of your code describes the happy path: the user is logged in, the record
exists, the database answers, the payment provider replies in 80ms. That is the
easy half. This part is about the other half. A request arrives with a missing
field. A row is gone. Postgres drops the connection during a failover. Stripe
times out. And once, at 3 AM, your own code throws `Cannot read properties of
undefined`.

Error handling is not "adding try/catch until the red text stops". It is a
design decision made three times: **what kind of failure is this**, **where do
I deal with it**, **what do I tell the caller**. Those are the three files
below.

> **📌 The whole part in one line:** classify the failure, funnel every failure
> into one handler, and return a response that helps the client without leaking
> your internals.

## Where the language-level foundation lives

This part covers the **backend and HTTP side** of errors. The
**JavaScript/TypeScript language side** is already written, and this part does
not repeat it:

- [error-handling.md](../../typescript-fundamentals/error-handling/error-handling.md)
  — `try`/`catch`/`finally`, `throw`, custom `Error` subclasses, why `catch (e)`
  gives you `unknown`, and async gotchas.
- [advanced.md](../../typescript-fundamentals/error-handling/advanced.md) —
  `Error.cause` chaining, retries with exponential backoff, the circuit breaker
  pattern, and global `unhandledRejection` / `uncaughtException` handlers.

Read those first if `throw`, `catch`, and custom `Error` classes are not yet
comfortable. Everything here assumes them.

## Files

1. [Error Taxonomy](01-error-taxonomy.md) — operational errors vs programmer
   errors, a classification table for a real backend, and a full `AppError`
   hierarchy with stable codes, HTTP statuses, and an `isOperational` flag.
2. [Centralized Error Handling](02-centralized-error-handling-part-1.md) — one handler
   at the edge of the app that every error funnels into, the async-route trap,
   `res.headersSent`, process-level last-resort handlers, timeouts, transaction
   rollback, and testing the error path.
3. [Client-Facing Error Responses](03-client-facing-error-responses-part-1.md) — the
   three audiences of an error, what must never leak, `request_id` as the
   bridge to your logs, helpful messages, `Retry-After`, and partial failures
   in bulk endpoints.

## Read in this order

Read 1 → 2 → 3, one file per sitting. The order is not interchangeable: file 2
builds a handler that switches on the error classes defined in file 1, and file
3 formats the response that file 2's handler sends.

## What you should be able to do after this part

- Look at any failure and say whether it is an operational error or a bug, and
  justify the answer.
- Design an error class hierarchy with codes that stay stable even when you
  rewrite the internals, and explain why a service throws `ConflictError` and
  never `409`.
- Point at the one place where every error becomes a response, and add a new
  error type to it in under five minutes.
- Spot an async route handler whose rejection never reaches the error handler.
- Read an error response and say which parts are safe for a public client.
- Decide whether a failed dependency should fail the request or be degraded
  silently, and say why.

## Where this connects

- The *shape* of the error body is designed in Part 2 —
  [Error Response Design](../02-rest-api-design/05-error-response-design.md);
  this part is about producing it correctly. Field-level validation errors come
  from Part 4 — [Validation & Input Handling](../04-validation-and-input/).
- The `request_id` that ties an error to a log line is Part 8 —
  [Logging & Observability](../08-logging-and-observability/); which layer
  throws what is Part 9 —
  [Application Architecture](../09-application-architecture/).
- Retry and circuit breaker policy at the system level lives in
  [circuit-breakers-and-retries](../../system-design/reliability/circuit-breakers-and-retries.md).

## Next

Part 8 — [Logging & Observability](../08-logging-and-observability/) picks up
where file 3 stops: the client has a `request_id`, so now make sure the log
line it points to exists.
