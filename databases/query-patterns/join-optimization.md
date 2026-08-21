# JOIN Optimization & Join Order

The order tables are actually joined in has nothing to do with the order you
wrote them in the `FROM`/`JOIN` clauses — the optimizer is free to reorder
unless something blocks it. Pick (or let the optimizer pick) a bad order and
a query built entirely from indexed, well-filtered tables can still scan
millions of rows it never needed to touch.

## Table of Contents

1. [What Join Order Means](#what-join-order-means)
2. [How the Optimizer Chooses](#how-the-optimizer-chooses)
3. [MySQL: Join Order and EXPLAIN](#mysql-join-order-and-explain)
4. [PostgreSQL: Join Order and EXPLAIN](#postgresql-join-order-and-explain)
5. [Join Algorithms in Brief](#join-algorithms-in-brief)
6. [Common Anti-Patterns](#common-anti-patterns)
7. [When to Force Join Order Manually](#when-to-force-join-order-manually)
8. [Trade-offs](#trade-offs)
9. [Quick Reference](#quick-reference)

---

## What Join Order Means

```sql
SELECT o.id, c.name
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE c.country = 'DK';
```

Written left-to-right this looks like "start at `orders`, then find each
customer." The optimizer might do the opposite: filter `customers` down to
just Danish customers first (a handful of rows), then look up their orders
one by one. Same result set, wildly different amount of work.

If `orders` has 10 million rows and only 200 customers are in Denmark,
starting from `customers` and driving into `orders` is the entire
difference between reading 200 rows and reading 10 million.

## How the Optimizer Chooses

Join order is a **cost-based** decision — the optimizer estimates the cost
of several candidate orders/algorithms and picks the cheapest one, using:

- **Table statistics** — row counts and column cardinality from `ANALYZE`.
  Stale statistics are the single most common reason a *good* optimizer
  picks a *bad* order.
- **Available indexes** on the join columns — without one, the "inner" side
  of a join can't be looked up cheaply, no matter how the tables are ordered.
- **Selectivity of filters** — the table that ends up smallest after its own
  `WHERE` conditions is usually the best candidate to drive from.

The table scanned first is usually called the **driving table**; everything
else is looked up relative to it.

---

## MySQL: Join Order and EXPLAIN

MySQL's optimizer evaluates join order permutations (bounded by
`optimizer_search_depth`) and reports its choice in `EXPLAIN`, one row per
table in the chosen order:

```sql
EXPLAIN SELECT o.id, c.name
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE c.country = 'DK';
```

| id  | table | type   | key         | rows | Extra       |
| :-- | :---- | :----- | :---------- | :--- | :---------- |
| 1   | c     | ref    | idx_country | 200  | Using where |
| 1   | o     | ref    | idx_cust_id | 12   |              |

Read top-to-bottom: `c` (customers) is the driving table here, and `o`
(orders) is looked up via `idx_cust_id` for each matching customer — exactly
the cheap plan. A `type = ALL` on either row means that table is being
full-scanned; check for a missing index on the join column first.

**Forcing order:** if the optimizer picks badly (usually from stale
statistics or an unusual data skew), `STRAIGHT_JOIN` forces left-to-right
evaluation:

```sql
SELECT STRAIGHT_JOIN o.id, c.name
FROM customers c
STRAIGHT_JOIN orders o ON o.customer_id = c.id
WHERE c.country = 'DK';
```

Run `ANALYZE TABLE orders, customers;` first — it fixes far more bad plans
than a manual hint does.

---

## PostgreSQL: Join Order and EXPLAIN

Postgres exhaustively considers join orders for queries below
`join_collapse_limit` (default 8 tables); beyond that it switches to a
genetic algorithm (GEQO) that samples the search space instead of exploring
it fully. `EXPLAIN ANALYZE` shows both the chosen order and the algorithm at
each step:

```sql
EXPLAIN ANALYZE
SELECT o.id, c.name
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE c.country = 'DK';
```

```
Nested Loop  (cost=4.29..312.10 rows=210 width=40) (actual time=0.05..1.20 rows=205 loops=1)
  ->  Index Scan using idx_country on customers c
        (cost=0.29..8.50 rows=200 width=24) (actual time=0.03..0.18 rows=205 loops=1)
  ->  Index Scan using idx_cust_id on orders o
        (cost=0.42..1.50 rows=12 width=16) (actual time=0.004..0.005 rows=12 loops=205)
Planning Time: 0.15 ms
Execution Time: 1.35 ms
```

`customers` (filtered to 205 rows) drives the loop; `orders` is probed once
per customer via its index. Postgres has no direct "force this join order"
hint built in — the usual levers are updating statistics
(`ANALYZE customers, orders;`), adding the missing index, or (for genuinely
pathological cases) the third-party `pg_hint_plan` extension.

---

## Join Algorithms in Brief

Join order and join *algorithm* are tied together — the right order only
pays off if the algorithm matches it (see
[join-algorithms.md](../query-planner/join-algorithms.md) for the full
treatment):

| Algorithm       | Best when                                                    | Cost shape                          |
| :---------------- | :--------------------------------------------------------------- | :--------------------------------------- |
| Nested Loop      | Outer side is small/filtered; inner side has a usable index      | outer rows × inner index lookup cost      |
| Hash Join        | Larger equi-joins, no usable index on one side                   | build a hash table on the smaller input, probe with the other |
| Merge Join       | Both inputs already sorted on the join key (e.g., via an index)  | roughly linear in both input sizes        |

A Nested Loop with an unindexed inner table degrades to "full scan of the
inner table, once per outer row" — the worst case, and the most common
reason a join that looked fine in dev falls over in production once the
inner table grows.

---

## Common Anti-Patterns

- **Missing index on the join column** — forces a Nested Loop to full-scan
  the inner table per outer row, or forces a Hash Join to rebuild a large
  hash table that a Merge Join could have avoided.
- **Function applied to the join column** — `ON LOWER(a.email) = b.email`
  can't use an index on `email` unless a matching functional index exists;
  every inner lookup degrades to a full scan.
- **Implicit cross join** — comma-style joins with a missing or wrong `ON`/
  `WHERE` condition silently produce a cartesian product:

  ```sql
  -- Missing join condition — every row in orders paired with every customer
  SELECT * FROM orders, customers;
  ```

- **Mismatched column types** — joining an `INT` column to a `VARCHAR`
  column forces an implicit cast on every row, which usually defeats the
  index on the cast side.
- **Filtering after a 1-to-many join** — joining orders to line items and
  then filtering in the outer query processes every duplicated row before
  the filter runs; push the filter into a subquery/CTE first when possible.

---

## When to Force Join Order Manually

- Statistics are stale and you can't run `ANALYZE` immediately (e.g., mid-
  incident, on a huge table where `ANALYZE` itself is slow).
- A query has more joins than the optimizer's search depth /
  `join_collapse_limit` can exhaustively evaluate, and the heuristic plan is
  visibly wrong in `EXPLAIN`.
- You've confirmed — with `EXPLAIN`, not guesswork — that the optimizer's
  chosen order is worse than a specific alternative.

Re-check forced orders periodically: a hint that was correct at today's data
volume can become wrong as tables grow or shrink, and nothing will warn you
when it does.

---

## Trade-offs

Manual join-order hints (`STRAIGHT_JOIN`, restructuring a query to bias the
planner) fight future changes to your data — the "optimal" order moves as
row counts and skew change, but a hardcoded hint doesn't move with it.
Fixing statistics and indexes solves the underlying problem more durably
than fixing the symptom in one query.

---

## Quick Reference

| Task                          | MySQL                                   | PostgreSQL                                              |
| :------------------------------ | :----------------------------------------- | :---------------------------------------------------------- |
| See chosen join order/algorithm | `EXPLAIN` → row order + `type` column      | `EXPLAIN ANALYZE` → node order + Nested Loop/Hash Join/Merge Join |
| Force join order                | `STRAIGHT_JOIN`                            | No native hint — fix stats/indexes, or use `pg_hint_plan`     |
| Missing index symptom           | `type = ALL` on the inner table            | Nested Loop with a large `loops` count and no Index Scan below it |
| Refresh statistics              | `ANALYZE TABLE t;`                         | `ANALYZE t;`                                                  |
| Many-join queries                | Bounded by `optimizer_search_depth`        | Bounded by `join_collapse_limit` (default 8), then GEQO       |

**Bottom line:** the driving table should be whichever side of the join is
smallest after its own filters, and every subsequent lookup needs an index
to stay cheap. Fix that first — reach for a manual hint only after `EXPLAIN`
proves the optimizer's own choice is wrong.
