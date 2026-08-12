# Composite Index Column Ordering

A composite (multi-column) index isn't just "an index with more columns" —
column *order* determines which queries it can actually serve. Get the order
wrong and the index sits there, unused, while still slowing down every write.

## Table of Contents

1. [The Leftmost-Prefix Rule](#the-leftmost-prefix-rule)
2. [The Ordering Rule of Thumb](#the-ordering-rule-of-thumb)
3. [Worked Example](#worked-example)
4. [MySQL: Verifying Column Order](#mysql-verifying-column-order)
5. [PostgreSQL: Verifying Column Order](#postgresql-verifying-column-order)
6. [Sorting: Matching ORDER BY](#sorting-matching-order-by)
7. [Common Mistakes](#common-mistakes)
8. [Quick Reference](#quick-reference)

---

## The Leftmost-Prefix Rule

Both MySQL and PostgreSQL B-tree indexes can only be used from the left.
An index on `(a, b, c)` can serve queries filtering on:

- `a` alone
- `a` and `b`
- `a`, `b`, and `c`

It **cannot** efficiently serve a query filtering only on `b`, or only on
`c`, or `b` and `c` without `a` — the database has no way to jump into the
middle of the index.

```sql
CREATE INDEX idx_orders ON orders (customer_id, status, created_at);

-- Uses the index (leftmost columns present)
WHERE customer_id = 5
WHERE customer_id = 5 AND status = 'pending'
WHERE customer_id = 5 AND status = 'pending' AND created_at > '2025-01-01'

-- Does NOT use this index effectively
WHERE status = 'pending'
WHERE created_at > '2025-01-01'
WHERE status = 'pending' AND created_at > '2025-01-01'  -- customer_id missing
```

## The Ordering Rule of Thumb

When deciding column order, apply these in priority order:

1. **Equality columns first** — columns compared with `=` (`customer_id = 5`)
2. **Range/sort columns next** — columns compared with `>`, `<`, `BETWEEN`,
   or used in `ORDER BY`
3. **Selectivity as a tiebreaker** — among equality columns, the one that
   narrows the result set the most usually goes first (fewer matching rows
   to scan)

The reason range columns go *after* equality columns: once the index hits a
range condition, it can't use equality lookups on any column to its right
efficiently — the range "breaks" the ability to seek further. So put
everything that filters exactly before the one thing that filters as a
range.

## Worked Example

```sql
SELECT * FROM orders
WHERE customer_id = 12345
AND status = 'completed'
AND order_date BETWEEN '2025-01-01' AND '2025-12-31'
ORDER BY order_date;
```

Three candidate columns: `customer_id` (equality), `status` (equality),
`order_date` (range + sort).

**Good order:**

```sql
CREATE INDEX idx_orders_good
ON orders (customer_id, status, order_date);
```

- `customer_id` — equality, highly selective (narrows to one customer)
- `status` — equality, moderately selective
- `order_date` — range, goes last so the earlier equality lookups can still
  seek directly

**Bad order:**

```sql
CREATE INDEX idx_orders_bad
ON orders (order_date, customer_id, status);
```

Putting the range column (`order_date`) first means the index can only
narrow down by date, then has to scan every row in that date range checking
`customer_id` and `status` one by one — most of the index's selectivity is
wasted.

---

## MySQL: Verifying Column Order

`EXPLAIN` shows how much of the index MySQL could actually use via
`key_len` — bigger isn't always better, but a `key_len` that's shorter than
expected means fewer columns were used than you intended:

```sql
EXPLAIN SELECT * FROM orders
WHERE customer_id = 12345 AND status = 'completed'
AND order_date BETWEEN '2025-01-01' AND '2025-12-31';
```

| table  | type  | key              | key_len | rows | Extra       |
| :----- | :---- | :--------------- | :------ | :--- | :---------- |
| orders | range | idx_orders_good  | 137     | 45   | Using where |

`ref_or_range` covering all three columns confirms the full composite key is
in play. If `key_len` only reflects `customer_id`'s width, MySQL stopped
using the index after the first column — check whether a later column's
type or collation is blocking it (e.g., comparing a `VARCHAR` to a
different collation, or an implicit type cast).

## PostgreSQL: Verifying Column Order

```sql
EXPLAIN ANALYZE SELECT * FROM orders
WHERE customer_id = 12345 AND status = 'completed'
AND order_date BETWEEN '2025-01-01' AND '2025-12-31';
```

```
Index Scan using idx_orders_good on orders
  (cost=0.42..12.50 rows=45 width=64) (actual time=0.05..0.20 rows=45 loops=1)
  Index Cond: ((customer_id = 12345) AND (status = 'completed')
               AND (order_date >= '2025-01-01') AND (order_date <= '2025-12-31'))
```

All conditions appearing inside `Index Cond` (not `Filter`) means the whole
composite key is being used to narrow the scan. If a condition shows up
under a separate `Filter:` line instead, Postgres pulled those rows via the
index but had to check that condition row-by-row after the fact — a sign
the column order (or an unrelated data type mismatch) is limiting the index.

---

## Sorting: Matching ORDER BY

A composite index can satisfy `ORDER BY` for free — no separate sort step —
if the sort columns immediately follow the equality columns in the same
order (and direction) as the query requests:

```sql
CREATE INDEX idx_orders_sorted ON orders (customer_id, order_date);

SELECT * FROM orders
WHERE customer_id = 12345
ORDER BY order_date;   -- free sort, no filesort/Sort node
```

Mismatched sort direction across columns can still force a manual sort.
Both engines support per-column direction in the index definition:

```sql
-- MySQL 8.0+ and PostgreSQL both support this
CREATE INDEX idx_orders_mixed
ON orders (customer_id ASC, order_date DESC);
```

Check for `Using filesort` (MySQL) or a `Sort` node (PostgreSQL's `EXPLAIN`)
to know whether the index actually avoided the sort.

---

## Common Mistakes

**1. Ordering by "importance" instead of query shape.** `customer_id` might
feel like the most important column conceptually, but if most queries filter
by `status` alone without `customer_id`, it needs its own index — composite
order should follow how queries actually filter, not intuition.

**2. One composite index trying to serve every query.** A single index on
`(a, b, c)` doesn't help a query that only filters on `b`. That query needs
its own index (possibly just `(b)`), even if it means having multiple
indexes on overlapping columns.

**3. Redundant single-column index made obsolete by a composite.** An index
on `(customer_id)` alone is redundant once `(customer_id, status)` exists —
the composite already serves any query the single-column one could. Drop
the redundant one.

**4. Too many columns "just in case."** Every extra column adds write cost
and disk space (see [covering-indexes.md](covering-indexes.md) for the
related trade-off). Add columns because a real query needs them, not
preemptively.

---

## Quick Reference

| Situation                                    | Column order                                   |
| :---------------------------------------------- | :-------------------------------------------------- |
| Multiple equality filters                      | Most selective equality column first                |
| Equality + range filter                        | Equality column(s) first, range column last          |
| Equality filter + ORDER BY                     | Equality column(s) first, sort column(s) next, matching direction |
| Query skips the leftmost column entirely       | That query needs a separate index — composite order won't fix it |
| Query has a gap — misses a middle column       | Reorder so the skipped column sits to the right of the columns the query actually uses |
| ORDER BY direction doesn't match column order  | Add explicit `ASC`/`DESC` to the index definition, or reorder columns to match the sort |

**Bottom line:** equality columns go left, range/sort columns go right, and
selectivity breaks ties among equality columns. Verify with `EXPLAIN`
(`key_len` in MySQL, `Index Cond` vs `Filter` in PostgreSQL) — don't assume
column order is right just because the index exists.
