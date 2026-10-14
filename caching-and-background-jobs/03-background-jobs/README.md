# Part 3 — Background Jobs

A user clicks "Send invoice". Your handler renders a PDF, charges a card, sends
an email, writes an audit log — and they watch a spinner for nine seconds. Then
the provider is slow, the request times out, they click again, and the card is
charged twice.

This part moves that work out of the request without losing it. The concepts —
queue versus pub/sub, delivery guarantees, which broker — already live in
[system-design/](../../system-design/foundational/message-queues/). This is the
implementation layer: a producer that cannot enqueue a job for a rolled-back
row, a worker that survives a deploy, and a queue you can tell is healthy.

> **📌 The whole part in one line:** return after the durable write, run the
> rest in a worker that retries safely, and assume every job runs twice.

## Files

1. [Why Background Jobs](01-why-background-jobs.md) — the decision rule for
   what moves out, what async costs you, the enqueue-in-a-transaction bug.
2. [Anatomy of a Job System — Part 1](02-anatomy-of-a-job-system-part-1.md) —
   the four pieces, the job lifecycle, and why a payload holds an id.
3. [Part 2](02-anatomy-of-a-job-system-part-2.md) — typed job payloads,
   at-least-once delivery, splitting queues, choosing a library.
4. [Writing Reliable Workers — Part 1](03-writing-reliable-workers-part-1.md) —
   the worker process, logging with job and request ids, sizing concurrency.
5. [Part 2](03-writing-reliable-workers-part-2.md) — graceful shutdown,
   timeouts, stalled jobs, error classification, health without a port.
6. [Retries, Backoff and Dead Letter — Part 1](04-retries-backoff-and-dead-letter-part-1.md)
   — backoff with jitter, attempt counts, what never to retry.
7. [Part 2](04-retries-backoff-and-dead-letter-part-2.md) — dead-letter queues,
   replay, poison messages, and alerts worth paging for.
8. [Idempotent Jobs — Part 1](05-idempotent-jobs-part-1.md) — why duplicates
   happen, unique constraints, the idempotency key table.
9. [Part 2](05-idempotent-jobs-part-2.md) — conditional updates, side effects
   you cannot take back, ordering, testing.
10. [Scheduled and Recurring Jobs — Part 1](06-scheduled-and-recurring-jobs-part-1.md)
    — delayed versus recurring, cron, three instances running it three times.
11. [Part 2](06-scheduled-and-recurring-jobs-part-2.md) — DST, missed runs,
    batching with a cursor, overlap, and the job that silently stopped.
12. [Operating Queues — Part 1](07-operating-queues-part-1.md) — the metrics,
    the stuck-queue runbook, the shared-Redis eviction trap.
13. [Part 2](07-operating-queues-part-2.md) — backlog recovery, deploys,
    version skew, capacity, manual intervention.

## Read in this order

Read 1 → 13 in order, one file per sitting. Files 1–3 set up the vocabulary.
Files 6–9 are one idea: retries are why duplicates happen, and idempotency is
what makes retries safe. Files 12–13 are operational — read them before your
first incident, not during it.

## What you should be able to do after this part

- Decide whether work belongs in the request or in a worker, and defend it.
- Write a producer that cannot enqueue a job for a row that was rolled back.
- Write a worker that finishes its in-flight jobs when the pod is terminated.
- Justify a retry policy, and say where a job goes when it runs out of attempts.
- Make any handler safe to run twice, and write the test that proves it.
- Say whether a queue is healthy from the age of its oldest waiting job.

## Where this connects

- **Concepts, not repeated:** [message-queues](../../system-design/foundational/message-queues/overview.md),
  [idempotency](../../system-design/reliability/idempotency.md),
  [circuit-breakers-and-retries](../../system-design/reliability/circuit-breakers-and-retries.md).
- **Redis mechanics** behind delayed jobs, locks, eviction:
  [02-redis-in-practice/](../02-redis-in-practice/).
- **Where a handler sits:** [service layer](../../backend-fundamentals/09-application-architecture/02-service-layer-part-1.md).
- **Errors, logs, and metrics:**
  [07-error-handling/](../../backend-fundamentals/07-error-handling/) and
  [08-logging-and-observability/](../../backend-fundamentals/08-logging-and-observability/).
- **Transactions, locks, pooling:**
  [transactions-and-concurrency/](../../databases/transactions-and-concurrency/)
  and [operations/](../../databases/operations/).

## Next

Part 4 — [Putting It Together](../04-putting-it-together/) builds the full
API → database → Redis → queue → worker system described here.
