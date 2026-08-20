# Subqueries vs JOINs vs CTEs

Three ways to pull related data into one query, and they are not
interchangeable. A correlated subquery can run once per outer row, a CTE can
be an invisible "optimization fence" that blocks filters from being pushed
down into it, and a `JOIN` that looks equivalent to an `EXISTS` check can
quietly multiply rows you never wanted duplicated.

## Table of Contents

1. [The Three Shapes](#the-three-shapes)
2. [Correlated vs Uncorrelated Subqueries](#correlated-vs-uncorrelated-subqueries)
3. [IN vs EXISTS vs JOIN](#in-vs-exists-vs-join)
4. [MySQL: Subqueries and CTEs](#mysql-subqueries-and-ctes)
5. [PostgreSQL: Subqueries and CTEs](#postgresql-subqueries-and-ctes)
6. [When Each Wins](#when-each-wins)
7. [Common Mistakes](#common-mistakes)
8. [Trade-offs](#trade-offs)
9. [Quick Reference](#quick-reference)

---

## The Three Shapes

The same question — "which customers have placed an order?" — written three
ways:

```sql
-- Subquery (IN)
SELECT * FROM customers
WHERE id IN (SELECT customer_id FROM orders);

-- JOIN
SELECT DISTINCT c.*
FROM customers c
JOIN orders o ON o.customer_id = c.id;

-- CTE
WITH ordering_customers AS (
  SELECT DISTINCT customer_id FROM orders
)
SELECT c.*
FROM customers c
JOIN ordering_customers oc ON oc.customer_id = c.id;
```

All three can produce the same rows, but the engine doesn't necessarily
execute them the same way — and the `JOIN` version needs `DISTINCT` to avoid
duplicating a customer once per order, which the subquery and CTE versions
don't need at all since they're only checking membership.

## Correlated vs Uncorrelated Subqueries

**Uncorrelated** — the subquery doesn't reference anything from the outer
query, so it's conceptually evaluated once and reused:

```sql
SELECT * FROM customers
WHERE country IN (SELECT country FROM active_regions);
```

**Correlated** — the subquery references a column from the outer query, so
it's conceptually re-evaluated once per outer row:

```sql
SELECT c.*,
  (SELECT MAX(total) FROM orders o WHERE o.customer_id = c.id) AS biggest_order
FROM customers c;
```

Modern optimizers often rewrite simple correlated subqueries into a join
internally, but that's a best-effort transformation, not a guarantee —
always check `EXPLAIN` rather than assuming it happened.

---

## IN vs EXISTS vs JOIN

For a "does at least one match exist?" question, `EXISTS` states the intent
directly and lets the engine stop at the first match per row instead of
counting or collecting all matches:

```sql
SELECT * FROM customers c
WHERE EXISTS (
  SELECT 1 FROM orders o WHERE o.customer_id = c.id
);
```

`IN` with a subquery is usually rewritten by the optimizer into an
equivalent semi-join plan, so in practice it often performs the same as
`EXISTS` — but `NOT IN` is a trap (see [Common Mistakes](#common-mistakes)).

A plain `JOIN` answers a different question — "give me one row per match,"
not "does a match exist" — so using it for an existence check requires
`DISTINCT` or `GROUP BY` to undo the row multiplication a 1-to-many join
introduces. That's wasted work `EXISTS` never does in the first place.

---

## MySQL: Subqueries and CTEs

MySQL (5.6+) applies **semi-join transformations** to `IN`/`EXISTS`
subqueries, converting them into a join-like plan using strategies such as
materialization, `FirstMatch`, or `LooseScan`. Check which one was used with:

```sql
EXPLAIN FORMAT=JSON
SELECT * FROM customers c
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);
```

**CTEs** (`WITH`, added in MySQL 8.0) are non-recursive by default and are
**inlined/merged** into the surrounding query, much like a subquery or view —
they are not automatically materialized. If the same CTE is referenced more
than once in a query, MySQL may re-derive it for each reference rather than
computing it once:

```sql
WITH RECURSIVE org_chart AS (
  SELECT id, manager_id, 1 AS depth FROM employees WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, e.manager_id, oc.depth + 1
  FROM employees e JOIN org_chart oc ON e.manager_id = oc.id
)
SELECT * FROM org_chart;
```

`WITH RECURSIVE` is MySQL's only mechanism for hierarchical/graph traversal
queries — there's no other built-in way to do this.

---

## PostgreSQL: Subqueries and CTEs

Before PostgreSQL 12, **every CTE was an optimization fence** — always
materialized as its own step, regardless of how the outer query used it.
That's great when a CTE genuinely computes something expensive once and
reuses it, but a filter in the outer query (`WHERE` on a CTE column) could
not be pushed down into the fence, sometimes turning a "just for
readability" CTE into a real performance regression.

PostgreSQL 12+ **inlines** non-recursive CTEs referenced exactly once by
default, the same way a subquery would be — unless it has side effects (like
`INSERT ... RETURNING`) or you request otherwise. Force the behavior
explicitly when the default guess is wrong:

```sql
-- Force materialization: compute once, reuse as-is
WITH regional_sales AS MATERIALIZED (
  SELECT region, SUM(amount) AS total FROM sales GROUP BY region
)
SELECT * FROM regional_sales WHERE total > 10000;

-- Force inlining: let the outer WHERE push down into it
WITH recent_orders AS NOT MATERIALIZED (
  SELECT * FROM orders WHERE created_at > now() - interval '7 days'
)
SELECT * FROM recent_orders WHERE customer_id = 42;
```

`EXISTS`/`NOT EXISTS` typically compile down to a semi-join or anti-join
plan node, visible directly in `EXPLAIN`:

```
Nested Loop Semi Join  (cost=... )
```

---

## When Each Wins

- **`EXISTS`** — existence checks; you only care whether a match exists,
  never how many.
- **`JOIN`** — you need columns *from both* tables in the result, and a
  1-to-1 or many-to-1 relationship (no row multiplication to clean up).
- **`IN` with a small, static, or precomputed list** — reads cleanly and the
  optimizer handles it the same as `EXISTS` in most modern engines.
- **CTE** — a genuinely expensive computation reused multiple times
  (materialize it), or a readability win for a one-time reference where you
  want it inlined (Postgres 12+ default, or MySQL always).
- **Recursive CTE** — the only clean option for hierarchical/graph data
  (org charts, category trees, dependency graphs).

## Common Mistakes

- **`NOT IN` with a nullable subquery column** — if the subquery returns
  even one `NULL`, `NOT IN` returns **zero rows**, silently, because
  `x <> NULL` is unknown rather than true/false for every comparison:

  ```sql
  -- Returns NO rows if any order has a NULL customer_id
  SELECT * FROM customers
  WHERE id NOT IN (SELECT customer_id FROM orders);
  ```

  Use `NOT EXISTS` instead — it isn't affected by `NULL`s in the subquery.

- **Correlated subquery in the `SELECT` list** — runs once per outer row
  with no way for the optimizer to batch it, effectively a hidden N+1 inside
  a single SQL statement (see
  [n-plus-one-queries.md](../query-optimization/n-plus-one-queries.md) for
  the application-level version of the same problem).
- **Assuming a CTE is always materialized** — true pre-Postgres-12 and
  false after, unless you say so explicitly with `MATERIALIZED`/
  `NOT MATERIALIZED`.
- **`JOIN` + `DISTINCT` standing in for `EXISTS`** — on a 1-to-many
  relationship this duplicates rows and then pays to deduplicate them,
  instead of short-circuiting at the first match.

---

## Trade-offs

A CTE buys readability — naming an intermediate result instead of nesting
subqueries — at the cost of a materialization decision you may need to
override explicitly. `EXISTS`/semi-join patterns get most of a `JOIN`'s
performance without the row-multiplication cleanup a true `JOIN` requires
for existence checks.

---

## Quick Reference

| Question                                | Reach for                          |
| :----------------------------------------- | :-------------------------------------- |
| Does at least one match exist?             | `EXISTS`                                 |
| Does no match exist? (nullable column)     | `NOT EXISTS`, never `NOT IN`             |
| Need columns from both tables              | `JOIN`                                   |
| Expensive result, reused multiple times    | CTE with `MATERIALIZED` (PG) — default in MySQL/pre-PG12 |
| One-time-use CTE, want outer filter pushed down | CTE with `NOT MATERIALIZED` (PG 12+) |
| Hierarchical/graph traversal                | `WITH RECURSIVE`                         |

**Bottom line:** pick the shape that matches the question you're actually
asking — existence, combination, or reuse — rather than whichever one reads
most naturally, and confirm the engine's materialization/rewrite behavior in
`EXPLAIN` instead of assuming it.
