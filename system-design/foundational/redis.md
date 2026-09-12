# Redis

Redis is an in-memory data store — every operation happens against data
held in RAM, which is what makes it fast enough to sit on the hot path of
a web request. It shows up throughout this knowledge base as the
implementation detail behind caching, rate limiting, and idempotency keys
— this page covers Redis itself: what it actually offers beyond "a fast
key-value store."

## Table of Contents

1. [Data Structures](#data-structures)
2. [Expiry (TTL)](#expiry-ttl)
3. [Persistence: RDB and AOF](#persistence-rdb-and-aof)
4. [Atomic Operations](#atomic-operations)
5. [Pub/Sub](#pubsub)
6. [Distributed Locking](#distributed-locking)
7. [Replication and Cluster Mode](#replication-and-cluster-mode)
8. [Common Use Cases in This Knowledge Base](#common-use-cases-in-this-knowledge-base)
9. [Quick Reference](#quick-reference)

---

## Data Structures

Redis isn't just string key → string value — each data type supports its
own set of operations, which is what makes it useful for more than plain
caching.

```bash
# String — the simplest case
SET user:1020:name "Alice"
GET user:1020:name

# Hash — a single key holding multiple fields (like a row)
HSET user:1020 name "Alice" email "alice@x.com" status "active"
HGET user:1020 email

# List — ordered, good for queues/recent-activity feeds
LPUSH recent_orders "order:5001"
LRANGE recent_orders 0 9   # most recent 10

# Set — unordered, unique members, fast membership checks
SADD active_users "user:1020"
SISMEMBER active_users "user:1020"   # O(1) check

# Sorted Set — unique members, each with a score, kept in order — leaderboards
ZADD leaderboard 4200 "player:88"
ZREVRANGE leaderboard 0 9 WITHSCORES   # top 10 by score
```

**Sorted sets deserve special mention** — they're the standard Redis
structure for anything ranked (leaderboards, "most recent N," priority
queues by timestamp) because insertion, removal, and range queries are
all logarithmic time, not a full scan.

## Expiry (TTL)

Any key can have an expiration, after which Redis removes it
automatically — the mechanism behind every TTL-based cache example
elsewhere in this knowledge base (see
[caching-strategies.md](caching-strategies.md#ttl-and-eviction-policies)):

```bash
SET session:abc123 "user_data" EX 3600   # expires in 1 hour
TTL session:abc123                        # check remaining seconds
PERSIST session:abc123                    # remove the expiration, make it permanent
```

When memory fills up, `maxmemory-policy` decides what gets evicted first
— `allkeys-lru` (evict least-recently-used) is the standard choice for a
cache; the default `noeviction` instead makes Redis reject new writes
once full, which is rarely what you want for a caching workload.

## Persistence: RDB and AOF

Redis is in-memory, but two mechanisms let it survive a restart without
losing everything:

- **RDB (snapshotting)** — periodically dumps the entire dataset to disk
  as a point-in-time snapshot. Fast to restart from, but anything written
  since the last snapshot is lost on a crash.
- **AOF (append-only file)** — logs every write operation to disk as it
  happens. Slower (a disk write per command, or batched per second), but
  loses far less on a crash.

```conf
# redis.conf
save 900 1        # RDB: snapshot if >=1 key changed in 900s
appendonly yes     # AOF: also log every write
appendfsync everysec   # fsync AOF once per second (balance of safety vs speed)
```

**For pure caching**, persistence is often unnecessary — if Redis
restarts and the cache is empty, the application just repopulates it on
the next miss (see cache-aside in
[caching-strategies.md](caching-strategies.md#cache-aside-lazy-loading)).
**For anything Redis is the source of truth for** (session data with no
other backing store, a queue with no durable backup), persistence
matters — treat it the same as any other database's durability decision.

## Atomic Operations

Redis commands are single-threaded and atomic by default — no other
client's command can interleave in the middle of one command's execution.
This is what makes Redis useful for coordination, not just caching:

```bash
INCR page_views              # atomic increment, safe under concurrent callers
SET lock:order:1020 "1" NX EX 10   # set-if-not-exists — the basis of a simple lock
```

`NX` (only set if the key doesn't already exist) combined with an
expiry is the exact mechanism used for the cache-stampede lock in
[caching-strategies.md](caching-strategies.md#cache-stampede) and the
message-deduplication check in
[idempotency.md](../reliability/idempotency.md#idempotency-in-message-consumers) —
both rely on this single atomic primitive.

**For multi-step atomicity**, Redis transactions (`MULTI`/`EXEC`) queue
commands and run them together without another client's commands
interleaving — but unlike a SQL transaction, there's no rollback on a
failed command mid-transaction; earlier commands in the batch still
apply.

```bash
MULTI
INCR inventory:sku123
DECR reserved:sku123
EXEC
```

For genuinely conditional logic (read a value, decide, then write based
on what you read, atomically), Lua scripting (`EVAL`) runs a whole script
as one atomic unit server-side, which transactions alone don't provide.

## Pub/Sub

Redis has built-in publish/subscribe — the same broadcast concept from
[message-queues/overview.md](message-queues/overview.md), with an
important limitation: **messages aren't persisted.** A subscriber that's
offline when a message publishes simply never receives it — there's no
replay, no queue backing it up.

```bash
# Subscriber
SUBSCRIBE order_events

# Publisher (from another client)
PUBLISH order_events '{"order_id": 1020, "status": "placed"}'
```

Fine for ephemeral fan-out (e.g., pushing live updates to connected
WebSocket clients) where a missed message just means "that client didn't
get a live update, they'll see current state on next load." **Not a
substitute for Kafka/RabbitMQ/SQS** when delivery actually needs to be
guaranteed — Redis Streams (a different, log-like data structure) is
closer to that if you need Redis specifically to provide it.

## Distributed Locking

The `SET ... NX EX` pattern shown earlier is a simple mutual-exclusion
lock across multiple application instances — useful for "only one
instance should run this scheduled job" style coordination:

```python
def try_acquire_lock(key, ttl_seconds=30):
    return redis.set(f"lock:{key}", "1", nx=True, ex=ttl_seconds)

if try_acquire_lock("nightly_report_job"):
    run_report()
    redis.delete("lock:nightly_report_job")
```

**This is a best-effort lock, not a strict one.** A process that acquires
the lock but hangs past the TTL loses it silently (another process can
then acquire it too) — fine for "avoid running this twice under normal
conditions," not safe for correctness-critical mutual exclusion (e.g.,
preventing a double-spend). For that level of guarantee, use your
database's actual locking/transaction support instead.

## Replication and Cluster Mode

Redis supports the same [leader-follower replication](database-replication.md)
model as a relational database — a primary accepts writes, replicas copy
asynchronously for read scaling and failover. **Redis Sentinel** monitors
primaries/replicas and handles automatic failover; **Redis Cluster**
adds sharding on top, splitting the keyspace across multiple primaries
using hash slots (a fixed-partition variant of the
[consistent hashing](../reliability/consistent-hashing.md) idea) so no
single node needs to hold the entire dataset.

---

## Common Use Cases in This Knowledge Base

| Use case                                   | Redis feature used                       | See also                                    |
| :------------------------------------------- | :------------------------------------------- | :------------------------------------------------ |
| Cache-aside cache store                        | Strings + TTL                                  | [caching-strategies.md](caching-strategies.md)        |
| Cache stampede lock                            | `SET NX EX`                                     | [caching-strategies.md](caching-strategies.md#cache-stampede) |
| Rate limiter counter                           | `INCR` + `EXPIRE`, or sorted sets for sliding windows | [rate-limiting.md](rate-limiting.md)                  |
| Idempotency / dedup check                       | `SET NX`                                        | [idempotency.md](../reliability/idempotency.md)        |
| Leaderboard                                    | Sorted sets                                      | —                                                    |
| Session store                                   | Strings or hashes + TTL                            | [horizontal-vs-vertical-scaling.md](../scale-patterns/horizontal-vs-vertical-scaling.md#the-statelessness-requirement) |

---

## Quick Reference

| Need                                                | Redis feature                             |
| :--------------------------------------------------------- | :----------------------------------------------- |
| Simple key-value cache with expiry                            | Strings + `EX`/`TTL`                                |
| A ranked list (leaderboard, top-N)                             | Sorted sets (`ZADD`, `ZREVRANGE`)                     |
| Fast membership checks                                        | Sets (`SADD`, `SISMEMBER`)                            |
| Atomic counter across concurrent callers                        | `INCR`/`DECR`                                          |
| A simple "only one at a time" lock                              | `SET NX EX` (best-effort, not strict)                    |
| Ephemeral broadcast to currently-connected clients                | Pub/Sub (no persistence, no replay)                       |
| Guaranteed message delivery, replay, multiple consumers            | Not Redis Pub/Sub — use Kafka/RabbitMQ/SQS instead          |

**Bottom line:** Redis's speed comes from being in-memory, and its
usefulness beyond plain caching comes from its data structures (sorted
sets, atomic counters) and atomic primitives (`SET NX`) that let it do
double duty as a rate limiter, lock, or dedup store. Don't reach for its
Pub/Sub when you need guaranteed delivery — that's a job for an actual
message queue.
