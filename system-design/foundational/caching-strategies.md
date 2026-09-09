# Caching Strategies

Caching trades staleness for speed: you serve a copy of data instead of
recomputing or refetching it, and accept that the copy might briefly be
wrong. Which caching pattern you pick determines how stale that copy can
get, and what happens to your system when the cache fails.

## Table of Contents

1. [Cache-Aside (Lazy Loading)](#cache-aside-lazy-loading)
2. [Write-Through](#write-through)
3. [Write-Behind (Write-Back)](#write-behind-write-back)
4. [Read-Through](#read-through)
5. [TTL and Eviction Policies](#ttl-and-eviction-policies)
6. [Cache Stampede](#cache-stampede)
7. [Cache Invalidation](#cache-invalidation)
8. [Where to Cache](#where-to-cache)
9. [Quick Reference](#quick-reference)

---

## Cache-Aside (Lazy Loading)

The application checks the cache first; on a miss, it reads from the
database and populates the cache for next time. The cache never talks to
the database directly — the application always sits in the middle.

```python
def get_user(user_id):
    cached = redis.get(f"user:{user_id}")
    if cached:
        return json.loads(cached)  # cache hit

    user = db.query("SELECT * FROM users WHERE id = %s", user_id)  # cache miss
    redis.set(f"user:{user_id}", json.dumps(user), ex=3600)  # populate, 1hr TTL
    return user
```

**Good for:** read-heavy workloads where not every key is accessed
equally — only the keys someone actually asks for end up cached, so
memory isn't wasted on cold data.

**Trade-off:** the first request for any key always misses and pays full
database latency (see [Cache Stampede](#cache-stampede) for what happens
when many requests hit that same miss at once).

---

## Write-Through

Every write goes to the cache *and* the database together, synchronously,
before the write is considered complete. Reads always hit a cache that's
guaranteed to reflect the latest write.

```python
def update_user(user_id, data):
    db.execute("UPDATE users SET ... WHERE id = %s", user_id)
    redis.set(f"user:{user_id}", json.dumps(data), ex=3600)  # same request, before returning
```

**Good for:** data that's read far more often than written, where
staleness is unacceptable (e.g., account balances, permissions).

**Trade-off:** every write now pays the latency of two systems instead of
one. Also caches data that might never be read again — unlike cache-aside,
you're populating on write regardless of future read demand.

---

## Write-Behind (Write-Back)

The write goes to the cache immediately and returns to the caller right
away; the database write happens asynchronously afterward, batched or
queued.

```python
def update_user(user_id, data):
    redis.set(f"user:{user_id}", json.dumps(data), ex=3600)
    write_queue.push({"user_id": user_id, "data": data})  # flushed to DB later, async
```

**Good for:** write-heavy workloads where you can tolerate a short window
of the database lagging behind the cache — e.g., view counters, activity
logs, analytics events, where losing the last few seconds on a crash is
acceptable.

**Trade-off:** if the cache crashes before the queued write reaches the
database, that write is lost. Never use this for data you can't afford to
lose (payments, orders) unless the queue itself is durable (e.g., backed
by Kafka or a persisted queue, not just in-memory).

---

## Read-Through

Similar to cache-aside, but the cache layer itself owns the "miss → load
from database → populate" logic, instead of the application. The
application only ever talks to the cache.

```python
# Conceptually — many caching libraries/proxies implement this for you
class ReadThroughCache:
    def get(self, key):
        value = self.cache.get(key)
        if value is None:
            value = self.loader(key)   # cache's own logic, not the caller's
            self.cache.set(key, value)
        return value

user_cache = ReadThroughCache(loader=lambda uid: db.query(
    "SELECT * FROM users WHERE id = %s", uid
))
user = user_cache.get(user_id)
```

**Good for:** keeping cache-population logic out of every call site — one
place defines how to load a miss, instead of every caller repeating the
cache-aside pattern by hand.

**Trade-off:** requires a caching layer/library that supports it (e.g.,
many ORM-level caches, or a caching proxy) — plain Redis/Memcached don't
do this automatically; you still write the loader function yourself.

---

## TTL and Eviction Policies

**TTL (time-to-live)** bounds how long a stale entry can live before it
expires on its own, even if nothing explicitly invalidates it:

```python
redis.set("user:1020", data, ex=3600)  # expires in 1 hour regardless of writes
```

Short TTL → fresher data, more cache misses, more database load. Long TTL
→ fewer misses, more risk of serving stale data. Pick based on how often
the underlying data actually changes and how much staleness is tolerable.

**Eviction policy** decides what gets removed when the cache is full
(independent of TTL):

| Policy   | Behavior                                             | Good for                              |
| :--------- | :-------------------------------------------------------- | :----------------------------------------- |
| LRU        | Evicts the Least Recently Used entry                        | General-purpose default — most workloads      |
| LFU        | Evicts the Least Frequently Used entry                      | Workloads with a stable set of "hot" keys accessed repeatedly |
| FIFO       | Evicts the oldest-inserted entry regardless of usage          | Rarely ideal — usually LRU is a better default |
| Random     | Evicts a random entry                                        | Cheap to implement, rarely the best choice     |

Redis defaults to no eviction (`noeviction`, returns errors when full) —
explicitly set `maxmemory-policy` to `allkeys-lru` or similar for
production caching use.

---

## Cache Stampede

When a hot key expires, every concurrent request for it misses at the
same time and all of them hit the database simultaneously — a self-
inflicted spike that can take the database down right as the cache was
supposed to be protecting it.

```
Cache entry for "homepage_feed" expires at T=0
1000 concurrent requests arrive at T=0.001s
All 1000 miss the cache -> all 1000 query the database at once
```

**Fix 1: Locking (single-flight).** Only one request recomputes; others
wait for it or serve stale data briefly:

```python
def get_feed():
    cached = redis.get("homepage_feed")
    if cached:
        return cached

    if redis.set("homepage_feed:lock", "1", nx=True, ex=10):  # only one gets the lock
        feed = compute_expensive_feed()
        redis.set("homepage_feed", feed, ex=3600)
        redis.delete("homepage_feed:lock")
        return feed
    else:
        time.sleep(0.05)
        return redis.get("homepage_feed") or compute_expensive_feed()  # fallback
```

**Fix 2: Jittered TTL.** Instead of every related key expiring at exactly
the same moment, add randomness so expirations spread out over time:

```python
redis.set(key, value, ex=3600 + random.randint(0, 300))  # 3600-3900s, staggered
```

**Fix 3: Refresh-ahead.** Proactively recompute a hot key shortly before
it expires (e.g., at 90% of its TTL), so it never actually goes cold under
load.

---

## Cache Invalidation

The hard part of caching isn't storing data — it's knowing when a cached
copy is wrong and needs to go.

- **TTL expiry** — simplest, but stale data can be served for up to the
  full TTL window
- **Explicit invalidation on write** — delete or update the cache entry
  the moment the source of truth changes:

```python
def update_user(user_id, data):
    db.execute("UPDATE users SET ... WHERE id = %s", user_id)
    redis.delete(f"user:{user_id}")  # next read repopulates fresh
```

- **Event-driven invalidation** — a write in one service publishes an
  event; other services holding a cached copy of that data subscribe and
  invalidate accordingly (see [message queue patterns](message-queues/overview.md)
  for the pub/sub mechanics)

**Prefer deleting over updating the cache on write** in most cases —
deleting is simpler to reason about and self-heals (the next read just
repopulates), while updating the cache in two places (DB and cache) risks
the two falling out of sync if either write fails independently.

---

## Where to Cache

Caching isn't only "put Redis in front of the database" — it exists at
multiple layers, often simultaneously:

| Layer                   | Example                                     | Typical TTL          |
| :------------------------- | :---------------------------------------------- | :----------------------- |
| Browser / HTTP cache        | `Cache-Control` headers on static assets           | Hours to days              |
| CDN / edge                 | CloudFront, Cloudflare caching API responses        | Minutes to hours            |
| Application (in-memory)     | A local dict/LRU cache inside a single process       | Seconds to minutes          |
| Distributed cache          | Redis, Memcached shared across app instances          | Minutes to hours            |
| Database query cache        | Materialized views, query result caching              | Varies — often manual invalidation |

Each layer closer to the user removes load from every layer behind it —
a CDN hit never even reaches your application, let alone the database.

---

## Quick Reference

| Pattern         | Write path                          | Read path                         | Risk on cache failure                |
| :----------------- | :--------------------------------------- | :-------------------------------------- | :----------------------------------------- |
| Cache-aside          | App writes DB only; cache untouched        | App checks cache, falls back to DB on miss | None — cache is purely additive              |
| Write-through        | App writes cache + DB synchronously        | App reads cache (always fresh)             | None — DB always has the latest data          |
| Write-behind         | App writes cache, DB write is async         | App reads cache                             | Data loss if cache dies before DB flush        |
| Read-through         | App writes DB (cache layer handles reads)   | Cache layer loads + populates on miss       | None if underlying loader hits DB directly     |

**Bottom line:** cache-aside is the safe default for most read-heavy
data. Reach for write-through when staleness is unacceptable, write-behind
only when losing the last few seconds of writes is truly fine, and always
plan for cache stampede on any key hot enough to matter.
