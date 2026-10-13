# Part 2 — Redis in Practice

A seat counter goes to `-1`. A nightly invoice job silently stops running for
three weeks. A customer's export never arrives and nothing in any log mentions
it. Requests start timing out at 3 AM, and the database is perfectly healthy.

Every one of those is a real Redis failure, and none of them is caused by not
knowing what `GET` does. They come from four things nobody tells you when you
add Redis to a project: it runs one command at a time, your operation is
usually more than one command, memory is a hard limit with a policy attached,
and a lock that expires is not a lock.

This part is the implementation layer. The concepts — data structures, TTL,
persistence, pub/sub, cluster mode — already exist as reference notes in
[../../system-design/foundational/redis.md](../../system-design/foundational/redis.md),
and this folder does not repeat them. This folder is about using Redis
correctly from a Node and TypeScript application, and operating it afterwards.

> **📌 The whole part in one line:** Redis is a single-threaded, in-memory
> server, so keep every command small, make every multi-step operation atomic,
> and never let one instance hold both your cache and your jobs.

## Files

1. **Connecting to Redis** —
   [Part 1](./01-connecting-to-redis-part-1.md): what Redis actually is, why
   one thread changes everything, choosing a client, one shared connection, and
   a client that survives Redis going down. ·
   [Part 2](./01-connecting-to-redis-part-2.md): round trips and pipelining,
   the commands that are dangerous in production, `KEYS` to `SCAN`, key
   namespacing, and what to watch.
2. **Choosing Data Structures** —
   [Part 1](./02-choosing-data-structures-part-1.md): strings, hashes, lists,
   sets, sorted sets and HyperLogLog, each with a real use case, plus the
   decision table. ·
   [Part 2](./02-choosing-data-structures-part-2.md): what a million keys
   really costs, why TTL never applies to one hash field, the lost-update race
   on counters, and a sliding-window rate limiter in full.
3. **Atomicity and Lua** —
   [Part 1](./03-atomicity-and-lua-part-1.md): the check-then-set race,
   what `MULTI`/`EXEC` does and does not guarantee, and `WATCH` with its retry
   loop. ·
   [Part 2](./03-atomicity-and-lua-part-2.md): Lua scripts as one atomic
   command, `KEYS` versus `ARGV`, `EVALSHA`, and the atomic patterns worth
   memorising.
4. **Distributed Locks** —
   [Part 1](./04-distributed-locks-part-1.md): why you usually do not need
   one, acquiring with `SET NX PX`, and the compare-and-delete release that is
   the most important code in this folder. ·
   [Part 2](./04-distributed-locks-part-2.md): Redlock and the honest argument
   about it, fencing tokens, a reusable `withLock()` helper, and the traps.
5. **Memory and Operations** —
   [Part 1](./05-memory-and-operations-part-1.md): measuring memory, every
   eviction policy, why a cache and a queue cannot share an instance, and keys
   without a TTL. ·
   [Part 2](./05-memory-and-operations-part-2.md): persistence as an operator
   decision, cold caches and failover, monitoring, security, and Docker.

## Read in this order

Strictly 1 → 5, and each file's Part 1 before its Part 2. File 1 establishes
the single-threaded fact that every later file depends on. Files 3 and 4 are a
pair: the lock in file 4 is built out of the Lua patterns in file 3.

```text
01 connection      →  02 structures   →  03 atomicity  →  04 locks  →  05 operations
   one thread,         the right shape    one command      one winner   memory decides
   one client          per problem        per operation                 everything
```

## What you should be able to do after this part

- Explain why one slow Redis command is an outage rather than a slow request.
- Replace a loop of `await redis.get()` with a pipeline, and say what that
  actually saved.
- Pick the right data structure for a counter, a leaderboard, a rate limiter
  and a delayed job, and defend the choice on memory.
- Spot a check-then-set race in review, and fix it with one atomic command or a
  short Lua script.
- Write a distributed lock that cannot deadlock and cannot delete another
  worker's lock — and say honestly what it does not guarantee.
- Choose `maxmemory-policy` for an instance by asking what losing a key costs.

## Where this connects

- **The concepts behind all of this** — data structures, TTL, RDB and AOF,
  pub/sub, cluster mode →
  [../../system-design/foundational/redis.md](../../system-design/foundational/redis.md)
- **What to cache and how to invalidate it** →
  [../01-caching-in-practice/](../01-caching-in-practice/)
- **The queue that needs its own instance** →
  [../03-background-jobs/](../03-background-jobs/)
- **The same races, solved with a real database** →
  [../../databases/transactions-and-concurrency/](../../databases/transactions-and-concurrency/)
- **Why one thread blocks everyone, in Node** →
  [../../typescript-fundamentals/event-loop/event-loop.md](../../typescript-fundamentals/event-loop/event-loop.md)
- **Turning these signals into metrics and health checks** →
  [../../backend-fundamentals/08-logging-and-observability/04-metrics-and-health-checks-part-1.md](../../backend-fundamentals/08-logging-and-observability/04-metrics-and-health-checks-part-1.md)
