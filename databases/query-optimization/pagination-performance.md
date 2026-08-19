# Pagination Performance: OFFSET vs Cursor (Keyset)

The pagination method most people reach for first — `LIMIT`/`OFFSET` — gets
linearly slower as users page deeper, because the database still has to walk
past every skipped row. Cursor-based (keyset) pagination avoids that entirely
by jumping straight to where the last page left off.

## Table of Contents

1. [The Problem with OFFSET](#the-problem-with-offset)
2. [Cursor (Keyset) Pagination](#cursor-keyset-pagination)
3. [MySQL: Implementation](#mysql-implementation)
4. [PostgreSQL: Implementation](#postgresql-implementation)
5. [Handling Ties and Stable Sort Order](#handling-ties-and-stable-sort-order)
6. [When OFFSET Is Still Fine](#when-offset-is-still-fine)
7. [Quick Reference](#quick-reference)

---

## The Problem with OFFSET

```sql
-- Page 1
SELECT * FROM orders ORDER BY id LIMIT 20 OFFSET 0;

-- Page 500 (users near the end of a long list)
SELECT * FROM orders ORDER BY id LIMIT 20 OFFSET 9980;
```

`OFFSET 9980` doesn't teleport to row 9980 — the database still scans and
discards 9,980 rows to get there, every single time, on every request. The
deeper the page, the more wasted work:

| Page  | Rows Scanned & Discarded | Rows Returned |
| :------ | :--------------------------- | :--------------- |
| 1     | 0                              | 20                |
| 50    | 980                             | 20                |
| 500   | 9,980                           | 20                |
| 5,000 | 99,980                          | 20                |

Cost grows linearly with page depth even though every page returns the same
20 rows. On a large, frequently-paginated table, deep pages can take
seconds while page 1 takes milliseconds.

There's a second, subtler problem: if rows are inserted or deleted between
page loads, `OFFSET`-based paging can skip or duplicate rows for the user,
since "row number 9980" shifts as the underlying data changes.

---

## Cursor (Keyset) Pagination

Instead of "skip N rows," a cursor says "give me rows *after* the last one
I saw." That's a direct index lookup, not a scan-and-discard — cost stays
flat regardless of page depth.

```sql
-- Page 1
SELECT * FROM orders ORDER BY id LIMIT 20;
-- Client remembers the last id returned, e.g. 1020

-- "Page 2" — no OFFSET, just continue from the cursor
SELECT * FROM orders WHERE id > 1020 ORDER BY id LIMIT 20;
```

Requires an index on the sort/cursor column (`id` here) — which most
primary-key or `created_at`-ordered feeds already have.

| Page  | Rows Scanned | Rows Returned |
| :------ | :-------------- | :--------------- |
| 1     | 20                | 20                |
| 50    | 20                | 20                |
| 500   | 20                | 20                |
| 5,000 | 20                | 20                |

Flat cost at any depth — and immune to the skip/duplicate problem, since
each page is anchored to a real value, not a row count.

**Trade-off:** you lose the ability to jump to an arbitrary page number
("go to page 47") — cursors only support "next" and "previous," not
random access. Fine for infinite-scroll feeds and APIs; not a drop-in
replacement for a page-number UI.

---

## MySQL: Implementation

```sql
-- Index the cursor column (id here is already the primary key)
-- For a non-PK cursor column, index it explicitly:
CREATE INDEX idx_orders_created ON orders (created_at, id);

-- First page
SELECT id, created_at, total_amount FROM orders
ORDER BY created_at DESC, id DESC
LIMIT 20;

-- Next page — pass the last row's (created_at, id) back as the cursor
SELECT id, created_at, total_amount FROM orders
WHERE (created_at, id) < ('2025-06-01 10:00:00', 1020)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

Row-value comparison `(created_at, id) < (...)` (MySQL 8.0+) correctly
handles ties on `created_at` by falling back to `id` — see
[Handling Ties](#handling-ties-and-stable-sort-order) below.

Check it's using the index, not a filesort:

```sql
EXPLAIN SELECT id, created_at, total_amount FROM orders
WHERE (created_at, id) < ('2025-06-01 10:00:00', 1020)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

Look for `type = range` on `idx_orders_created` with no `Using filesort` in
`Extra`.

## PostgreSQL: Implementation

Same row-value comparison syntax works natively:

```sql
CREATE INDEX idx_orders_created ON orders (created_at, id);

-- First page
SELECT id, created_at, total_amount FROM orders
ORDER BY created_at DESC, id DESC
LIMIT 20;

-- Next page
SELECT id, created_at, total_amount FROM orders
WHERE (created_at, id) < ('2025-06-01 10:00:00', 1020)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

Verify with `EXPLAIN ANALYZE`:

```sql
EXPLAIN ANALYZE SELECT id, created_at, total_amount FROM orders
WHERE (created_at, id) < ('2025-06-01 10:00:00', 1020)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

```
Limit (cost=0.42..8.50 rows=20 width=48) (actual time=0.03..0.08 rows=20 loops=1)
  -> Index Scan Backward using idx_orders_created on orders
       Index Cond: (ROW(created_at, id) < ROW('2025-06-01 10:00:00', 1020))
```

`Index Scan` (not `Seq Scan`), with the row comparison inside `Index Cond`,
confirms the cursor lookup is going straight to the right spot.

---

## Handling Ties and Stable Sort Order

Sorting by a single non-unique column (like `created_at`, where many rows
can share the same timestamp) breaks simple cursor pagination — `WHERE
created_at > '...'` can skip or repeat rows that tie on that exact value.

**Fix: always pair the sort column with a unique tiebreaker** (usually the
primary key), both in the index and in the comparison:

```sql
-- Wrong — ties on created_at can cause skipped/duplicated rows
WHERE created_at > '2025-06-01 10:00:00'
ORDER BY created_at

-- Right — id breaks ties deterministically
WHERE (created_at, id) > ('2025-06-01 10:00:00', 1020)
ORDER BY created_at, id
```

This is why every example above carries `id` alongside `created_at` — it's
not optional once two rows can share a timestamp.

---

## When OFFSET Is Still Fine

Don't rewrite every paginated endpoint on principle:

- **Small tables** (a few thousand rows) — the scan cost is negligible
  regardless of offset depth.
- **Shallow pagination** — if users realistically never go past page 5-10,
  the wasted scan work never gets large enough to matter.
- **Need for random page access** — an admin table with a page-number
  jump control genuinely needs `OFFSET`; cursors can't do "jump to page 47."
- **Total count required** — cursor pagination still needs a separate
  `COUNT(*)` if you want to show "1,234 results," so it doesn't remove that
  cost either way.

Reach for cursor pagination when the slow query log shows deep-page queries
getting slower with `OFFSET`, not preemptively.

---

## Quick Reference

| Aspect                      | OFFSET Pagination                  | Cursor (Keyset) Pagination         |
| :----------------------------- | :------------------------------------ | :------------------------------------ |
| Cost at deep pages             | Grows linearly with offset             | Flat, regardless of depth              |
| Jump to arbitrary page number  | Yes                                    | No — next/previous only                |
| Stable under concurrent writes | No — can skip/duplicate rows            | Yes, when paired with a unique tiebreaker |
| Implementation complexity      | Simple (`LIMIT`/`OFFSET`)               | Slightly more (compose the cursor tuple) |
| Requires index on sort column  | Helps, but doesn't fix the scan cost    | Required for the flat-cost benefit      |
| Best for                       | Small tables, admin UIs with page jump  | Infinite scroll, APIs, large tables     |

**Bottom line:** `OFFSET` is fine until page depth or table size makes the
discarded-row scan expensive — at that point, switch to a cursor keyed on
an indexed, unique-enough column (or column pair) instead of a row count.
