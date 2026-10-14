# Caching & Background Jobs

Weeks 9–10 of [doc/career-roadmap.md](../doc/career-roadmap.md), expanded into a
full learning track.

This is the block where a backend stops being "a web server in front of a
database". Two things change:

- **Not every read needs to hit the database.** That is caching.
- **Not every piece of work needs to happen while the user waits.** That is
  background processing.

Both sound simple and both have a reputation for being where subtle bugs live —
stale data nobody can explain, an email sent four times, a queue that silently
stopped ten hours ago. This track is about doing them deliberately.

The roadmap's build target for this block is one system:

```text
   Client
     │
     ▼
   API ──────► Redis        (is the answer already here?)
     │           ▲
     ▼           │
  Database ──────┘          (miss → read, then populate)
     │
     ▼
   Queue ────► Worker       (slow work, after the response)
```

## Roadmap

| # | Folder | What it answers |
|---|---|---|
| 1 | [caching-in-practice/](01-caching-in-practice/) | What to cache, how to invalidate it, and how it fails |
| 2 | [redis-in-practice/](02-redis-in-practice/) | Using Redis properly from Node, beyond `get` and `set` |
| 3 | [background-jobs/](03-background-jobs/) | Queues, workers, retries, and operating them |
| 4 | [putting-it-together/](04-putting-it-together/) | The full API → DB → Redis → Queue → Worker build |

## How this relates to `system-design/`

The **concepts** already exist in this repo as reference notes, and this track
does not repeat them:

- [caching-strategies.md](../system-design/foundational/caching-strategies.md) —
  cache-aside, write-through, write-behind, read-through, eviction, stampede
- [redis.md](../system-design/foundational/redis.md) — data structures, TTL,
  persistence, pub/sub, cluster mode
- [message-queues/](../system-design/foundational/message-queues/) — queue vs
  pub/sub, delivery guarantees, RabbitMQ / Kafka / SQS
- [idempotency.md](../system-design/reliability/idempotency.md) and
  [circuit-breakers-and-retries.md](../system-design/reliability/circuit-breakers-and-retries.md)

Those answer **"what is this pattern and when would you choose it?"**

This track answers **"how do I actually build it in my Node app, and what
breaks at 3 AM?"** — the same split as
[backend-fundamentals/](../backend-fundamentals/) versus
[databases/](../databases/).

## Status

- [x] 01 — Caching in practice — 8 files
- [x] 02 — Redis in practice — 11 files
- [x] 03 — Background jobs — 14 files
- [x] 04 — Putting it together — 5 files

Longer topics are split into `-part-1` / `-part-2` files so no single file runs
past ~500 lines. Each part stands on its own: its own contents, common
mistakes, and self-test questions, with links between the parts.

## How to use this

1. **One file per sitting.** See the daily routine in the
   [roadmap](../doc/career-roadmap.md).
2. **Close the file and answer its "Questions to Test Yourself" from memory.**
3. **Find the equivalent in your real project.** Your SaaS almost certainly has
   something that should be cached and something that should not be happening
   inside the request.
4. Do folder 4 last, and actually build it.

## What you should be able to do after this track

- Decide whether a given endpoint should be cached, and defend the answer.
- Write a cache-aside read path that stays correct when the data changes.
- Explain what happens to your API the moment Redis goes down — and make that
  answer "it gets slower", not "it breaks".
- Move work out of the request and into a worker without losing it.
- Make a job safe to run twice, because eventually it will be.
- Tell whether a queue is healthy by looking at it.
