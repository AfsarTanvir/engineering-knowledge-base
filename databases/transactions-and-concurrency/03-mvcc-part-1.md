# MVCC — Multi-Version Concurrency Control — Part 1

Here is a question that sounds impossible. Session A is running a 30-second
report over `invoices`. Session B updates invoice 4021 in the middle of it. How
can A finish reading a consistent picture while B is rewriting the same table —
without either of them waiting?

The naive answer is locks: readers take a shared lock, writers take an
exclusive one, and one of them waits. That is how some databases used to work,
and it means one slow report can stall every write in the system.

PostgreSQL's answer is **MVCC**: a writer never overwrites a row. It writes a
*new version* of it and leaves the old one in place. A reader keeps reading the
version that was current when it started.

> **📌 The one sentence to remember: readers never block writers, and writers
> never block readers.**

Only writer-versus-writer on the *same row* has to wait, and that is
[04-locks-part-1.md](04-locks-part-1.md). Everything else in this file is the
price PostgreSQL pays for that sentence — and the price is real.

This part is the mechanism: what a row version is, how a snapshot decides which
version you see, and the garbage that piles up as a result. Part 2 is the
cleanup and everything that goes wrong when it cannot keep up.

## Table of Contents

1. [A Row Version: xmin and xmax](#a-row-version-xmin-and-xmax)
2. [Transaction Ids and Snapshots](#transaction-ids-and-snapshots)
3. [The Visibility Rule, Worked Through](#the-visibility-rule-worked-through)
4. [An UPDATE Is Really an Insert](#an-update-is-really-an-insert)
5. [Dead Tuples and Bloat](#dead-tuples-and-bloat)
6. [Common Mistakes](#common-mistakes)
7. [Questions to Test Yourself](#questions-to-test-yourself)
8. [Related](#related)

---

## A Row Version: xmin and xmax

What you think of as "a row" is really a **tuple** — one physical version of
that row, stored in a page on disk. Every tuple carries hidden system columns.
Two of them do the work:

| Hidden column | Meaning |
|---|---|
| `xmin` | The transaction id that **created** this version |
| `xmax` | The transaction id that **deleted or superseded** it (`0` = still current) |
| `ctid` | Where this version physically lives: `(page, slot)` |

You can select them:

```sql
SELECT ctid, xmin, xmax, id, status, amount_cents
FROM   invoices
WHERE  id = 4021;
```

```text
 ctid  | xmin | xmax |  id  | status | amount_cents
-------+------+------+------+--------+--------------
 (0,1) | 5100 |    0 | 4021 | open   |        25000
```

Now transaction 5182 updates it:

```sql
BEGIN;                                              -- this is txid 5182
UPDATE invoices SET status = 'paid' WHERE id = 4021;
COMMIT;
```

Re-run the same `SELECT` and you see a different tuple:

```text
 ctid  | xmin | xmax |  id  | status | amount_cents
-------+------+------+------+--------+--------------
 (0,7) | 5182 |    0 | 4021 | paid   |        25000
```

The old one has not gone anywhere. Physically, the page now holds both:

```text
 Heap page 0 of "invoices"
 ┌──────────────────────────────────────────────────────────────┐
 │ slot 1  xmin=5100  xmax=5182   id=4021  status='open'   ← DEAD │
 │ slot 2  xmin=5090  xmax=0      id=4022  status='open'   ← live │
 │ slot 3  xmin=5090  xmax=0      id=4023  status='paid'   ← live │
 │  ...                                                          │
 │ slot 7  xmin=5182  xmax=0      id=4021  status='paid'   ← live │
 └──────────────────────────────────────────────────────────────┘
      ▲ two versions of invoice 4021 exist at the same time
```

Slot 1 now has `xmax = 5182`: "transaction 5182 ended my life". It is still
readable by anyone whose snapshot predates 5182, which is the whole point.

A `DELETE` is even simpler: nothing is erased. The tuple just gets an `xmax`.

> **📌 Nothing is ever modified in place** (with one exception, HOT, later).
> Every write appends a new version and stamps the old one.

---

## Transaction Ids and Snapshots

Every transaction that writes gets a **transaction id (xid)**, handed out in
increasing order: 5100, 5101, 5102 … (Read-only transactions get a virtual id
and do not consume a real one.)

A **snapshot** is a transaction's answer to "which other transactions count as
finished, from my point of view?" It is three pieces of information:

| Part | Meaning |
|---|---|
| `xmin` (of the snapshot) | Every xid below this is definitely finished |
| `xmax` (of the snapshot) | Every xid at or above this had not started yet |
| `xip_list` | The xids that were **in progress** at the moment of the snapshot |

```sql
SELECT pg_current_snapshot();
```

```text
 pg_current_snapshot
---------------------
 5180:5186:5182,5184
```

Read that as: everything below 5180 is done; 5186 and above had not begun; 5182
and 5184 were running. So from this snapshot's view, 5181, 5183 and 5185 are
committed and visible, while 5182 and 5184 are invisible even if they commit
one microsecond later.

**When the snapshot is taken is the whole difference between isolation levels:**

| Level | Snapshot taken |
|---|---|
| Read Committed | At the start of **each statement** |
| Repeatable Read / Serializable | At the **first statement**, and kept for the whole transaction |

That is the mechanism behind everything in
[02-isolation-levels-and-anomalies-part-1.md](02-isolation-levels-and-anomalies-part-1.md).

---

## The Visibility Rule, Worked Through

For every tuple it reads, the executor asks one question: *is this version
visible to me?* In plain words:

> A tuple is visible if the transaction that created it (`xmin`) counts as
> committed in my snapshot, **and** the transaction that removed it (`xmax`) is
> either absent or does **not** count as committed in my snapshot.

Worked example. Your snapshot is `5180:5186:5182`. Four tuples:

| Tuple | xmin | xmax | Visible? | Why |
|---|---|---|---|---|
| A | 5100 | 0 | ✅ yes | Created long ago, never deleted |
| B | 5100 | 5182 | ✅ yes | Deleter 5182 is still in progress — not committed for me |
| C | 5100 | 5181 | ❌ no | 5181 committed before my snapshot; this version is gone |
| D | 5182 | 0 | ❌ no | Its creator 5182 is in progress; this version does not exist yet for me |

Tuple B is the interesting one. Session 5182 has deleted it and can no longer
see it. You still can. Both of you are correct.

Two sessions reading the same row at the same moment, seeing different values:

| Time | Session A (Repeatable Read, txid 5200) | Session B (txid 5182) |
|---|---|---|
| T1 | `BEGIN; SELECT status FROM invoices WHERE id=4021;` → `open` | |
| T2 | | `BEGIN; UPDATE invoices SET status='paid' WHERE id=4021;` |
| T3 | | `COMMIT;` |
| T4 | `SELECT status FROM invoices WHERE id=4021;` → **`open`** | |
| T5 | | `SELECT status FROM invoices WHERE id=4021;` → **`paid`** |
| T6 | `COMMIT;` | |
| T7 | `SELECT status FROM invoices WHERE id=4021;` → `paid` | |

At T4 and T5 both sessions read the *same* physical page, at the *same*
instant, and get different answers. Neither waited. Nothing is stale or buggy —
A's snapshot excludes 5182, so A reads the version with `xmin=5100`, and B's
includes it, so B reads the version with `xmin=5182`.

---

## An UPDATE Is Really an Insert

This is the consequence that surprises everyone:

> **📌 In PostgreSQL, an `UPDATE` is an `INSERT` of a new tuple plus a
> mark-as-dead of the old one.**

Even this, which changes one boolean:

```sql
UPDATE notifications SET read_at = now() WHERE id = 991234;
```

...writes a complete new copy of the row. Three things follow, and they explain
a lot of PostgreSQL behaviour:

**1. The table grows on every update.** Update every row in a 1 GB table once
and you have a 2 GB table with 1 GB of live data — until vacuum reclaims it.

**2. Every index on the table may need a new entry.** The new tuple lives at a
new `ctid`, so each index must learn to point at it — *even indexes on columns
you did not change*. A table with eight indexes pays eight index writes for a
one-column update. (Unless HOT applies; see below.)

**3. WAL volume is bigger than you expect.** The full new tuple is logged, not
the delta. Wide rows with `text` columns make updates expensive in WAL, in
replication traffic, and in backup size.

This is why "just add a `last_seen_at` column and update it on every request"
is a much more expensive idea in PostgreSQL than it sounds.

---

## Dead Tuples and Bloat

A tuple is **dead** when no running or future transaction could ever need to
see it — its deleting transaction committed, and every snapshot in existence is
newer. Dead tuples still occupy space until something reclaims them.

```text
A page after a busy hour of updates

 ┌───────────────────────────────────────────────┐
 │ ■ dead   ■ dead   □ live   ■ dead   ■ dead    │
 │ ■ dead   □ live   ■ dead   ■ dead   □ live    │  ← 8 KB page
 │ ■ dead   ■ dead   ■ dead   □ live   ■ dead    │     15 dead, 5 live
 └───────────────────────────────────────────────┘
       reading 5 useful rows costs a full page read
```

**Bloat** is the gap between the space a table occupies and the space its live
rows need. A table can easily be 4 GB holding 400 MB of live data.

Why it hurts, concretely:

- **Sequential scans read dead rows too.** The executor must fetch every page,
  read every tuple, and discard the invisible ones. Ten times the pages means
  roughly ten times the I/O for the same result.
- **Indexes bloat as well**, and bloated index pages mean deeper traversals and
  more buffer cache spent on nothing.
- **Cache hit rate collapses.** Shared buffers fill with pages that are mostly
  dead tuples, evicting pages you actually need.
- **The planner's estimates drift**, because its cost model uses page counts.

Check it:

```sql
SELECT relname,
       n_live_tup,
       n_dead_tup,
       round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 1) AS pct_dead,
       pg_size_pretty(pg_total_relation_size(relid))                     AS total_size,
       last_autovacuum
FROM   pg_stat_user_tables
ORDER  BY n_dead_tup DESC
LIMIT  10;
```

```text
    relname    | n_live_tup | n_dead_tup | pct_dead | total_size |      last_autovacuum
---------------+------------+------------+----------+------------+----------------------------
 notifications |    2104883 |   18442091 |     89.8 | 14 GB      | 2026-09-14 02:11:03+00
 tasks         |     884120 |     102338 |     10.4 | 1204 MB    | 2026-09-17 06:40:55+00
 invoices      |      41207 |       1902 |      4.4 | 64 MB      | 2026-09-17 09:02:11+00
```

That first row is a table where 90% of the physical rows are garbage, and
autovacuum last succeeded three days ago. Something is blocking cleanup — which
is the [Long-Running Transactions](#long-running-transactions-are-the-enemy)
section.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Thinking `UPDATE` changes a row in place | It writes a new tuple and updates indexes | Budget updates like inserts; watch HOT % |
| Expecting `DELETE` to free disk space | Deleted tuples remain until vacuum | Use `VACUUM`; `TRUNCATE` for whole tables |
| Expecting `VACUUM` to shrink the file | It makes space reusable, not returned to the OS | `VACUUM FULL` or `pg_repack`, in a window |

---

## Questions to Test Yourself

1. State the MVCC promise in one sentence. Which single case still requires
   waiting?
2. What do `xmin` and `xmax` mean on a tuple? What is `xmax = 0`?
3. After an `UPDATE`, how many versions of the row exist and what marks each?
4. What three parts make up a snapshot? When is it taken at Read Committed
   versus Repeatable Read?
5. Given a snapshot `5180:5186:5182` and a tuple with `xmin=5100, xmax=5182`,
   is it visible? Explain.
6. "An `UPDATE` is really an insert." Name three consequences.
7. What is a dead tuple, and what exactly is bloat? Name three ways bloat slows
   queries.

---

> **➡️ Continued in [Part 2](./03-mvcc-part-2.md)**

---

## Related

- [Part 2](03-mvcc-part-2.md) — `VACUUM`, HOT updates, the slow `count(*)`,
  long-running transactions, and transaction id wraparound.
- [Isolation Levels and Anomalies](02-isolation-levels-and-anomalies-part-1.md)
  — snapshots are how isolation levels are implemented.
- [Locks](04-locks-part-1.md) — the one case MVCC does not solve: two writers,
  one row.
- [Transactions and ACID](01-transactions-and-acid-part-1.md) — why rollback is
  cheap here.
- [bulk-write-performance](../query-patterns/bulk-write-performance.md) — why
  updating every row of a table is an expensive idea.
