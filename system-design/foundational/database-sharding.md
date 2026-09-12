# Database Sharding

Replication (see [database-replication.md](database-replication.md))
copies the *same* data onto multiple nodes to survive failures and spread
read load. Sharding does the opposite: it splits *different* data across
multiple nodes, so no single machine has to hold — or serve writes for —
the entire dataset. You reach for sharding when the data itself, not just
read traffic, has outgrown one machine.

## Table of Contents

1. [Why Shard: What Replication Doesn't Fix](#why-shard-what-replication-doesnt-fix)
2. [Range-Based Sharding](#range-based-sharding)
3. [Hash-Based Sharding](#hash-based-sharding)
4. [Directory-Based Sharding](#directory-based-sharding)
5. [Picking a Shard Key](#picking-a-shard-key)
6. [The Cross-Shard Query Problem](#the-cross-shard-query-problem)
7. [Resharding](#resharding)
8. [Quick Reference](#quick-reference)

---

## Why Shard: What Replication Doesn't Fix

Replication gives every replica a full copy of the data — great for read
scaling and failover, useless for write scaling or datasets too large for
one disk. Every replica is still bottlenecked by the leader for writes,
and every node still needs to store 100% of the data.

Sharding splits the dataset itself: each shard holds a *subset* of the
rows, so total storage and write throughput scale with the number of
shards instead of being capped by one machine.

```
Unsharded: [ Single DB: all 500M users ]

Sharded:   [ Shard 0: users 0-124M ] [ Shard 1: users 125M-249M ]
           [ Shard 2: users 250M-374M ] [ Shard 3: users 375M-500M ]
```

In practice, each shard is usually *also* replicated (for failover) — the
two techniques stack rather than substitute for each other.

## Range-Based Sharding

Assign contiguous ranges of the shard key to each shard:

```
Shard 0: user_id 0        - 124,999,999
Shard 1: user_id 125,000,000 - 249,999,999
Shard 2: user_id 250,000,000 - 374,999,999
```

```python
def get_shard(user_id, range_size=125_000_000):
    return user_id // range_size
```

**Good for:** range queries ("all orders from January") — a query for a
contiguous range often hits only one or a few shards instead of all of
them.

**Weak point:** hotspots. If `user_id` is roughly sequential (new users
always get the highest IDs), all new writes land on the *last* shard —
every other shard sits idle while one shard takes 100% of new-user write
traffic.

## Hash-Based Sharding

Hash the shard key and assign based on the hash, spreading writes evenly
regardless of any pattern in the key itself:

```python
def get_shard(user_id, num_shards):
    return hash(user_id) % num_shards
```

**Good for:** even write distribution — no hotspots from sequential IDs,
since the hash scrambles any ordering in the source key.

**Weak point:** range queries become expensive — "all orders from
January" now has to fan out to *every* shard, since consecutive keys are
scattered across the hash space with no relationship to each other.
Resizing the shard count also remaps most keys unless paired with
[consistent hashing](../reliability/consistent-hashing.md) — plain modulo
hashing has exactly the reshuffling problem that page describes.

## Directory-Based Sharding

Keep an explicit lookup table mapping each key (or key range) to its
shard, instead of computing the mapping algorithmically:

```sql
-- A separate "shard directory" service/table
SELECT shard_id FROM shard_map WHERE tenant_id = 'acme_corp';
-- -> shard_id = 3
```

**Good for:** maximum flexibility — you can move any individual key to
any shard for load-balancing reasons, without the rigid structure of a
formula. Common in multi-tenant SaaS systems where a "whale" tenant might
need its own dedicated shard while smaller tenants share one.

**Weak point:** the directory itself becomes a critical, frequently-
queried piece of infrastructure — it needs to be fast, highly available,
and consistent, or every query in the system stalls looking up where its
data lives. Usually mitigated by caching the mapping aggressively at the
application layer.

---

## Picking a Shard Key

The shard key determines which shard a row lives on — and the wrong
choice causes problems no sharding *strategy* can fix on its own:

- **High cardinality** — enough distinct values to spread across all
  shards; a shard key with only 3 possible values can never use more
  than 3 shards.
- **Even access distribution** — avoid a key where one value (a huge
  tenant, a viral post) draws disproportionate traffic to a single shard
  regardless of hashing.
- **Matches your query patterns** — if almost every query filters by
  `tenant_id`, shard by `tenant_id` so those queries hit one shard
  instead of fanning out to all of them.

```
Bad shard key: `status` (only ~5 distinct values -> at most 5 usable shards,
                and one status like "active" likely holds most rows anyway)

Good shard key: `user_id` or `tenant_id` (high cardinality, matches how
                the app already queries the data)
```

## The Cross-Shard Query Problem

A query that filters by the shard key hits exactly one shard — fast.  A
query that doesn't (or needs to aggregate across all users, not just
one) has to fan out to every shard and merge results in the application:

```python
# Filtered by shard key: hits one shard
def get_user(user_id):
    shard = get_shard(user_id)
    return shard.query("SELECT * FROM users WHERE id = %s", user_id)

# NOT filtered by shard key: must query every shard and merge
def count_active_users():
    total = 0
    for shard in all_shards:
        total += shard.query("SELECT COUNT(*) FROM users WHERE status = 'active'")
    return total
```

**Joins across shards are the sharp edge** — a join between two tables
sharded by different keys (or where the join key isn't the shard key)
can't be pushed down to the database at all; it has to be done in
application code, fetching from multiple shards and joining in memory.
This is usually the deciding factor in whether a given table should be
sharded, replicated in full to every shard, or kept in a separate
unsharded service entirely.

## Resharding

Changing the number of shards later is expensive by nature — data has to
physically move between machines, and the running system needs to keep
working throughout.

- **Range-based:** relatively easier to split one range into two without
  touching unrelated shards.
- **Hash-based with plain modulo:** resizing remaps most keys — this is
  the exact problem [consistent hashing](../reliability/consistent-hashing.md)
  solves, so hash-based sharding schemes built for elastic scaling
  typically use a hash ring rather than raw `% N`.
- **Directory-based:** move individual keys by updating the directory
  entry and migrating just that key's data — the most granular, least
  disruptive option, at the cost of the directory service itself needing
  to be robust.

Whichever scheme, resharding under load generally needs a dual-write or
migration-in-progress phase (writing to both old and new shard placement
temporarily) rather than a hard cutover, to avoid a window where data
appears lost mid-migration.

---

## Quick Reference

| Sharding scheme      | Range queries          | Write distribution         | Resizing cost                  |
| :----------------------- | :--------------------------- | :-------------------------------- | :------------------------------------ |
| Range-based                | Fast (hits few shards)          | Risk of hotspots on sequential keys  | Moderate — split a range               |
| Hash-based (plain modulo)  | Slow (fans out to all shards)    | Even                                 | High — remaps most keys                 |
| Hash-based (consistent hashing) | Slow (fans out to all shards) | Even                             | Low — remaps ~1/N of keys                |
| Directory-based             | Depends on lookup granularity     | Fully flexible, manually balanced     | Low — move individual keys               |

**Bottom line:** shard when write throughput or data size has outgrown
one machine, not before — it adds real complexity, especially around
cross-shard queries and joins. Pick a shard key with high cardinality
that matches your actual query patterns, and prefer hash-based sharding
with a consistent-hashing ring over plain modulo if you expect to resize
the cluster over time.
