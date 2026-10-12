# Caching in Practice

A customer emails support: *"I renamed our project an hour ago and it still
shows the old name for my team."* You check the database. The new name is
there. The save worked. Somewhere between that row and their browser a copy of
the old value is still being served, and nothing in your logs mentions it.

That is what this folder is about. Not what a cache is — that is a concept, and
it is already written down. This is the implementation layer: which endpoint
deserves a cache, what the key must contain, how to remove the copy when the
truth changes, and what your API does at 3 AM when Redis is gone.

> **📌 The whole part in one line:** caching is easy to add and hard to keep
> correct, so every decision here is really a decision about who notices when
> the copy is wrong.

## Files

1. [When to Cache](01-when-to-cache.md) — why a missing index is usually the
   real problem, ranking endpoints by calls times cost, a decision framework
   walked through the SaaS domain, what you must never cache, read-your-own-
   writes, where a cache can live, and why a 99% hit ratio can be worthless.
2. [Implementing Cache-Aside — Part 1](02-implementing-cache-aside-part-1.md) —
   a typed generic `remember` helper, then key design in depth: the naming
   convention, the version segment, the tenant id and the cross-tenant leak
   when you forget it, varying by role or locale, and unbounded cardinality.
3. [Implementing Cache-Aside — Part 2](02-implementing-cache-aside-part-2.md) —
   what `JSON.stringify` quietly destroys, a typed revive step, caching
   negative results, choosing a time to live from harm rather than habit,
   hit and miss metrics, and which layer the cache belongs in.
4. [Invalidation in Practice — Part 1](03-invalidation-in-practice-part-1.md) —
   the three strategies implemented, making explicit invalidation survive six
   months of new write paths, the write-then-invalidate race as a timeline, why
   deleting beats updating, and why invalidating inside a transaction is wrong.
5. [Invalidation in Practice — Part 2](03-invalidation-in-practice-part-2.md) —
   collections and lists, versioned collections versus tags, invalidating
   across services with events, why `KEYS` takes down production, a checklist
   for "a user sees old data", and two-level caching.
6. [Stampede and Failure Modes — Part 1](04-stampede-and-failure-modes-part-1.md)
   — how one expiring key takes the database down, then request coalescing, a
   distributed lock per key, probabilistic early expiry, and
   stale-while-revalidate.
7. [Stampede and Failure Modes — Part 2](04-stampede-and-failure-modes-part-2.md)
   — failing open when Redis is down, when failing open is wrong, cold caches
   and warming, hot keys, eviction, why a cache and a queue must never share one
   Redis, and a runbook.

## Read in this order

Read 1 to 7 in order. File 1 is the one to read even if you skip the rest,
because most bad caches are decisions, not code.

```text
  01 when to cache  →  02 cache-aside  →  03 invalidation  →  04 failure modes
     (decide)           (build)            (keep correct)      (survive)
```

The patterns themselves — cache-aside versus write-through versus write-behind,
eviction policies, stampede as a concept — live in
[caching-strategies.md](../../system-design/foundational/caching-strategies.md).
Read that first if the words are new. This folder does not repeat it. It builds
the thing and then breaks it.

## What you should be able to do after this part

- Decide whether an endpoint deserves a cache, with numbers rather than a
  feeling about which page is slow.
- Design a key that cannot serve one company's data to another, and explain
  every segment in it.
- Name every key a write invalidates, and keep that in one function instead of
  scattered across controllers.
- Explain the write-then-invalidate race from memory and name three defences.
- Answer "what happens when Redis is down?" with evidence from your own code.
- Work through a stale-data report in a fixed order instead of guessing.

## Where this connects

- **Before caching** — the query fix that usually makes it unnecessary:
  [slow-query-fixes.md](../../databases/query-optimization/slow-query-fixes.md)
  and [n-plus-one-queries.md](../../databases/query-optimization/n-plus-one-queries.md).
- **The same staleness one layer down** —
  [read replicas and replication lag](../../databases/operations/04-read-replicas-and-replication-lag.md).
- **Caching inside the database** —
  [materialized views](../../databases/operations/03-materialized-views.md).
- **Next in this track** — [../02-redis-in-practice/](../02-redis-in-practice/),
  then [../03-background-jobs/](../03-background-jobs/).
