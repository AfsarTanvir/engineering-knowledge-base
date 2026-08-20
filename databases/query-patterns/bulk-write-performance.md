# Bulk Insert/Update/Upsert Performance

Writing rows one at a time in a loop pays a full network round trip, and
often a full transaction/log flush, for every single row. Batching writes
into fewer, larger statements is frequently a 10x-100x win with no schema
changes at all — it's the write-side equivalent of fixing
[N+1 queries](../query-optimization/n-plus-one-queries.md) on the read side.

## Table of Contents

1. [Why Row-by-Row Writes Are Slow](#why-row-by-row-writes-are-slow)
2. [Multi-Row INSERT](#multi-row-insert)
3. [MySQL: Bulk Write Techniques](#mysql-bulk-write-techniques)
4. [PostgreSQL: Bulk Write Techniques](#postgresql-bulk-write-techniques)
5. [Bulk Updates Without a Per-Row Loop](#bulk-updates-without-a-per-row-loop)
6. [Upserts at Scale](#upserts-at-scale)
7. [Batch Size and Transaction Trade-offs](#batch-size-and-transaction-trade-offs)
8. [Dropping Indexes for Huge Loads](#dropping-indexes-for-huge-loads)
9. [Quick Reference](#quick-reference)

---

## Why Row-by-Row Writes Are Slow

Each individual `INSERT`/`UPDATE` statement pays, on top of the actual write:

- A full network round trip between application and database.
- Statement parsing/planning (unless using a prepared statement).
- A transaction commit and log flush per statement, if running with
  per-statement autocommit.

10,000 single-row inserts at 1ms round-trip latency cost at least 10
seconds — regardless of how fast the underlying write itself is. The fix is
almost never "make the write faster"; it's "make fewer round trips."

## Multi-Row INSERT

The simplest, engine-agnostic fix — combine many rows into one statement:

```sql
-- Slow: 3 round trips, 3 commits (under autocommit)
INSERT INTO events (user_id, type) VALUES (1, 'login');
INSERT INTO events (user_id, type) VALUES (2, 'login');
INSERT INTO events (user_id, type) VALUES (3, 'login');

-- Fast: 1 round trip, 1 commit
INSERT INTO events (user_id, type) VALUES
  (1, 'login'),
  (2, 'login'),
  (3, 'login');
```

Works identically on MySQL and PostgreSQL. There's a sweet spot on batch
size — a few hundred to a couple thousand rows per statement is a reasonable
starting point; benchmark for your row width, since an enormous single
statement trades round-trip overhead for transaction/log bloat instead (see
[Batch Size and Transaction Trade-offs](#batch-size-and-transaction-trade-offs)).

---

## MySQL: Bulk Write Techniques

**`LOAD DATA INFILE`** is the fastest bulk-load path — it bypasses per-
statement SQL parsing entirely:

```sql
LOAD DATA INFILE '/tmp/events.csv'
INTO TABLE events
FIELDS TERMINATED BY ','
LINES TERMINATED BY '\n'
(user_id, type);
```

**Upsert via `INSERT ... ON DUPLICATE KEY UPDATE`:**

```sql
INSERT INTO inventory (sku, quantity)
VALUES ('ABC123', 10), ('DEF456', 5) AS new
ON DUPLICATE KEY UPDATE quantity = quantity + new.quantity;
```

The `AS new` row-alias syntax is available from MySQL 8.0.19; on older
versions use `VALUES(quantity)` instead (deprecated but still supported as
of 8.0, for backward compatibility).

**For very large one-time loads**, wrap batches in explicit transactions
rather than relying on per-statement autocommit, and consider dropping
secondary indexes before the load and recreating them after (see
[Dropping Indexes for Huge Loads](#dropping-indexes-for-huge-loads)).

---

## PostgreSQL: Bulk Write Techniques

**`COPY`** is the fastest bulk-load path — like MySQL's `LOAD DATA INFILE`,
it skips the SQL parser and per-row planning entirely:

```sql
COPY events (user_id, type) FROM '/tmp/events.csv' WITH (FORMAT csv);
```

From application code, drivers typically expose this as `COPY ... FROM
STDIN` (e.g., `copy_expert` in psycopg2) so rows can be streamed without
building a CSV file on disk first.

**Multi-row insert from an array parameter**, via `UNNEST`, avoids building
a giant SQL string for a large batch from application code:

```sql
INSERT INTO events (user_id, type)
SELECT * FROM UNNEST(
  ARRAY[1, 2, 3]::int[],
  ARRAY['login', 'login', 'login']::text[]
);
```

**Upsert via `ON CONFLICT`:**

```sql
INSERT INTO inventory (sku, quantity)
VALUES ('ABC123', 10), ('DEF456', 5)
ON CONFLICT (sku) DO UPDATE
SET quantity = inventory.quantity + EXCLUDED.quantity;
```

---

## Bulk Updates Without a Per-Row Loop

Instead of looping in application code and issuing one `UPDATE` per row,
update from a `VALUES` list (or a temp table, for very large sets) in a
single statement:

```sql
-- PostgreSQL
UPDATE inventory i
SET quantity = v.quantity
FROM (VALUES ('ABC123', 8), ('DEF456', 3)) AS v(sku, quantity)
WHERE i.sku = v.sku;
```

```sql
-- MySQL
UPDATE inventory i
JOIN (
  SELECT 'ABC123' AS sku, 8 AS quantity
  UNION ALL SELECT 'DEF456', 3
) v ON v.sku = i.sku
SET i.quantity = v.quantity;
```

For millions of rows, chunk this pattern (e.g., by primary-key range)
instead of one giant statement — it keeps transaction duration and lock
time bounded, and makes a failed batch cheap to retry.

---

## Upserts at Scale

A repeated key **within the same multi-row statement** doesn't behave like
two separate statements would:

- MySQL applies the duplicates sequentially — the final value wins, with no
  error.
- PostgreSQL raises `ON CONFLICT DO UPDATE command cannot affect row a
  second time` if the same conflict target (e.g., the same `sku`) appears
  twice in one statement.

Deduplicate the input batch (last-value-wins, or whatever your business
logic requires) before sending it, rather than relying on the database to
resolve in-batch duplicates for you.

---

## Batch Size and Transaction Trade-offs

| Too small (1 row)                     | Too large (millions of rows)                     |
| :---------------------------------------- | :----------------------------------------------------- |
| Round-trip overhead dominates — the original problem | Long-held locks, large transaction/WAL growth |
| Per-statement commit overhead              | Hard to retry cheaply on failure                        |
| —                                          | Risk of exhausting memory/temp space                    |

Wrap batches in explicit transactions instead of per-statement autocommit,
but commit periodically (e.g., every N batches) rather than holding one
multi-million-row transaction open for the entire load.

---

## Dropping Indexes for Huge Loads

For a genuinely large one-time load — an initial migration or a warehouse
backfill, not routine traffic — dropping secondary indexes before the load
and recreating them afterward can beat maintaining them incrementally row by
row. A single `CREATE INDEX` performs a sorted bulk build; N incremental
B-tree insertions during the load do more total work to reach the same end
state.

This is not worth it for routine or incremental writes — only for loads
large enough that index-maintenance cost during the write clearly dominates
in `EXPLAIN`/timing, not as a default habit.

---

## Quick Reference

| Task                          | MySQL                              | PostgreSQL                          |
| :------------------------------ | :------------------------------------ | :--------------------------------------- |
| Fastest bulk load from a file    | `LOAD DATA INFILE`                    | `COPY`                                    |
| Multi-row insert from app code   | Multi-row `VALUES (...), (...), ...`  | Multi-row `VALUES` or `UNNEST(array...)`  |
| Upsert                          | `INSERT ... ON DUPLICATE KEY UPDATE`  | `INSERT ... ON CONFLICT DO UPDATE`        |
| Bulk update by key               | `UPDATE ... JOIN (derived table)`     | `UPDATE ... FROM (VALUES ...)`            |
| Duplicate key within one batch   | Last value wins, no error             | Errors — dedupe the batch first           |

**Bottom line:** batch writes into fewer, larger statements, wrap them in
explicit (but periodically committed) transactions, and reach for
`COPY`/`LOAD DATA INFILE` for genuinely large one-time loads.
