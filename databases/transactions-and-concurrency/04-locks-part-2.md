# Locks — Part 2

Part 1 covered the locks PostgreSQL takes on your behalf — row locks, table
locks, and the DDL queue. This part is the rest of the picture: locks you
invent yourself, the ones a foreign key takes behind your back, and what to
type when production is frozen and you need to know who is holding what.

> **⬅️ This continues [Part 1](./04-locks-part-1.md).**

> **📌 In one line:** during an incident the only questions that matter are
> *who is blocked*, *who is blocking them*, and *how long you are willing to
> wait* — and PostgreSQL answers all three from `pg_locks`, `pg_stat_activity`
> and `lock_timeout`.

## Table of Contents

1. [Advisory Locks](#advisory-locks)
2. [Foreign Key Locking](#foreign-key-locking)
3. [Diagnosing Locks During an Incident](#diagnosing-locks-during-an-incident)
4. [lock_timeout and statement_timeout](#lock_timeout-and-statement_timeout)
5. [Advanced: Hot Rows and Contention](#advanced-hot-rows-and-contention)
6. [Common Mistakes](#common-mistakes)
7. [Questions to Test Yourself](#questions-to-test-yourself)
8. [Related](#related)

---

## Advisory Locks

Every lock so far was taken by the database, about a table or a row. **Advisory
locks** are locks you define, about anything you like. PostgreSQL just tracks
them; the meaning is yours.

The classic use: *only one instance of this service should run this cron job,
even though six instances are deployed.*

```sql
-- Try to take lock number 42. Returns true or false immediately.
SELECT pg_try_advisory_lock(42);
```

```ts
const JOB_LOCK = 8817342   // any bigint you assign to this job

const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS got', [JOB_LOCK])
if (!rows[0].got) {
  logger.info('another instance holds the nightly-billing lock; skipping')
  return
}
try {
  await runNightlyBilling()
} finally {
  await client.query('SELECT pg_advisory_unlock($1)', [JOB_LOCK])
}
```

Two flavours, and the difference matters:

| Function | Scope | Released when |
|---|---|---|
| `pg_advisory_lock(key)` | **Session** | You call `pg_advisory_unlock`, or the session ends |
| `pg_try_advisory_lock(key)` | Session | Same — but returns `false` instead of waiting |
| `pg_advisory_xact_lock(key)` | **Transaction** | Automatically at `COMMIT` or `ROLLBACK` — no unlock call |
| `pg_try_advisory_xact_lock(key)` | Transaction | Same, non-blocking |

> **📌 Prefer the `_xact_` variants.** They cannot leak. A session-level
> advisory lock survives an exception with no `finally`, and then nothing runs
> the job until someone finds and kills that connection.

Two cautions:

- **Keys are global to the database and untyped.** Two unrelated features
  picking `1` will block each other mysteriously. Keep a constants file, or
  derive keys with `hashtext('nightly-billing')`.
- **They do not work through a transaction-mode connection pooler** such as
  PgBouncer in transaction mode, because session-level state does not survive
  between transactions. Transaction-scoped advisory locks are fine. See
  [../operations/01-connection-pooling-part-2.md](../operations/01-connection-pooling-part-2.md).

Other good uses: serialising a migration across several app instances, giving
one leader per shard, and turning a write-skew invariant into a queue by
locking a name rather than a row.

---

## Foreign Key Locking

Here is a subtle source of contention. Insert a task:

```sql
INSERT INTO tasks (project_id, title, status) VALUES (31, 'Ship billing', 'todo');
```

PostgreSQL must check that project 31 exists *and* make sure nobody deletes it
or changes its key before you commit. So it takes a **`FOR KEY SHARE` lock on
the parent row** in `projects`.

`FOR KEY SHARE` is deliberately the weakest mode: many sessions can hold it on
the same parent at once, so thousands of concurrent inserts of tasks into the
same project do not queue up. Deleting the parent, or updating its primary key,
needs `FOR UPDATE` and does conflict.

Where it bites: **`UPDATE` on the parent row.**

| Time | Session A (task insert) | Session B (company update) |
|---|---|---|
| T1 | `BEGIN;` | |
| T2 | `INSERT INTO users (company_id, email) VALUES (1,'zoe@acme.com');` → `FOR KEY SHARE` on company 1 | |
| T3 | | `BEGIN;` |
| T4 | | `UPDATE companies SET plan='enterprise' WHERE id=1;` |
| T5 | *(slow work, 5 seconds)* | proceeds ✅ — `plan` is not a key column, so `FOR NO KEY UPDATE`, which is compatible |
| T6 | | `DELETE FROM companies WHERE id=1;` ⏸ **blocked** — needs `FOR UPDATE` |

This is exactly why `FOR NO KEY UPDATE` exists. Before it, any `UPDATE` on a
parent row conflicted with child inserts, and a busy `companies` row — one big
customer with constant signups — became a serialisation point for the whole
tenant. In recent PostgreSQL versions, an update that touches no key column no
longer blocks child inserts.

Practical rules:

- **A hot parent row is still a contention risk.** If you update `companies`
  frequently *and* it is the parent of high-volume inserts, watch for waits.
- **Never update a primary key.** It escalates to `FOR UPDATE` and blocks every
  child insert.
- **Index your foreign key columns.** Without an index on `tasks.project_id`, a
  `DELETE` or key update on `projects` must scan `tasks` to check the
  constraint — slow, and it holds locks while it does.

---

## Diagnosing Locks During an Incident

The query to have ready. Copy it somewhere you can find at 3 a.m.:

```sql
SELECT blocked.pid                AS blocked_pid,
       blocked.usename            AS blocked_user,
       left(blocked.query, 50)    AS blocked_query,
       now() - blocked.query_start AS blocked_for,
       blocking.pid               AS blocking_pid,
       blocking.state             AS blocking_state,
       left(blocking.query, 50)   AS blocking_query,
       now() - blocking.xact_start AS blocking_txn_age
FROM   pg_stat_activity AS blocked
JOIN   LATERAL unnest(pg_blocking_pids(blocked.pid)) AS blocking_pid ON true
JOIN   pg_stat_activity AS blocking ON blocking.pid = blocking_pid
WHERE  cardinality(pg_blocking_pids(blocked.pid)) > 0
ORDER  BY blocked_for DESC;
```

```text
 blocked_pid | blocked_user |           blocked_query            | blocked_for | blocking_pid |    blocking_state   |         blocking_query         | blocking_txn_age
-------------+--------------+------------------------------------+-------------+--------------+---------------------+--------------------------------+------------------
       31902 | app          | SELECT * FROM invoices WHERE compa | 00:03:41.2  |        29144 | active              | ALTER TABLE invoices ADD COLUM | 00:03:44.9
       31955 | app          | INSERT INTO invoices (company_id,  | 00:03:22.8  |        29144 | active              | ALTER TABLE invoices ADD COLUM | 00:03:44.9
       29144 | migrator     | ALTER TABLE invoices ADD COLUMN cu | 00:03:44.9  |        28841 | idle in transaction | SELECT sum(amount_cents) FROM  | 00:08:12.1

```

Read it bottom-up and the whole incident is visible: pid 28841 is idle in
transaction, blocking the migration (29144), which is blocking everything else.
The fix is to terminate 28841, not the migration.

`pg_blocking_pids(pid)` does the hard part for you — it returns the pids
directly blocking that one. Before it existed, people joined `pg_locks` to
itself, which is fiddly and easy to get wrong.

For the full picture including lock modes:

```sql
SELECT l.pid, l.locktype, l.mode, l.granted,
       coalesce(c.relname, l.locktype) AS object,
       left(a.query, 40)               AS query
FROM   pg_locks l
LEFT   JOIN pg_class c ON c.oid = l.relation
JOIN   pg_stat_activity a ON a.pid = l.pid
WHERE  NOT l.granted OR l.mode = 'AccessExclusiveLock'
ORDER  BY l.granted, l.pid;
```

And to act:

```sql
SELECT pg_cancel_backend(28841);      -- cancel the running query
SELECT pg_terminate_backend(28841);   -- kill the connection (for idle in transaction)
```

`pg_cancel_backend` does nothing to a session that is idle in transaction —
there is no query to cancel. That case needs `pg_terminate_backend`.

---

## lock_timeout and statement_timeout

Two settings that convert an outage into an error message.

| Setting | Caps | Typical value |
|---|---|---|
| `lock_timeout` | How long a statement waits **for a lock** | `3s` for migrations; often unset for app queries |
| `statement_timeout` | How long a statement may **run** | A few seconds for web requests; higher for reports |
| `idle_in_transaction_session_timeout` | How long a session may sit idle **inside a transaction** | `60s` |

```sql
-- Per session, the usual way for a migration
SET lock_timeout = '3s';
SET statement_timeout = '30s';

-- Per transaction only
BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE invoices ADD COLUMN currency text;
COMMIT;

-- Per role, so every web request inherits it
ALTER ROLE app_user SET statement_timeout = '10s';
```

> **📌 The mindset:** these are not tuning knobs, they are blast-radius limits.
> A query that has run for 30 seconds in a web request is already a failed
> request — the only question is whether it is also damaging everyone else.

Set `statement_timeout` on the application role, a much higher one on the
analytics role, and `lock_timeout` on the migration role.

---

## Advanced: Hot Rows and Contention

Every row lock is a queue. If a design funnels many transactions through one
row, that row becomes a throughput ceiling no index can lift.

The usual culprit is a denormalised counter:

```sql
-- companies gets a cached counter "so the dashboard is fast"
ALTER TABLE companies ADD COLUMN open_task_count int NOT NULL DEFAULT 0;

-- ...and now every task insert does this:
UPDATE companies SET open_task_count = open_task_count + 1 WHERE id = 1;
```

One row. Every task creation across the whole company. Each `UPDATE` holds the
row lock until its transaction commits, so if the average transaction is 20 ms,
you have capped task creation at roughly 50 per second for that company — and
the biggest customer, the one you least want to slow down, hits it first.

Worse, each of those updates writes a new tuple on the same page
([03-mvcc-part-1.md](03-mvcc-part-1.md)), so that page bloats fast and autovacuum has to
revisit it constantly.

Alternatives, in rough order of preference:

| Approach | Trade-off |
|---|---|
| Compute it on read, with a good index | No contention; costs a query. Usually correct |
| Materialised view or summary table, refreshed periodically | Slightly stale; no hot row |
| Count in many rows and sum them (sharded counter) | More complex; genuinely scales |
| Cache the count in Redis with a periodic reconcile | Fast; you now own two sources of truth |

This is a concrete argument against a specific denormalisation, and it belongs
with the rest of that discussion in
[../data-modeling/04-denormalization-and-read-models-part-1.md](../data-modeling/04-denormalization-and-read-models-part-1.md).
The general rule: **denormalise into rows that many writers do not share.**

Finally, the single best lock-contention fix, which costs nothing:

> **📌 Shorten the transaction.** Lock wait time is transaction duration times
> contention. You can rarely reduce contention, but you can almost always
> reduce duration — move the API call out, prepare data before `BEGIN`, commit
> as soon as the writes are done. Halving transaction duration halves every
> lock wait in the system.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Session-level advisory locks with no `finally` | The lock leaks; the job never runs again | `pg_advisory_xact_lock` |
| Ad-hoc advisory lock keys | Unrelated features collide | A constants file, or `hashtext('name')` |
| Unindexed foreign key columns | Parent deletes scan the child table while holding locks | Index every FK column |
| A counter column on a shared parent row | Serialises every child write; bloats one page | Compute on read, or shard the counter |
| Using `pg_cancel_backend` on `idle in transaction` | There is no query to cancel | `pg_terminate_backend` |

---

## Questions to Test Yourself

1. Why should advisory locks usually be transaction-scoped? What breaks under
   PgBouncer in transaction mode?
2. Why does inserting a child row lock the parent, and why is that lock the
   weakest mode?
3. Write, or reconstruct, the `pg_blocking_pids` query and explain how to read
   its output during an incident.
4. What is the difference between `lock_timeout` and `statement_timeout`, and
   which one belongs at the top of a migration script?
5. Why is a `task_count` column on `companies` a throughput ceiling, and what
   would you do instead?

---

## Related

- [Part 1](04-locks-part-1.md) — row locks, `SELECT ... FOR UPDATE`,
  `SKIP LOCKED`, table locks, and the queue behind a blocked `ALTER TABLE`.
- [MVCC](03-mvcc-part-2.md) — the cleanup that `VACUUM FULL` blocks everything
  to perform.
- [Deadlocks](05-deadlocks-part-2.md) — telling a deadlock apart from a plain
  lock wait, and the diagnosis runbook.
- [Optimistic vs Pessimistic Locking](06-optimistic-vs-pessimistic-locking-part-2.md)
  — the atomic update that removes the hot-row lock entirely.
- [Transactions and ACID](01-transactions-and-acid-part-2.md) — why short
  transactions are the root fix.
- [../operations/01-connection-pooling-part-2.md](../operations/01-connection-pooling-part-2.md)
  — why advisory locks and poolers interact badly.
- [../data-modeling/04-denormalization-and-read-models-part-1.md](../data-modeling/04-denormalization-and-read-models-part-1.md)
  — the hot-counter trade-off in full.
