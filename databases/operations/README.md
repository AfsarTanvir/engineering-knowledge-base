# Operations

Everything so far in the `databases/` track has been about making the database
answer a question well. This folder is about **keeping it alive** — the work that
happens after the schema is designed and the queries are fast.

It answers the questions that arrive at 3 a.m.: why is the application slow when
the database is idle, why is a table four times bigger than its data, why did a
user's save appear to fail, and which query do I run first when everything is
stuck.

## Files

1. [Connection Pooling — Part 1](01-connection-pooling-part-1.md) — why a
   PostgreSQL connection is an operating-system process, what a pool is, the
   settings that matter, why a bigger pool is usually *slower*, the
   pool-size × instance-count multiplication trap, and connection leaks.
2. [Connection Pooling — Part 2](01-connection-pooling-part-2.md) — how a
   transaction pins a connection, PgBouncer's three modes and what transaction
   mode breaks, serverless connection storms, draining the pool on SIGTERM, and
   layering timeouts so the innermost fires first.
3. [Vacuum and Autovacuum — Part 1](02-vacuum-and-autovacuum-part-1.md) — what
   vacuum actually does, why `VACUUM FULL` on a live table causes outages, and
   why the default autovacuum settings barely touch a 100-million-row table.
4. [Vacuum and Autovacuum — Part 2](02-vacuum-and-autovacuum-part-2.md) — the
   four things that block autovacuum and the query that finds each, what to
   monitor, transaction id wraparound, and why a read-heavy table still needs
   vacuuming.
5. [Materialized Views](03-materialized-views.md) — turning an eight-second
   dashboard query into 0.2 ms, `REFRESH` versus `REFRESH CONCURRENTLY`, refresh
   strategies and staleness as a product decision, and when the answer is really
   just an index.
6. [Read Replicas and Replication Lag](04-read-replicas-and-replication-lag.md)
   — measuring lag, the read-after-write problem and four ways to fix it, which
   queries are safe on a replica, failover, and why replication is not a backup.
7. [Monitoring and Troubleshooting — Part 1](05-monitoring-and-troubleshooting-part-1.md)
   — `pg_stat_statements`, `pg_stat_activity`, cancelling versus terminating, and
   the "who is blocking whom" query to run during an incident.
8. [Monitoring and Troubleshooting — Part 2](05-monitoring-and-troubleshooting-part-2.md)
   — spotting a missing index from table statistics, slow query logging, the
   ordered triage checklist, what to alert on, and backup restore testing.

## Read in this order

Read 1 → 8 in order. The monitoring files are the ones you will return to most,
but they make more sense once you know what a pool, a dead tuple and a replica
are. If you only read two things here, read **sizing the pool** in file 1 and the
**triage checklist** in file 8.

```text
  01 pooling  →  02 vacuum  →  03 materialized views
                                        ↓
              05 monitoring  ←  04 read replicas
```

This folder assumes [../transactions-and-concurrency/](../transactions-and-concurrency/).
Dead tuples, locks and snapshots are explained there and only applied here.

## What you should be able to do after this folder

- Size a connection pool from the database's CPU count and the maximum number of
  application instances, and explain why a bigger pool is usually slower.
- Recognise pool exhaustion from the symptom "slow application, idle database"
  and confirm it with one query.
- Explain why a table keeps growing even though autovacuum runs, find which of
  four things is blocking it, and remove that blocker.
- Decide between a materialized view, a summary table, a cache and a read
  replica for a slow dashboard — and say what staleness you are buying.
- Explain the read-after-write problem to a frontend colleague and pick the right
  fix for a given endpoint.
- Work through an incident in a fixed order instead of guessing, and name the
  query you run at each step.

## Where this connects

- **Application side** — pool configuration, ORMs, migrations:
  [backend-fundamentals/10-database-integration/](../../backend-fundamentals/10-database-integration/).
- **Locks, MVCC and isolation** — the mechanics behind bloat and blocking:
  [../transactions-and-concurrency/](../transactions-and-concurrency/).
- **Beyond one database** — replication topologies, caching, sharding:
  [system-design/foundational/](../../system-design/foundational/).
