# Covering Indexes: Skip the Table, Read Only the Index

A covering index contains every column a query needs — the filter columns AND the
selected columns — so the database never has to jump to the actual table to fetch
data. It answers the query straight from the index.

## Table of Contents

1. [What Is a Covering Index?](#what-is-a-covering-index)
2. [Why It's Faster](#why-its-faster)
3. [MySQL: Covering Indexes](#mysql-covering-indexes)
4. [PostgreSQL: Covering Indexes](#postgresql-covering-indexes)
5. [When to Use Covering Indexes](#when-to-use-covering-indexes)
6. [Trade-offs](#trade-offs)
7. [Quick Reference](#quick-reference)

---

## What Is a Covering Index?

A normal index only helps the database *find* rows — it still has to look up the
actual table (a "bookmark lookup") to get columns that aren't in the index.

A covering index includes those extra columns too, so the lookup step is skipped
entirely.

```sql
-- Query
SELECT customer_id, order_date, total_amount
FROM orders
WHERE customer_id = 12345
AND order_date BETWEEN '2025-01-01' AND '2025-12-31';
```

- **Regular index** on `(customer_id, order_date)`: finds the matching rows fast,
  but still visits the table to fetch `total_amount`.
- **Covering index** on `(customer_id, order_date, total_amount)`: everything the
  query needs — filter columns and selected column — lives in the index itself.

## Why It's Faster

| Step                        | Regular Index                     | Covering Index          |
| :--------------------------- | :--------------------------------- | :----------------------- |
| Find matching rows          | Index scan                         | Index scan                |
| Fetch remaining columns     | Extra lookup into the table (I/O)  | Not needed                |
| Disk/page reads             | Index pages + table pages          | Index pages only          |
| Typical speedup             | Baseline                           | 2x–10x+ on large tables   |

Fewer page reads means less disk I/O and less memory churn — the bigger the table,
the bigger the win.

---

## MySQL: Covering Indexes

MySQL doesn't have special covering-index syntax. You get one automatically by
including every column the query touches — filters, joins, and the `SELECT`
list — in a composite index.

### Building One

```sql
-- Query to optimize
SELECT customer_id, order_date, total_amount, status
FROM orders
WHERE customer_id = 12345
AND order_date BETWEEN '2025-01-01' AND '2025-12-31';

-- Covering index: filter columns first, then selected columns
CREATE INDEX idx_orders_covering
ON orders (customer_id, order_date, total_amount, status);
```

**Column order rule of thumb:** equality filters first, then range filters, then
the remaining `SELECT` columns.

### Verifying It Worked

```sql
EXPLAIN SELECT customer_id, order_date, total_amount, status
FROM orders
WHERE customer_id = 12345
AND order_date BETWEEN '2025-01-01' AND '2025-12-31';
```

| id  | table  | type  | key                 | rows | Extra        |
| :-- | :----- | :---- | :------------------ | :--- | :----------- |
| 1   | orders | range | idx_orders_covering | 45   | Using index  |

**`Extra = Using index`** is the tell — MySQL answered the query from the index
alone, never touching the table.

If `Extra` instead says `Using index condition` or is blank, the index doesn't
cover all the selected columns — go back and add the missing ones.

### Common Mistake: `SELECT *`

```sql
-- This can NEVER be covered — * pulls every column, forcing a table lookup
SELECT * FROM orders WHERE customer_id = 12345;
```

Covering indexes only work when you `SELECT` the exact columns you need.
`SELECT *` defeats the purpose.

---

## PostgreSQL: Covering Indexes

PostgreSQL has two ways to build one: bundle everything into the index key
(same as MySQL), or use `INCLUDE` (PostgreSQL 11+) to attach extra columns
without making them part of the search key.

### Option 1: All Columns in the Key (any version)

```sql
CREATE INDEX idx_orders_covering
ON orders (customer_id, order_date, total_amount, status);
```

Works, but every included column also gets sorted and takes part in uniqueness
checks — wasted effort for columns you only ever `SELECT`, never filter on.

### Option 2: `INCLUDE` (PostgreSQL 11+, recommended)

```sql
CREATE INDEX idx_orders_covering
ON orders (customer_id, order_date)
INCLUDE (total_amount, status);
```

- `(customer_id, order_date)` — the actual search/sort key
- `INCLUDE (total_amount, status)` — extra payload, stored in the index but not
  used for searching or sorting

This keeps the index smaller and the key itself narrower, while still avoiding
the table lookup.

### Verifying It Worked

```sql
EXPLAIN ANALYZE
SELECT customer_id, order_date, total_amount, status
FROM orders
WHERE customer_id = 12345
AND order_date BETWEEN '2025-01-01' AND '2025-12-31';
```

```
Index Only Scan using idx_orders_covering on orders
  (cost=0.42..8.50 rows=45 width=32) (actual time=0.08..0.15 rows=45 loops=1)
  Index Cond: ((customer_id = 12345) AND (order_date >= '2025-01-01'::date)
               AND (order_date <= '2025-12-31'::date))
Planning Time: 0.09 ms
Execution Time: 0.21 ms
```

**`Index Only Scan`** is the tell — Postgres never visited the table (`orders`
heap), just the index.

### The Visibility Map Catch

Postgres can only fully skip the table if it knows the rows are visible to your
transaction (no uncommitted changes to check). It tracks this in the
**visibility map**, updated by `VACUUM`.

If a table isn't vacuumed often, you may see `Index Scan` (with a `Heap
Fetches` count) instead of a true `Index Only Scan`, even with an `INCLUDE`
index in place:

```sql
-- Check heap fetches — should be low/zero on a healthy Index Only Scan
EXPLAIN (ANALYZE, BUFFERS)
SELECT customer_id, order_date, total_amount FROM orders
WHERE customer_id = 12345;

-- Force the visibility map up to date
VACUUM orders;
```

---

## When to Use Covering Indexes

Good candidates:

- **High-frequency read queries** — dashboards, API endpoints hit thousands of
  times a day
- **Narrow `SELECT` lists** — 2-5 specific columns, not `SELECT *`
- **Large tables** — the I/O savings from skipping table lookups scale with
  table size
- **Reporting queries** — aggregations over a known, fixed set of columns

Poor candidates:

- Queries that already `SELECT *` or need most of the table's columns
- Rarely-run queries — the extra index isn't worth the write overhead
- Tables with heavy `UPDATE` traffic on the included columns (see trade-offs)

---

## Trade-offs

Covering indexes aren't free:

- **Bigger index** — every included column adds to index size on disk
- **Slower writes** — `INSERT`/`UPDATE`/`DELETE` must maintain the extra
  columns in the index too
- **Update churn** — if an `INCLUDE`d or covered column changes often, the
  index entry has to be rewritten on every update, eroding the benefit

**Rule:** only cover columns that are read far more often than they're
written. If `total_amount` changes on every order update, covering it may cost
more than it saves.

---

## Quick Reference

| Task                                   | MySQL                                                        | PostgreSQL                                                    |
| :-------------------------------------- | :------------------------------------------------------------ | :--------------------------------------------------------------- |
| Create a covering index                | `CREATE INDEX idx ON t(a, b, c, d);`                           | `CREATE INDEX idx ON t(a, b) INCLUDE (c, d);`                     |
| Minimum version for `INCLUDE`-style     | N/A (all columns share the key)                                | PostgreSQL 11+                                                   |
| Confirm it's working                    | `EXPLAIN` → `Extra = Using index`                              | `EXPLAIN ANALYZE` → `Index Only Scan`                             |
| Common blocker                          | `SELECT *` forces a table lookup                               | Stale visibility map forces heap fetches — run `VACUUM`           |
| Column order rule                       | Equality filters → range filters → selected columns            | Key columns (filter/sort) first, payload columns in `INCLUDE`     |

**Bottom line:** a covering index trades write speed and disk space for read
speed. Reach for one when a specific, high-traffic query is doing table
lookups it doesn't need to.
