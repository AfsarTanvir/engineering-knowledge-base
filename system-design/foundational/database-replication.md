# Database Replication

Replication keeps copies of the same data on multiple database nodes.
It's the foundation for two separate goals that often get bundled
together but are worth telling apart: surviving a node failure (high
availability), and spreading read load across more than one machine
(scalability). Which topology you pick depends on which of those two
you're actually solving for.

## Table of Contents

1. [Leader-Follower (Primary-Replica) Replication](#leader-follower-primary-replica-replication)
2. [Synchronous vs Asynchronous Replication](#synchronous-vs-asynchronous-replication)
3. [Replication Lag](#replication-lag)
4. [Multi-Leader Replication](#multi-leader-replication)
5. [Leaderless (Quorum-Based) Replication](#leaderless-quorum-based-replication)
6. [Failover](#failover)
7. [MySQL and PostgreSQL Specifics](#mysql-and-postgresql-specifics)
8. [Quick Reference](#quick-reference)

---

## Leader-Follower (Primary-Replica) Replication

The most common setup: one node (the leader/primary) accepts all writes;
one or more followers/replicas receive a continuous stream of those
changes and apply them locally.

```
Client writes -> [ Leader ] --replication stream--> [ Replica 1 ]
                                                   --> [ Replica 2 ]

Client reads  -> [ Leader ] or [ Replica 1 ] or [ Replica 2 ]
```

**Reads can be spread across replicas**, taking load off the leader —
this is the scalability half of replication. **Writes always go through
the leader** — replicas don't independently accept writes in this model,
which is what keeps conflict resolution simple.

## Synchronous vs Asynchronous Replication

**Asynchronous** — the leader commits a write and returns to the client
immediately; replicas catch up afterward, at their own pace:

```
Client write -> Leader commits -> Client gets success response
                    |
                    +--(later, async)--> Replica applies the change
```

Fast writes, but a leader failure right after commit can lose the most
recent writes that hadn't yet reached any replica.

**Synchronous** — the leader waits for at least one replica to confirm
the write before responding to the client:

```
Client write -> Leader commits -> waits for Replica 1 ack -> Client gets success response
```

No data loss on leader failure (a replica already has it), but every
write now pays the latency of a round-trip to that replica — and if the
synchronous replica is unreachable, writes can stall entirely.

**Semi-synchronous** is the common middle ground: one replica
acknowledges synchronously (guaranteeing at least one up-to-date copy),
the rest replicate asynchronously — most of the durability benefit
without paying full synchronous latency on every replica.

## Replication Lag

Asynchronous replicas are always somewhat behind the leader. That gap —
replication lag — has a very concrete failure mode: a user writes data,
immediately reads it back, and the read (served from a lagging replica)
doesn't show what they just wrote.

```
T=0.00s: Client writes "status = shipped" to Leader
T=0.05s: Client reads from Replica 1 -> still shows "status = processing"
         (replica hasn't caught up yet)
```

**Fixes:**

- **Read-your-own-writes:** route a user's reads to the leader (or a
  replica known to be caught up) for a short window right after they
  write, then fall back to any replica after that.
- **Monitor lag directly** and route reads away from any replica whose
  lag exceeds a threshold:

```sql
-- PostgreSQL: lag in bytes between leader and this replica
SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS lag_bytes
FROM pg_stat_replication;
```

```sql
-- MySQL: seconds behind the source
SHOW REPLICA STATUS\G
-- look at: Seconds_Behind_Source
```

---

## Multi-Leader Replication

Multiple nodes each accept writes, then replicate those writes to each
other. Useful for multi-datacenter setups where you want writes to
succeed locally in each region without a round-trip to a single global
leader:

```
Datacenter A: [ Leader A ] <--replicates both ways--> [ Leader B ] :Datacenter B
     ^                                                        ^
  local writes accepted here                          local writes accepted here
```

**The hard problem this introduces: write conflicts.** If the same row
is updated in both datacenters before the replication catches up, which
write wins?

```
Leader A: UPDATE users SET email = 'a@x.com' WHERE id = 1
Leader B: UPDATE users SET email = 'b@x.com' WHERE id = 1
-- both commit locally before either replicates to the other
-- now which value is correct?
```

Common resolution strategies: last-write-wins (by timestamp — simple, but
can silently discard a valid concurrent write), custom merge logic
(application-specific, e.g., "union the two sets of tags instead of
picking one"), or avoiding the conflict entirely by routing all writes
for a given entity to the same leader (partitioning writes by key, not
just by datacenter).

Only reach for multi-leader when the latency savings from local writes
in each region genuinely outweighs the conflict-resolution complexity —
for most applications, a single leader with geographically distributed
read replicas is simpler and sufficient.

## Leaderless (Quorum-Based) Replication

No designated leader — a client writes to multiple nodes directly, and
reads from multiple nodes, resolving discrepancies at read time using a
quorum (majority) rule:

```
Write: send to nodes A, B, C -> succeed once W nodes acknowledge (e.g., W=2)
Read:  query nodes A, B, C -> use the majority/most-recent value across R responses (e.g., R=2)
```

With `W + R > N` (nodes written + nodes read > total replicas), every
read is guaranteed to overlap with at least one node that has the latest
write — this is the core guarantee quorum systems rely on. Cassandra and
DynamoDB use this model, trading leader-based simplicity for tunable
consistency-vs-availability per operation (see
[cap-theorem-and-consistency-models.md](cap-theorem-and-consistency-models.md)).

---

## Failover

When a leader fails, something has to promote a replica to be the new
leader:

- **Manual failover** — an operator confirms the leader is actually down
  (not just slow/network-partitioned) and promotes a replica. Slower to
  recover, but avoids the failure mode below.
- **Automatic failover** — a monitoring system detects the leader is down
  and promotes a replica without human intervention. Faster recovery, but
  risks a **split-brain**: if the old leader wasn't actually dead (just
  network-partitioned from the monitor), you can end up with two nodes
  both believing they're the leader, each accepting writes independently.

Automatic failover tooling (e.g., Patroni for PostgreSQL, Orchestrator
for MySQL) mitigates split-brain with fencing — actively ensuring the old
leader stops accepting writes (or is killed outright) before the new one
takes over — rather than just racing to promote a replacement.

---

## MySQL and PostgreSQL Specifics

**MySQL:** replication traditionally ships via the binary log (binlog);
replicas replay binlog events to reproduce changes. Group Replication and
tools like Galera Cluster add multi-leader/synchronous options on top of
the default async leader-follower model.

```sql
SHOW REPLICA STATUS\G          -- check replica health and lag
SHOW BINARY LOG STATUS;        -- leader's current binlog position
```

**PostgreSQL:** ships changes via the write-ahead log (WAL); replicas
(standbys) replay WAL records. Native streaming replication is
asynchronous by default; synchronous replication is opt-in per-replica
via `synchronous_standby_names`.

```sql
SELECT * FROM pg_stat_replication;   -- connected replicas and their lag
```

---

## Quick Reference

| Goal                                          | Approach                                  |
| :-------------------------------------------------- | :---------------------------------------------- |
| Survive a node failure, simplest model                | Leader-follower, async, with failover tooling       |
| No data loss on leader failure                        | Synchronous (or semi-synchronous) replication        |
| Spread read load across machines                       | Leader-follower, route reads to replicas              |
| Low-latency local writes in multiple regions            | Multi-leader (accept the conflict-resolution cost)     |
| Tunable per-operation consistency vs availability       | Leaderless/quorum-based (Cassandra, DynamoDB style)     |

**Bottom line:** start with async leader-follower replication — it
covers both availability and read scaling for most applications. Reach
for synchronous replication only when losing the last few writes on
failover is unacceptable, and reserve multi-leader/leaderless models for
genuinely multi-region write workloads where the added complexity is
worth it.
