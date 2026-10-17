# Joins Explained — Part 2

Part 1 covered the join types themselves and the `ON`-versus-`WHERE` trap —
which rows survive a join. This part covers the other half: how many times each
row appears, why that quietly doubles totals, the join shapes that exist only to
test for existence, `LATERAL` for top-N-per-group, and how the planner actually
executes all of it.

> **⬅️ This continues [Part 1](./04-joins-explained-part-1.md).**

> **📌 In one line:** a join can return a row more than once, and every wrong
> total, wrong count and surprisingly slow plan in this file comes back to that.

## Table of Contents

1. [Row Multiplication and the Wrong Total](#row-multiplication-and-the-wrong-total)
2. [COUNT in a Joined Query](#count-in-a-joined-query)
3. [Semi-Joins and Anti-Joins](#semi-joins-and-anti-joins)
4. [LATERAL: Top N Per Group](#lateral-top-n-per-group)
5. [Advanced: How Joins Actually Run](#advanced-how-joins-actually-run)
6. [Common Mistakes](#common-mistakes)
7. [Questions to Test Yourself](#questions-to-test-yourself)
8. [Related](#related)

---

## Row Multiplication and the Wrong Total

This is the most valuable idea in the file, because it produces wrong numbers
rather than errors.

**Rule:** a join to a one-to-many relationship repeats the "one" side once per
match. One project with 3 tasks becomes 3 rows, each carrying a full copy of the
project's columns.

```text
projects × tasks (INNER JOIN)
 p_id |     p_name       | budget_cents | t_id
------+------------------+--------------+------
   31 | Website redesign |       500000 |    1
   31 | Website redesign |       500000 |    2    <- budget repeated
   31 | Website redesign |       500000 |    5    <- and again
```

Now aggregate over it and the duplication becomes arithmetic.

**The question:** total invoiced amount per company, along with how many
projects they have.

```sql
-- ❌ BROKEN — invoices fanned out by projects
SELECT c.name,
       count(DISTINCT p.id)  AS projects,
       sum(i.amount_cents)   AS total_cents
FROM companies c
JOIN projects p ON p.company_id = c.id
JOIN invoices i ON i.company_id = c.id
GROUP BY c.name;
```

```text
   name   | projects | total_cents
----------+----------+-------------
 Acme Ltd |        3 |      749700
```

Acme's real invoice total is 249,900 cents. The number reported is exactly 3×
that — once per project. Every invoice row was paired with every project row of
the same company, because the two joins are independent branches off
`companies`. There is no error message. The finance dashboard is simply wrong.

```sql
-- ✅ FIXED — aggregate each branch separately, then join the results
SELECT c.name,
       coalesce(p.project_count, 0) AS projects,
       coalesce(i.total_cents, 0)   AS total_cents
FROM companies c
LEFT JOIN (
    SELECT company_id, count(*) AS project_count
    FROM projects GROUP BY company_id
) p ON p.company_id = c.id
LEFT JOIN (
    SELECT company_id, sum(amount_cents) AS total_cents
    FROM invoices GROUP BY company_id
) i ON i.company_id = c.id
ORDER BY c.name;
```

```text
   name   | projects | total_cents
----------+----------+-------------
 Acme Ltd |        3 |      249900
```

Two other correct shapes:

```sql
-- Scalar subqueries — readable, fine for a handful of columns
SELECT c.name,
       (SELECT count(*) FROM projects p WHERE p.company_id = c.id) AS projects,
       (SELECT coalesce(sum(amount_cents), 0) FROM invoices i
         WHERE i.company_id = c.id) AS total_cents
FROM companies c;

-- sum(DISTINCT ...) — only valid because invoice amounts are unique per id;
-- it breaks the moment two invoices share an amount. Prefer the versions above.
```

> **📌 Remember:** the moment a query contains **two joins to different
> one-to-many tables plus an aggregate**, assume the numbers are wrong until you
> prove otherwise. Check by removing the aggregate and counting the raw rows.

---

## COUNT in a Joined Query

Three counts, three meanings. In a joined query the difference is not academic.

```sql
SELECT p.name,
       count(*)                  AS rows_after_join,
       count(t.id)               AS tasks,
       count(t.assignee_id)      AS assigned_tasks,
       count(DISTINCT t.assignee_id) AS distinct_assignees
FROM projects p
LEFT JOIN tasks t ON t.project_id = p.id
GROUP BY p.name
ORDER BY p.name;
```

```text
      name        | rows_after_join | tasks | assigned_tasks | distinct_assignees
------------------+-----------------+-------+----------------+--------------------
 Internal tools   |               1 |     0 |              0 |                  0
 Mobile app       |               1 |     1 |              1 |                  1
 Website redesign |               3 |     3 |              2 |                  2
```

| Form | Counts | Watch out |
|---|---|---|
| `count(*)` | **Rows**, including the NULL-filled row from a `LEFT JOIN` | "Internal tools" shows 1, not 0 |
| `count(col)` | Rows where `col` is **not NULL** | The correct choice after a `LEFT JOIN` |
| `count(DISTINCT col)` | Distinct non-NULL values | Correct, but needs a sort or hash — the most expensive |

The "Internal tools: 1 task" bug is `count(*)` after a `LEFT JOIN`, and it is
extremely common. Use `count(t.id)`.

---

## Semi-Joins and Anti-Joins

Sometimes you only want to know *whether* a match exists — not to bring back
its columns. Using a real join for that duplicates rows and forces you to
`DISTINCT` them away.

**Semi-join — "has at least one":**

```sql
-- ❌ Join + DISTINCT: builds every pair, then removes duplicates
SELECT DISTINCT u.id, u.name
FROM users u
JOIN tasks t ON t.assignee_id = u.id;

-- ✅ EXISTS: stops at the first match per user, no duplicates to remove
SELECT u.id, u.name
FROM users u
WHERE EXISTS (SELECT 1 FROM tasks t WHERE t.assignee_id = u.id);
```

In the plan this appears as a dedicated node:

```text
Hash Semi Join  (cost=412.00..1180.44 rows=1820 width=36)
                (actual time=3.1..9.7 rows=1791 loops=1)
  Hash Cond: (u.id = t.assignee_id)
```

`SELECT 1` inside `EXISTS` is convention — the column list is never evaluated.

**Anti-join — "has none":**

```sql
SELECT u.id, u.name
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.assignee_id = u.id);
```

### BROKEN vs FIXED: NOT IN with a nullable column

```sql
-- ❌ BROKEN — assignee_id is nullable
SELECT u.id, u.name
FROM users u
WHERE u.id NOT IN (SELECT t.assignee_id FROM tasks t);
```

```text
 id | name
----+------
(0 rows)
```

Zero rows, though many users have no tasks. `NOT IN (1, 2, NULL)` expands to
`id <> 1 AND id <> 2 AND id <> NULL`. That last comparison is *unknown*, so the
`AND` chain can never be true for any row. No error, no warning — an empty
result.

```sql
-- ✅ FIXED — NOT EXISTS is immune to NULLs
SELECT u.id, u.name
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM tasks t WHERE t.assignee_id = u.id
);
```

```text
 id | name
----+-------
  3 | Cleo
  7 | Dara
```

A `LEFT JOIN ... WHERE right.id IS NULL` is the other correct anti-join form and
plans similarly:

```sql
SELECT u.id, u.name
FROM users u
LEFT JOIN tasks t ON t.assignee_id = u.id
WHERE t.id IS NULL;
```

> **📌 Remember:** never use `NOT IN` against a subquery unless the column is
> `NOT NULL` **and** will stay that way. `NOT EXISTS` is always safe.

---

## LATERAL: Top N Per Group

"The 3 most recent tasks for each project" is awkward with plain joins: a normal
subquery in `FROM` cannot see the outer row.

`LATERAL` removes that restriction — the subquery may reference columns from
tables listed before it, and it runs once per outer row.

```sql
SELECT p.name AS project, t.title, t.created_at
FROM projects p
CROSS JOIN LATERAL (
    SELECT t.title, t.created_at
    FROM tasks t
    WHERE t.project_id = p.id          -- references the outer row
    ORDER BY t.created_at DESC
    LIMIT 3
) t
WHERE p.company_id = 1
ORDER BY p.name, t.created_at DESC;
```

```text
     project      |        title         |       created_at
------------------+----------------------+------------------------
 Mobile app       | Push notifications   | 2026-09-14 08:00:00+00
 Website redesign | Update pricing copy  | 2026-09-15 09:30:00+00
 Website redesign | Fix invoice rounding | 2026-09-12 16:05:00+00
 Website redesign | Ship billing page    | 2026-09-11 10:00:00+00
```

`CROSS JOIN LATERAL` drops projects with no tasks. Use
`LEFT JOIN LATERAL (...) t ON true` to keep them.

Why this is worth knowing: with an index on `tasks (project_id, created_at DESC)`
each iteration is a tiny index lookup that stops after 3 rows. The window-function
alternative (`ROW_NUMBER() OVER (PARTITION BY project_id ...)`, file 06) must rank
*every* task before discarding most of them. When each group is large and N is
small, `LATERAL` usually wins; when you need the ranking anyway, the window
function wins. Measure both.

`LATERAL` is also the clean way to call a set-returning function per row:

```sql
SELECT u.name, j.key, j.value
FROM users u,
     LATERAL jsonb_each_text(u.preferences) AS j(key, value);
```

MySQL added `LATERAL` in 8.0.14; older versions have no equivalent.

---

## Advanced: How Joins Actually Run

Everything above is *logical* — what result the join means. Physically,
PostgreSQL has three strategies, and it chooses per query based on cost
estimates:

| Algorithm | Rough idea | Favoured when |
|---|---|---|
| **Nested Loop** | For each outer row, look up matches in the inner table | Outer side is small and the inner side has a usable index |
| **Hash Join** | Build a hash table from the smaller side, probe with the other | Large unsorted inputs, equality conditions, enough `work_mem` |
| **Merge Join** | Sort both sides, walk them in step | Both inputs already sorted, e.g. by index order |

The planner also chooses the **join order**, which for a four-table join means
picking among many possible trees. It is not the order you typed.

```text
Hash Join  (cost=1.09..40.44 rows=3 width=96) (actual time=0.05..0.09 rows=3 loops=1)
  Hash Cond: (t.project_id = p.id)
  ->  Seq Scan on tasks t  (rows=4)
  ->  Hash  (rows=3)
        ->  Seq Scan on projects p  (rows=3)
```

That is as far as this file goes. The full treatment — how each algorithm works,
its memory behaviour, how to read the node, and when a nested loop over a
mis-estimated row count destroys a query — is in
[join-algorithms](../query-planner/join-algorithms.md). Making a specific slow
join fast (index choice, join order, pushing filters down) is
[join-optimization](../query-patterns/join-optimization.md). Neither is repeated
here.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Two joins to different one-to-many tables plus `SUM` | Row fan-out multiplies the totals | Aggregate each branch first, then join |
| `count(*)` after a `LEFT JOIN` | Counts the NULL-filled row as 1 | `count(right_table.id)` |
| `JOIN` + `DISTINCT` for an existence check | Builds all pairs, then removes them | `EXISTS` |
| `NOT IN (subquery)` on a nullable column | Returns zero rows, silently | `NOT EXISTS` |
| Assuming the written join order is the execution order | The planner reorders | Read `EXPLAIN` |

---

## Questions to Test Yourself

1. A query joins `companies` to both `projects` and `invoices` and sums
   `amount_cents`. Why is the total too big, and by what factor?
2. Give three correct ways to fix that fan-out.
3. What is the difference between `count(*)`, `count(t.id)` and
   `count(DISTINCT t.assignee_id)` after a `LEFT JOIN`?
4. Write a semi-join and an anti-join over `users` and `tasks`, and explain why
   `NOT IN` is unsafe for the second.
5. Write a `LATERAL` query for the 3 newest tasks per project. When would a
   window function be the better choice?
6. Name the three physical join algorithms and one situation favouring each.

---

## Related

- [Part 1](./04-joins-explained-part-1.md) — the join types, `ON` vs `WHERE`,
  multi-table joins and self joins.
- [Aggregations and Grouping](05-aggregations-and-grouping-part-1.md) — next file;
  where fan-out turns into wrong totals.
- [CTEs and Window Functions](06-ctes-and-window-functions-part-2.md) — the
  window-function alternative to `LATERAL`.
- [join-algorithms](../query-planner/join-algorithms.md) — how the planner
  physically executes a join and picks an order.
- [subqueries-vs-joins-vs-ctes](../query-patterns/subqueries-vs-joins-vs-ctes.md)
  — choosing between the three shapes.
