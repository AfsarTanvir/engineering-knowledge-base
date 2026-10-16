# SQL Basics: CRUD — Part 2

Part 1 covered reading rows — `SELECT`, the logical order of evaluation,
filtering — and creating them with `INSERT`. This part covers the statements
that change or remove data: `UPDATE`, `DELETE` and upserts, plus existence
checks, the `psql` commands worth memorising, and set operations.

> **⬅️ This continues [Part 1](./03-sql-basics-crud-part-1.md).**

> **📌 In one line:** every statement here can destroy data, so the routine is
> always the same — prove the `WHERE` clause with a `SELECT` first, then run it
> inside a transaction.

## Table of Contents

1. [UPDATE and DELETE Without Regret](#update-and-delete-without-regret)
2. [UPSERT: INSERT ... ON CONFLICT](#upsert-insert--on-conflict)
3. [Does This Row Exist?](#does-this-row-exist)
4. [Practical psql](#practical-psql)
5. [Advanced: Set Operations](#advanced-set-operations)
6. [Common Mistakes](#common-mistakes)
7. [Questions to Test Yourself](#questions-to-test-yourself)
8. [Related](#related)

---

## UPDATE and DELETE Without Regret

The syntax is small:

```sql
UPDATE tasks
SET    status = 'done'
WHERE  id = 3;

DELETE FROM notifications
WHERE  read_at < now() - interval '90 days';
```

`UPDATE` can set several columns, and can use the row's current values:

```sql
UPDATE invoices
SET    status  = 'paid',
       paid_at = now()
WHERE  id = 900
  AND  status <> 'paid';        -- guard: do not re-pay a paid invoice
```

### The horror case

```sql
-- ❌ The WHERE is on the next line you never typed.
UPDATE users SET role = 'admin';
```

```text
UPDATE 1842
```

Every user in every company is now an admin. There is no undo. The only
recoveries are a backup restore (losing everything since) or point-in-time
recovery, which most teams have never tested.

### The habit that prevents it

**Always run the `WHERE` clause as a `SELECT` first.** Write the filter, check
the rows, then change the verb.

```sql
-- Step 1: prove the filter.
SELECT id, email, role FROM users WHERE email = 'ana@acme.com';
```

```text
 id |    email     | role
----+--------------+--------
  1 | ana@acme.com | member
(1 row)
```

```sql
-- Step 2: same WHERE, now as an UPDATE.
UPDATE users SET role = 'admin' WHERE email = 'ana@acme.com';
```

```text
UPDATE 1
```

The row count is your second check. If you expected 1 and see 1842, something is
wrong — and if you were in a transaction, you can still walk away:

```sql
BEGIN;
UPDATE users SET role = 'admin';   -- oops
```

```text
UPDATE 1842
```

```sql
ROLLBACK;                          -- nothing happened
```

> **📌 Remember:** in `psql`, run destructive statements inside `BEGIN;` and
> only `COMMIT;` after the row count matches what you expected. It costs one
> extra line and it has saved more production data than any other habit in this
> file.

A third safety net for interactive sessions: `LIMIT` is not allowed on
`UPDATE`/`DELETE` in PostgreSQL, so scope by primary key instead:

```sql
DELETE FROM notifications
WHERE id IN (
    SELECT id FROM notifications
    WHERE read_at < now() - interval '90 days'
    LIMIT 10000
);
```

Deleting in batches like this also avoids one giant transaction holding locks
and bloating the write-ahead log.

---

## UPSERT: INSERT ... ON CONFLICT

"Insert it, or update it if it already exists." Everyone needs this, and
beginners usually write it as `SELECT`, then `if found UPDATE else INSERT` —
which is a race condition: two requests can both see "not found".

PostgreSQL does it atomically in one statement:

```sql
INSERT INTO users (company_id, email, name, role)
VALUES (1, 'ana@acme.com', 'Ana Ortiz', 'member')
ON CONFLICT (email) DO UPDATE
SET name = EXCLUDED.name,
    role = EXCLUDED.role
RETURNING id, (xmax = 0) AS was_inserted;
```

```text
 id | was_inserted
----+--------------
  1 | f
```

| Piece | Meaning |
|---|---|
| `ON CONFLICT (email)` | Which unique constraint or index to watch. It must exist |
| `EXCLUDED` | A pseudo-table holding the row you *tried* to insert |
| `DO UPDATE SET …` | What to change on the existing row |
| `DO NOTHING` | The other option: skip silently, no error |
| `xmax = 0` | A trick: true when the row was newly inserted |

`DO NOTHING` is perfect for idempotent writes:

```sql
INSERT INTO notifications (user_id, type)
VALUES (1, 'invoice_paid')
ON CONFLICT DO NOTHING;
```

You can also add a condition to the update, so you only overwrite when it makes
sense:

```sql
ON CONFLICT (email) DO UPDATE
SET name = EXCLUDED.name
WHERE users.name IS DISTINCT FROM EXCLUDED.name;
```

MySQL's equivalent is `INSERT ... ON DUPLICATE KEY UPDATE`, which watches *all*
unique keys rather than one you name.

---

## Does This Row Exist?

Three ways, and they are not equally fast.

```sql
-- 1. COUNT — worst. Scans every matching row to count them all.
SELECT count(*) > 0 FROM tasks WHERE project_id = 31;

-- 2. LIMIT 1 — good. Stops at the first match.
SELECT 1 FROM tasks WHERE project_id = 31 LIMIT 1;

-- 3. EXISTS — best, and says what you mean.
SELECT EXISTS (SELECT 1 FROM tasks WHERE project_id = 31);
```

```text
 exists
--------
 t
```

| Form | Work done | Use when |
|---|---|---|
| `count(*) > 0` | Reads **every** matching row | Never, for existence |
| `LIMIT 1` | Stops at the first match | Fine; slightly awkward in an ORM |
| `EXISTS` | Stops at the first match; the planner uses a semi-join | Always, for existence |

With 400,000 matching rows, `count(*)` reads 400,000 of them to answer a
yes/no question. `EXISTS` reads one.

`IN` and `EXISTS` are usually planned identically for the positive case, but
`NOT IN` is dangerous with nullable columns (file 02 and file 04). Default to
`EXISTS`/`NOT EXISTS`. The full comparison lives in
[subqueries-vs-joins-vs-ctes](../query-patterns/subqueries-vs-joins-vs-ctes.md).

---

## Practical psql

Connect:

```bash
psql "postgresql://app_user:secret@localhost:5432/saas_app"
```

The commands you will actually use:

| Command | What it does |
|---|---|
| `\l` | List databases |
| `\c saas_app` | Connect to another database |
| `\dt` | List tables in the search path |
| `\d tasks` | Describe a table: columns, types, indexes, constraints |
| `\d+ tasks` | The same plus storage, description, and sizes |
| `\di` | List indexes |
| `\dn` | List schemas |
| `\x` | Toggle expanded display — one column per line |
| `\timing` | Toggle timing of every statement |
| `\e` | Open the last query in your editor |
| `\i file.sql` | Run a file |
| `\copy tbl FROM 'f.csv' CSV HEADER` | Client-side bulk load |
| `\q` | Quit |

`\d` on a table is the fastest way to understand a schema you have inherited:

```text
saas_app=> \d tasks
                                   Table "public.tasks"
   Column    |           Type           | Nullable |           Default
-------------+--------------------------+----------+------------------------------
 id          | bigint                   | not null | generated always as identity
 project_id  | bigint                   | not null |
 assignee_id | bigint                   |          |
 title       | text                     | not null |
 status      | text                     | not null | 'todo'::text
 due_date    | date                     |          |
 created_at  | timestamp with time zone | not null | now()
Indexes:
    "tasks_pkey" PRIMARY KEY, btree (id)
    "tasks_project_id_status_idx" btree (project_id, status)
Foreign-key constraints:
    "tasks_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id)
```

`\x` rescues wide rows:

```text
saas_app=> \x
Expanded display is on.
saas_app=> SELECT * FROM invoices WHERE id = 900;
-[ RECORD 1 ]+---------------------------
id           | 900
company_id   | 1
amount_cents | 249900
status       | paid
issued_at    | 2026-09-01 00:00:00+00
paid_at      | 2026-09-04 10:22:31+00
```

`\timing` gives you a first, rough answer to "is this slow?":

```text
saas_app=> \timing
Timing is on.
saas_app=> SELECT count(*) FROM tasks;
 count
--------
 482911
Time: 218.443 ms
```

> **⚠️ Warning:** `\timing` includes network round trip and result formatting,
> and it measures one run against a possibly cold cache. For a real answer use
> `EXPLAIN (ANALYZE, BUFFERS)` —
> [reading-query-plans](../query-planner/reading-query-plans.md).

---

## Advanced: Set Operations

These combine the results of two `SELECT`s that have the same number of columns
with compatible types.

```sql
-- Everyone who is either an admin or has an unread notification
SELECT id, email FROM users WHERE role = 'admin'
UNION
SELECT u.id, u.email
FROM users u
JOIN notifications n ON n.user_id = u.id
WHERE n.read_at IS NULL;
```

| Operator | Result | Deduplicates? |
|---|---|---|
| `UNION` | Rows in either query | **Yes** |
| `UNION ALL` | Rows in either query | No |
| `INTERSECT` | Rows in both | Yes |
| `EXCEPT` | Rows in the first but not the second | Yes |

### UNION vs UNION ALL

`UNION` must remove duplicates, and to do that it must compare every row against
every other — in practice a sort or a hash of the entire combined result. That
is real CPU and memory, and it may spill to disk.

```text
-- UNION
HashAggregate  (cost=2891.20..2911.20 rows=2000 width=40)
                                       (actual time=41.9..43.6 rows=1980 loops=1)
  ->  Append  (cost=0.00..2841.20 rows=20000 width=40)
                                       (actual time=0.0..29.1 rows=20000 loops=1)
Execution Time: 46.220 ms

-- UNION ALL
Append  (cost=0.00..2841.20 rows=20000 width=40)
                                       (actual time=0.0..18.4 rows=20000 loops=1)
Execution Time: 21.884 ms
```

The `HashAggregate` node is the deduplication, and it is the whole difference.

> **💡 Tip:** use `UNION ALL` by default. Reach for `UNION` only when duplicates
> are genuinely possible *and* wrong. Most `UNION`s in real code are combining
> disjoint sets, so they pay for a deduplication that can never remove anything.

`ORDER BY` and `LIMIT` at the end apply to the whole combined result:

```sql
SELECT id, title, 'task' AS kind FROM tasks WHERE status = 'todo'
UNION ALL
SELECT id, name, 'project' FROM projects WHERE status = 'active'
ORDER BY kind, id
LIMIT 50;
```

### RETURNING inside a CTE — a preview

`RETURNING` can feed another statement when you wrap it in a CTE (`WITH`), which
makes multi-step writes atomic:

```sql
WITH new_project AS (
    INSERT INTO projects (company_id, name)
    VALUES (1, 'Q4 launch')
    RETURNING id
)
INSERT INTO tasks (project_id, title, status)
SELECT id, 'Kick-off meeting', 'todo' FROM new_project
RETURNING id;
```

One statement, one transaction, one round trip: the project and its first task
are created together or not at all. CTEs get their own file —
[CTEs and Window Functions](06-ctes-and-window-functions-part-1.md).

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| `SELECT`-then-`INSERT` to upsert | Race condition between the two | `INSERT ... ON CONFLICT` |
| `count(*) > 0` for existence | Reads every matching row | `EXISTS` |
| Running `UPDATE`/`DELETE` without checking the filter first | No undo | `SELECT` the same `WHERE` first, and wrap in `BEGIN` |
| `UNION` when duplicates are impossible | Pays for a sort or hash that removes nothing | `UNION ALL` |
| Trusting `\timing` as a benchmark | One cold run, includes network | `EXPLAIN (ANALYZE, BUFFERS)` |

---

## Questions to Test Yourself

1. Describe the safety routine for running an `UPDATE` in production, in three
   steps.
2. Write an upsert that inserts a user or updates their name, and explain what
   `EXCLUDED` refers to.
3. Rank `count(*) > 0`, `LIMIT 1` and `EXISTS` for an existence check, and say
   how much work each one does when 400,000 rows match.
4. Which `psql` command shows a table's indexes and foreign keys? Which one
   makes a wide row readable?
5. What exactly does `UNION` do that `UNION ALL` does not, and what does that
   cost show up as in a query plan?
6. Why does a `DELETE` with no `WHERE` clause still succeed, and what is the
   cheapest way to empty a whole table instead?

---

## Related

- [Part 1](./03-sql-basics-crud-part-1.md) — `SELECT`, the logical order of
  evaluation, filtering and `INSERT`.
- [Tables, Rows and Data Types](02-tables-rows-and-data-types-part-1.md) — NULL
  semantics that drive half of the filtering rules here.
- [Joins Explained](04-joins-explained-part-1.md) — the next file: pulling rows from
  more than one table.
- [Aggregations and Grouping](05-aggregations-and-grouping-part-1.md) — `GROUP BY` and
  `HAVING`, the two steps skipped over here.
- [reading-query-plans](../query-planner/reading-query-plans.md) — what to run
  instead of `\timing`.
