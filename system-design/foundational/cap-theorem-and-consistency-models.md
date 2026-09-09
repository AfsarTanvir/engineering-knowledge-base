# CAP Theorem & Consistency Models

CAP theorem gets cited constantly and misunderstood almost as often. It
doesn't say "pick 2 of 3 forever" — it says something much narrower and
more useful: **when a network partition happens, you must choose between
consistency and availability for that moment.** Everything else in this
doc is about what that choice actually looks like in practice.

## Table of Contents

1. [The Three Properties](#the-three-properties)
2. [The Actual Theorem](#the-actual-theorem)
3. [CP vs AP: What Each Choice Feels Like](#cp-vs-ap-what-each-choice-feels-like)
4. [PACELC: The More Useful Follow-Up](#pacelc-the-more-useful-follow-up)
5. [Consistency Models in Practice](#consistency-models-in-practice)
6. [Quorum Reads and Writes](#quorum-reads-and-writes)
7. [Where Real Systems Land](#where-real-systems-land)
8. [Quick Reference](#quick-reference)

---

## The Three Properties

- **Consistency (C)** — every read sees the most recent write, no matter
  which node answers it. (Note: this is *not* the same "C" as ACID's
  consistency — CAP's C is about replicas agreeing, not constraints.)
- **Availability (A)** — every request to a non-failing node gets a
  response, even if it can't guarantee that response is the latest data.
- **Partition tolerance (P)** — the system keeps operating even when
  network failures prevent some nodes from talking to others.

## The Actual Theorem

Partitions *will* happen — networks fail, that's not optional in a
distributed system. So partition tolerance isn't really a choice you get
to opt out of; the real trade-off CAP describes only kicks in **during** a
partition:

```
Normal operation (no partition): all three properties hold simultaneously.

During a partition — a node can't reach the others — you must pick:

  Stay consistent  -> refuse to answer (or answer only from the majority side)
                       until the partition heals -> sacrifices availability

  Stay available    -> answer anyway, from whichever side got the request
                       -> risks returning stale/conflicting data -> sacrifices consistency
```

This is why "CAP" is really "when partitioned, C or A" — not a permanent,
always-in-effect choice about your whole system.

## CP vs AP: What Each Choice Feels Like

**CP (consistency over availability):** a node that can't confirm it has
the latest data refuses to serve the request rather than risk serving
stale data.

```
Partition splits cluster into [Node A] and [Node B, Node C]
Node A alone can't confirm it has the latest write
-> Node A rejects requests until the partition heals
-> Node B, C (the majority side) continue serving, IF they can reach quorum
```

Example feel: a banking ledger balance query timing out or erroring
during a network issue, rather than risking showing you the wrong balance.

**AP (availability over consistency):** every reachable node answers
regardless of whether it's fully caught up.

```
Partition splits cluster into [Node A] and [Node B, Node C]
Node A still answers requests using whatever data it currently has
-> might be stale relative to what Node B/C have
-> once the partition heals, conflicting writes need to be reconciled
```

Example feel: a "like" count on a social post that's briefly different
depending on which server answers, but never just fails to load.

Neither is universally correct — a payment ledger usually wants CP; a
social media feed usually wants AP.

---

## PACELC: The More Useful Follow-Up

CAP only describes behavior *during a partition* — but partitions are
rare, and systems make consistency-vs-latency trade-offs constantly, even
when the network is perfectly healthy. **PACELC** extends the idea:

> **P**artition: choose **A**vailability or **C**onsistency (this is CAP)
> **E**lse (no partition): choose **L**atency or **C**onsistency

Even with no partition at all, a synchronous write to multiple replicas
(consistent, but slower — see
[database-replication.md](database-replication.md)) versus an async write
(faster, but a replica might briefly lag) is a latency-vs-consistency
choice made on every single write, independent of any failure scenario.

This is why PACELC is often the more practically useful framing: it
covers the day-to-day trade-off, not just the rare-partition edge case.

---

## Consistency Models in Practice

**Strong consistency** — every read reflects the most recent committed
write, globally, immediately. Simplest to reason about; most expensive to
provide (usually requires synchronous coordination, adding latency).

```
Write "balance = 100" completes -> every subsequent read, from any node, returns 100
```

**Eventual consistency** — after a write, replicas will *converge* to the
same value, but there's no guarantee about how long that takes. A read
immediately after a write might return stale data.

```
Write "balance = 100" completes -> Read from Replica A: 100 (caught up)
                                 -> Read from Replica B: 90  (not yet caught up)
                                 -> ...eventually, Replica B also shows 100
```

**Read-your-own-writes** — a specific, practical middle ground: the user
who made a write always sees it on their own subsequent reads, even if
other users might briefly see stale data from a lagging replica. Solves
the most common real-world complaint about eventual consistency ("I just
posted this, why can't I see it?") without paying for full strong
consistency everywhere.

**Causal consistency** — writes that are causally related (a reply to a
comment) are seen by everyone in the order they actually happened;
unrelated writes can be seen in any order. Stronger than eventual, cheaper
than strong.

---

## Quorum Reads and Writes

Leaderless/quorum-based systems (Cassandra, DynamoDB — see
[database-replication.md](database-replication.md)) let you tune
consistency per-operation using three numbers: `N` (total replicas), `W`
(replicas that must ack a write), `R` (replicas queried on a read).

```
N = 3 replicas total

W = 3, R = 1: strong-leaning write (all replicas must confirm),
              cheap read (only ask one) -- but that one might be behind
              if a previous write didn't reach it yet (shouldn't happen if W=N)

W = 1, R = 1: fastest possible, weakest consistency -- a read might miss
              a very recent write entirely

W = 2, R = 2 (out of N=3): "quorum" reads and writes --
              W + R > N (2+2=4 > 3) guarantees every read overlaps with
              at least one replica that has the latest write
```

`W + R > N` is the condition that guarantees strong-enough consistency
without requiring *every* replica to participate in every operation —
you get most of the durability of `W=N` with better availability, since
the system tolerates `N - W` (or `N - R`) replicas being unreachable and
still functions.

---

## Where Real Systems Land

| System                    | Typical stance                                        |
| :---------------------------- | :---------------------------------------------------------- |
| Traditional RDBMS (single leader, sync replica) | CP-leaning — refuses/stalls writes rather than risk inconsistency |
| Cassandra, DynamoDB (tunable quorum)              | AP by default, tunable toward CP per-operation via W/R settings |
| ZooKeeper, etcd                                    | CP — explicitly built for correctness-critical coordination, will sacrifice availability during a partition |
| Most caches (Redis, Memcached)                     | AP-leaning — serve what's cached rather than fail, accept staleness |

Most real production systems aren't purely one or the other — an
application often layers a CP system (e.g., a payment ledger in
PostgreSQL) alongside an AP system (e.g., a Redis cache in front of it)
for different pieces of the same overall product.

---

## Quick Reference

| Question                                                   | Answer                                        |
| :--------------------------------------------------------------- | :--------------------------------------------------- |
| Does CAP mean I must permanently sacrifice one property?           | No — only during an actual network partition           |
| What matters more when there's no partition happening?             | Consistency vs latency (PACELC), not CAP                 |
| User needs to see their own write immediately, others can lag      | Read-your-own-writes consistency                          |
| Need per-operation tunable consistency                              | Quorum-based system with configurable W/R                   |
| Financial/inventory correctness matters more than uptime            | Favor CP                                                     |
| Uptime and responsiveness matter more than perfect freshness         | Favor AP                                                     |

**Bottom line:** CAP is a statement about partition behavior, not a
permanent architecture label — most of your actual day-to-day trade-offs
are the latency-vs-consistency choice PACELC describes. Pick strong
consistency for correctness-critical data, eventual (ideally with
read-your-own-writes) for everything else, and use quorum settings when
the system supports tuning the trade-off per operation instead of
globally.
