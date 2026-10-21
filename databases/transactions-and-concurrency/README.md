# Transactions and Concurrency

This folder is the heart of one question:

> **📌 What happens when two users touch the same row at the same time?**

Everything else in the `databases/` track assumes one query at a time. Indexes
make a single query fast. Query plans explain a single query's cost. This
folder is about the moment that assumption breaks — two people press *Save* on
the same invoice, two workers grab the same job, two admins each remove
themselves from a company, and the database has to decide what is true.

The answers are not obvious, and most of the bugs here are **silent**. Nothing
errors. No log line appears. A number is just wrong afterwards, and nobody
notices until the month-end report does not add up.

## Files

1. [Transactions and ACID — Part 1](01-transactions-and-acid-part-1.md) —
   `BEGIN`, `COMMIT`, `ROLLBACK`, autocommit, each ACID letter with the failure
   that happens without it, the write-ahead log, and what a commit really does.
2. [Transactions and ACID — Part 2](01-transactions-and-acid-part-2.md) —
   savepoints, how far a transaction should reach, why an HTTP call must never
   be inside one, `idle in transaction`, DDL in a transaction, and two-phase
   commit.
3. [Isolation Levels and Anomalies — Part 1](02-isolation-levels-and-anomalies-part-1.md)
   — the five anomalies (dirty read, non-repeatable read, phantom, lost update,
   write skew) as interleaving timelines, and the four SQL levels defined
   against them.
4. [Isolation Levels and Anomalies — Part 2](02-isolation-levels-and-anomalies-part-2.md)
   — what PostgreSQL *actually* does, setting the level, why Serializable means
   "write a retry loop", and which level to choose.
5. [MVCC — Part 1](03-mvcc-part-1.md) — how readers never block writers: row
   versions, `xmin` and `xmax`, snapshots and visibility, why an `UPDATE` is
   really an insert, and where dead tuples and bloat come from.
6. [MVCC — Part 2](03-mvcc-part-2.md) — `VACUUM`, HOT updates and
   `fillfactor`, why `count(*)` cannot be instant, long-running transactions,
   and transaction id wraparound.
7. [Locks — Part 1](04-locks-part-1.md) — row locks and table locks with
   conflict matrices, `SELECT ... FOR UPDATE`, `SKIP LOCKED` job queues, which
   DDL takes `ACCESS EXCLUSIVE`, and the queue-behind-a-blocked-`ALTER TABLE`
   outage.
8. [Locks — Part 2](04-locks-part-2.md) — advisory locks, foreign key locking,
   how to find who is blocking whom during an incident, `lock_timeout` versus
   `statement_timeout`, and hot-row contention.
9. [Deadlocks — Part 1](05-deadlocks-part-1.md) — a worked deadlock timeline,
   the wait-for cycle, how to read the PostgreSQL deadlock report, and the five
   common causes with fixes.
10. [Deadlocks — Part 2](05-deadlocks-part-2.md) — a correct retry loop, what
    makes a retry safe, reducing deadlock frequency, the after-the-fact
    runbook, and deadlock versus livelock versus a plain lock wait.
11. [Optimistic vs Pessimistic Locking — Part 1](06-optimistic-vs-pessimistic-locking-part-1.md)
    — the practical decision when two users save the same record: lock first,
    or detect the conflict on write? Both patterns, and how they compare.
12. [Optimistic vs Pessimistic Locking — Part 2](06-optimistic-vs-pessimistic-locking-part-2.md)
    — the atomic in-place update that beats both, unique constraints,
    `ON CONFLICT`, conflict resolution beyond rejecting, and `ETag`/`If-Match`.

## Read in this order

Read 1 → 6 in order. The dependency chain is real:

```text
01 transactions  →  02 isolation levels  →  03 MVCC
                             ↓                 ↓
                          04 locks  ←──────────┘
                             ↓
                       05 deadlocks  →  06 optimistic vs pessimistic
```

File 02 shows you the problems. File 03 shows you the mechanism PostgreSQL uses
to avoid most of them. File 04 shows you the mechanism for the ones MVCC cannot
solve. File 05 is what happens when that mechanism ties itself in a knot, and
file 06 is the decision you actually make in application code.

If you only read two sections in this whole folder, read **write skew** in file
02 and **the queue behind a blocked DDL** in file 04. Those two cause the most
damage per line of code.

## What you should be able to do after this folder

- Explain each ACID letter with a concrete failure that happens without it.
- Draw the interleaving of two transactions that produces a lost update, and
  fix it three different ways.
- Explain why PostgreSQL's Read Committed lets two queries in one transaction
  disagree, and when that matters.
- Say what `xmin` and `xmax` are, and why a table can be 4 GB with 400 MB of
  live rows.
- Write a job queue with `FOR UPDATE SKIP LOCKED` that two workers cannot
  double-pick.
- Name which `ALTER TABLE` variants take `ACCESS EXCLUSIVE`, and explain how
  one of them freezes an entire table for every other query.
- Read a deadlock report and name the two statements that caused it.
- Choose optimistic locking, pessimistic locking, or an atomic update for a
  given feature — and justify it in one sentence.

## Where this connects

- **Application side** — wrapping a service method in a transaction, passing a
  transaction handle through repositories, ORM version columns:
  [backend-fundamentals/10-database-integration/](../../backend-fundamentals/10-database-integration/).
- **Cleanup and health** — vacuum, bloat, connection pooling:
  [../operations/](../operations/).
- **Beyond one database** — replication lag, consistency models:
  [system-design/foundational/](../../system-design/foundational/).
