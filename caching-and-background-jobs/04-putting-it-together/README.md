# Part 4 — Putting It Together

A company dashboard takes 800 milliseconds and everyone opens it on login.
Sending an invoice takes nine seconds, calls a third party, and occasionally
emails the customer twice. You now know enough to fix both. This part is where
you do it, on one feature, end to end.

**This is a build, not a reading exercise.** Folders 01, 02 and 03 are
prerequisites, not suggestions — nothing here is explained a second time. Every
concept gets one or two sentences and a link back to the file that already
taught it. If a link is the only thing on the page that answers your question,
go and read it; that is the design.

> **📌 The whole part in one line:** take the three previous folders, apply
> them to one real feature in the right order, then deliberately break it until
> you know which parts were real.

## Files

1. [The Feature and the Plan](./01-the-feature-and-the-plan.md) — design the
   dashboard endpoint and the invoice-send endpoint fully before any code:
   measure what they cost, ask whether caching is even the right answer (two of
   the four queries were index problems), set a staleness budget per field,
   draw the request boundary, and produce the architecture diagram, the cache
   key table and the job table.
2. [Building It — Part 1](./02-building-it-part-1.md) — the indexes, a correct
   service layer with no cache and no queue, the two Redis clients, cache-aside
   on the dashboard read, invalidation placed after commit, and the producer
   that enqueues after the transaction with an id as its payload.
3. [Building It — Part 2](./02-building-it-part-2.md) — the worker process,
   concurrency sized against the database pool, graceful shutdown, idempotency
   with a claim row plus the provider's key, retries with jitter and a
   dead-letter destination, the completion path, the metrics to add while
   building, and a `docker-compose` stack with two Redis instances.
4. [Breaking It on Purpose](./03-breaking-it-on-purpose.md) — nine failure
   drills against what you just built: kill Redis, expire a hot key, `SIGKILL`
   a worker mid-job, stop the consumer, fail the email provider, poison the
   queue, share one Redis and fill it, and run a schedule on two instances.

## Read in this order

Strictly 1 → 4, and do not skip ahead to the code. File 01 is the one that
changes how you work, because it is the only place where the answer to "should
I cache this?" turns out to be "no, add three indexes".

```text
  01 design        →  02 build          →  03 break
     on paper,         in the order you     until you know
     with tables       would really write   which claims were real
```

File 04 is not optional homework. A system you have never broken is a system
whose failure behaviour is a guess.

## What you should be able to do after this part

- Decide what to cache by measuring first, and reject caching when an index is
  the real answer.
- Write down a staleness budget per field, and let it choose the TTL.
- Draw the line between what stays in the request and what leaves, and defend
  every item on both sides.
- Build the full path — cache-aside, invalidation after commit, enqueue after
  commit, idempotent worker, retries, dead letter — without re-reading the
  earlier folders.
- Run a failure drill against your own project and say honestly which of the
  nine it would currently fail.

## Where this connects

- **The three folders this one assembles** —
  [01-caching-in-practice/](../01-caching-in-practice/),
  [02-redis-in-practice/](../02-redis-in-practice/),
  [03-background-jobs/](../03-background-jobs/).
- **The fix that usually makes caching unnecessary** —
  [slow-query-fixes.md](../../databases/query-optimization/slow-query-fixes.md).
- **Where the logic lives** —
  [the service layer](../../backend-fundamentals/09-application-architecture/02-service-layer-part-1.md).
- **The signals that make the drills visible** —
  [08-logging-and-observability/](../../backend-fundamentals/08-logging-and-observability/).
- **Running the stack** — [docker/overview.md](../../cloud-devops/docker/overview.md).
