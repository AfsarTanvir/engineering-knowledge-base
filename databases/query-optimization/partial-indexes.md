# Partial Indexes: Index Only the Rows You Actually Query

A partial index covers a *subset of rows* in a table, chosen by a `WHERE`
condition on the index itself — not the query. Rows outside that condition
are never stored in the index at all.

> **Heads up:** this is a PostgreSQL feature. MySQL has no equivalent — see
> [MySQL: No Native Support](#mysql-no-native-support) for the real
> workarounds.

## Table of Contents

1. [What Is a Partial Index?](#what-is-a-partial-index)
2. [Why It's Smaller and Faster](#why-its-smaller-and-faster)
3. [PostgreSQL: Partial Indexes](#postgresql-partial-indexes)
4. [MySQL: No Native Support](#mysql-no-native-support)
5. [When to Use Partial Indexes](#when-to-use-partial-indexes)
6. [Trade-offs](#trade-offs)
7. [Quick Reference](#quick-reference)

---

## What Is a Partial Index?

A regular index has one entry per row in the table. A partial index only has
entries for rows matching a filter you define at index-creation time.

```sql
-- Most orders are 'completed'. Only 'pending' orders get checked repeatedly
-- by a background job — that's the only slice worth indexing fast.
CREATE INDEX idx_orders_pending
ON orders (created_at)
WHERE status = 'pending';
```

If the table has 10 million rows and only 5,000 are `pending`, this index
has 5,000 entries — not 10 million.

## Why It's Smaller and Faster

| Aspect                  | Full Index                         | Partial Index                     |
| :------------------------ | :----------------------------------- | :----------------------------------- |
| Entries                 | One per row                          | One per matching row only            |
| Index size on disk       | Scales with table size               | Scales with filtered subset only     |
| Write overhead           | Every INSERT/UPDATE touches it       | Only writes matching the condition   |
| Scan speed for that slice | Fast, but shares space with the rest | Faster — smaller, denser, more cache-friendly |

A smaller index fits in memory more easily and needs fewer page reads —
compounding the speedup on top of the smaller row count.

---

## PostgreSQL: Partial Indexes

### Building One

The `WHERE` clause goes on the index, separate from any `WHERE` clause the
query itself uses:

```sql
-- Index only pending orders
CREATE INDEX idx_orders_pending
ON orders (created_at)
WHERE status = 'pending';
```

For Postgres to use this index, the query's `WHERE` clause must **imply** the
index's condition:

```sql
-- Uses the partial index — the query's filter matches the index's filter
SELECT * FROM orders
WHERE status = 'pending'
ORDER BY created_at;

-- Does NOT use it — 'shipped' isn't covered by the index
SELECT * FROM orders
WHERE status = 'shipped'
ORDER BY created_at;
```

### Verifying It Worked

```sql
EXPLAIN ANALYZE
SELECT * FROM orders
WHERE status = 'pending'
ORDER BY created_at;
```

```
Index Scan using idx_orders_pending on orders
  (cost=0.28..45.10 rows=5000 width=64) (actual time=0.05..0.42 rows=5000 loops=1)
Planning Time: 0.08 ms
Execution Time: 0.51 ms
```

Compare the index size against a full index on the same column to see the
saving:

```sql
SELECT pg_size_pretty(pg_relation_size('idx_orders_pending'));
```

### Common Patterns

**Filtering out soft-deleted rows:**

```sql
CREATE INDEX idx_users_email_active
ON users (email)
WHERE deleted_at IS NULL;
```

**Enforcing uniqueness only within a subset (unique partial index):**

```sql
-- Only one 'active' subscription per user is allowed;
-- past/cancelled subscriptions don't need to be unique
CREATE UNIQUE INDEX idx_one_active_subscription
ON subscriptions (user_id)
WHERE status = 'active';
```

**Indexing a rare but hot status:**

```sql
CREATE INDEX idx_orders_failed
ON orders (created_at)
WHERE status = 'failed';
```

### Combine with `INCLUDE` for a Covering Partial Index

Partial indexes and [covering indexes](covering-indexes.md) stack — filter to
the rows you need, then include the columns you need, for a very small,
very fast index:

```sql
CREATE INDEX idx_orders_pending_covering
ON orders (created_at)
INCLUDE (customer_id, total_amount)
WHERE status = 'pending';
```

---

## MySQL: No Native Support

MySQL/InnoDB has no `CREATE INDEX ... WHERE ...` syntax. Every index covers
every row in the table — there's no way to exclude rows at the index level.

Don't confuse this with MySQL's **prefix indexes**, which index only the
first *N characters* of a column, not a subset of *rows*:

```sql
-- This indexes the first 10 characters of every row's `email` column.
-- It is NOT a partial index — every row is still represented.
CREATE INDEX idx_email_prefix ON users (email(10));
```

### Workarounds

**1. Generated column + index**

Compute a flag column and index that instead — doesn't shrink the index, but
lets you filter cheaply:

```sql
ALTER TABLE orders
ADD COLUMN is_pending BOOLEAN
GENERATED ALWAYS AS (status = 'pending') STORED;

CREATE INDEX idx_orders_is_pending ON orders (is_pending, created_at);
```

This still indexes every row (including `is_pending = false` ones), so it
doesn't save disk space or write overhead the way Postgres's partial index
does — it only helps the query planner pick a narrower path.

**2. Separate table for the hot subset**

For a genuinely small, frequently-queried slice (e.g., `pending` orders),
some teams maintain a smaller dedicated table (updated via triggers or
application code) instead of indexing the whole thing:

```sql
CREATE TABLE pending_orders (
  order_id BIGINT PRIMARY KEY,
  created_at TIMESTAMP,
  INDEX (created_at)
);
```

This adds real complexity (keeping it in sync) — only worth it when the
full-table index is measurably a problem.

**3. Just use a full index and move on**

If the filtered subset isn't a large fraction of the table's writes or size,
a normal composite index (`status, created_at`) is often good enough. Don't
reach for workarounds 1 or 2 without measuring first.

---

## When to Use Partial Indexes

Good candidates (PostgreSQL):

- A status/flag column where one value is rare but frequently queried
  (`pending`, `failed`, `active`)
- Excluding soft-deleted or archived rows from an otherwise-hot index
- Uniqueness constraints that should only apply to a subset of rows
- Large tables where the full index would be mostly dead weight

Poor candidates:

- The filtered condition matches most of the table — savings are minimal
- Queries filter on values the index condition doesn't cover — Postgres
  won't use it, and you'll pay maintenance cost for nothing
- MySQL environments — evaluate the workarounds above instead

---

## Trade-offs

- **Query must match the condition** — Postgres can only use a partial
  index when it can prove the query's filter implies the index's filter.
  Slight mismatches (different literal, different casing, `!=` vs `<>`)
  can cause the planner to skip it.
- **One more index to maintain** — still adds write overhead on inserts/
  updates that match the condition, just less than a full index would.
- **Less obvious to future readers** — a partial index's behavior isn't
  visible from the query alone; document why it exists.

---

## Quick Reference

| Task                                  | PostgreSQL                                              | MySQL                                                  |
| :--------------------------------------- | :--------------------------------------------------------- | :--------------------------------------------------------- |
| Native partial index syntax             | `CREATE INDEX idx ON t(col) WHERE condition;`               | Not supported                                               |
| Unique constraint on a subset            | `CREATE UNIQUE INDEX ... WHERE condition;`                  | Not supported directly                                      |
| Closest workaround                       | N/A — native                                                | Generated column + index, or a separate hot-subset table    |
| Confirm it's used                        | `EXPLAIN ANALYZE` → `Index Scan using idx_name`             | N/A                                                          |
| Check index size                        | `pg_size_pretty(pg_relation_size('idx_name'))`              | `SHOW TABLE STATUS` (whole-index size only, no subsetting)  |

**Bottom line:** in PostgreSQL, reach for a partial index whenever a query
consistently filters on a rare value — it shrinks the index to just the rows
that matter. In MySQL, there's no direct equivalent; rely on composite
indexes and measure before reaching for a workaround.
