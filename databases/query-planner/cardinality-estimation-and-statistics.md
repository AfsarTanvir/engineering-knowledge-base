# Cardinality Estimation & Statistics

The optimizer never measures your data at plan time — it *guesses*, using
statistics collected earlier by `ANALYZE`. Every plan decision (join
algorithm, join order, index vs scan, hash vs sort) is downstream of one
number: **how many rows will this step produce?** Get that number wrong by
1000×, and a perfectly good optimizer confidently produces a terrible plan.

## Table of Contents

1. [Why Estimates Drive Everything](#why-estimates-drive-everything)
2. [What Statistics Actually Contain](#what-statistics-actually-contain)
3. [How Selectivity Is Computed](#how-selectivity-is-computed)
4. [Inspecting Statistics](#inspecting-statistics)
5. [The Six Ways Estimates Go Wrong](#the-six-ways-estimates-go-wrong)
6. [Diagnosing a Bad Estimate](#diagnosing-a-bad-estimate)
7. [Fixing Bad Estimates](#fixing-bad-estimates)
8. [Keeping Statistics Fresh](#keeping-statistics-fresh)
9. [Trade-offs](#trade-offs)
10. [Quick Reference](#quick-reference)

---

## Why Estimates Drive Everything

```sql
SELECT o.*, c.name
FROM orders o JOIN customers c ON c.id = o.customer_id
WHERE c.country = 'DK' AND c.tier = 'enterprise';
```

If the planner estimates 5 matching customers, a nested loop into `orders` is
obviously right: 5 index lookups. If the true answer is 50,000 customers, that
same plan runs 50,000 index lookups instead of one hash join — the query goes
from 2 ms to 4 minutes. Nothing about the SQL, indexes, or hardware changed.
Only the guess was wrong.

This is why estimate accuracy matters more than any individual tuning knob:

- **Row count** decides the join algorithm ([join-algorithms.md](join-algorithms.md))
- **Row count** decides the driving table in join order
- **Row count** decides index scan vs bitmap scan vs sequential scan
- **Row count** decides whether a sort or hash fits in `work_mem`

Errors also **compound upward**. A 10× underestimate at a leaf node becomes
100× two joins up, because each join multiplies its inputs' estimates.

---

## What Statistics Actually Contain

### PostgreSQL

`ANALYZE` samples `300 × default_statistics_target` rows (30,000 by default)
and stores per-column summaries in `pg_statistic`, readable via `pg_stats`:

| Field              | Meaning                                                          |
| :----------------- | :---------------------------------------------------------------- |
| `null_frac`        | Fraction of rows where the column is NULL                         |
| `n_distinct`       | Distinct value count (negative = a *ratio* of table rows, e.g. `-1` means unique) |
| `most_common_vals` | The MCV list — the most frequent values, verbatim                 |
| `most_common_freqs`| Their frequencies, so skewed values are estimated exactly          |
| `histogram_bounds` | Equi-depth buckets over the *non-MCV* remainder, for range predicates |
| `correlation`      | How closely physical row order matches column order (−1..1); drives index-scan cost |
| `avg_width`        | Average bytes per value, used for memory and width estimates       |

Table-level counts (`reltuples`, `relpages`) live in `pg_class`.

### MySQL / InnoDB

MySQL splits this across two mechanisms:

- **Index statistics** — InnoDB estimates cardinality by sampling
  `innodb_stats_persistent_sample_pages` (default 20) leaf pages per index,
  persisted in `mysql.innodb_table_stats` and `mysql.innodb_index_stats`. The
  small default sample is why MySQL index cardinality is often visibly rough
  on large tables.
- **Column histograms** (8.0+) — opt-in, built explicitly, stored in
  `information_schema.column_statistics`. They exist mainly to give the
  optimizer selectivity for **non-indexed** columns, which index statistics
  can't cover:

  ```sql
  ANALYZE TABLE orders UPDATE HISTOGRAM ON status, channel WITH 32 BUCKETS;
  ANALYZE TABLE orders DROP HISTOGRAM ON channel;
  ```

  MySQL builds a *singleton* histogram when distinct values fit in the bucket
  count (exact frequencies) and an *equi-height* one otherwise. Default 100
  buckets, maximum 1024.

At query time MySQL may also do **index dives** — reading actual B-tree pages
to count matching rows for the specific constants in your query. This is more
accurate than stored statistics but costs I/O, so it's skipped once a query
has more than `eq_range_index_dive_limit` (default 200) equality ranges,
at which point estimates get noticeably worse for big `IN (...)` lists.

---

## How Selectivity Is Computed

**Selectivity** is the fraction of rows a predicate keeps. Estimated rows =
`table_rows × selectivity`.

| Predicate                     | Estimation method                                                       |
| :---------------------------- | :----------------------------------------------------------------------- |
| `col = 'x'`, `x` in MCV list  | Exact — the stored frequency for that value                              |
| `col = 'x'`, `x` not in MCV   | `(1 − sum(MCV freqs) − null_frac) / (n_distinct − #MCVs)` — the flat average |
| `col > 'x'` / `BETWEEN`       | Fraction of histogram buckets covered, interpolating within the boundary bucket |
| `col IS NULL`                 | `null_frac` — usually accurate                                            |
| `col LIKE 'abc%'`             | Prefix mapped onto the histogram; usable                                  |
| `col LIKE '%abc%'`            | No usable statistics — falls back to a fixed default guess                |
| `f(col) = 'x'`                | No statistics on the *expression* — fixed default (0.5% for equality in PostgreSQL) |
| `A AND B`                     | `sel(A) × sel(B)` — **assumes independence**                              |
| `A OR B`                      | `sel(A) + sel(B) − sel(A) × sel(B)`                                       |
| Join on `a.x = b.y`           | Driven by `n_distinct` on both sides: `rows_a × rows_b / max(ndistinct_a, ndistinct_b)` |

Two lines in that table cause most real-world disasters: the **independence
assumption** for `AND`, and the **fixed default** for expressions the planner
can't reason about.

---

## Inspecting Statistics

**PostgreSQL** — what does the planner believe about this column?

```sql
SELECT attname, null_frac, n_distinct, avg_width, correlation,
       most_common_vals, most_common_freqs
FROM pg_stats
WHERE tablename = 'orders' AND attname IN ('status', 'customer_id');
```

When statistics were last refreshed, and how much has changed since:

```sql
SELECT relname, n_live_tup, n_mod_since_analyze,
       last_analyze, last_autoanalyze
FROM pg_stat_user_tables
WHERE relname = 'orders';
```

A large `n_mod_since_analyze` relative to `n_live_tup` means the planner is
working from a stale picture.

**MySQL** — index cardinality and histograms:

```sql
SHOW INDEX FROM orders;                    -- Cardinality column per index

SELECT * FROM mysql.innodb_index_stats WHERE table_name = 'orders';

SELECT column_name,
       JSON_EXTRACT(histogram, '$."number-of-buckets-specified"') AS buckets,
       JSON_EXTRACT(histogram, '$."last-updated"')                AS updated
FROM information_schema.column_statistics
WHERE table_name = 'orders';
```

---

## The Six Ways Estimates Go Wrong

### 1. Stale statistics after bulk changes

You load 10 million rows and query immediately. Statistics still describe the
empty table, so the planner estimates a handful of rows, picks a nested loop,
and the query never finishes. **Always `ANALYZE` after a bulk load, migration,
or restore** — autovacuum will eventually catch up, but "eventually" is after
your query has already run.

### 2. Correlated columns (the independence trap)

```sql
WHERE city = 'Copenhagen' AND country = 'Denmark'
```

If 1% of rows are Copenhagen and 2% are Denmark, the planner computes
`0.01 × 0.02 = 0.0002` — 0.02% of the table. The real answer is 1%, because
every Copenhagen row is a Denmark row. That's a **50× underestimate**, and it
reliably produces a nested loop where a hash join belonged.

This is the most common cause of mysterious plan regressions, and it's
invisible unless you compare estimated to actual rows.

### 3. Skewed distributions outside the MCV list

A `status` column that's 97% `'completed'` and 3% everything else. If the MCV
list is too short to capture the rare values, every value gets the flat
average — massively overestimating rare ones and underestimating `'completed'`.
Widening the statistics target fixes this by storing more MCVs.

### 4. Expressions and functions the planner can't see through

```sql
WHERE LOWER(email) = 'a@b.com'          -- no stats on LOWER(email)
WHERE created_at::date = CURRENT_DATE   -- no stats on the cast expression
WHERE amount * quantity > 1000          -- no stats on the product
```

Each of these gets a hardcoded default selectivity. They also can't use a
plain column index — so you get a bad estimate *and* a bad access path.

### 5. Estimates on derived inputs

The planner has no statistics for the *output* of many constructs:

- **Set-returning functions** default to 1000 rows unless declared otherwise
  (`CREATE FUNCTION ... ROWS 5`).
- **Materialized CTEs** are estimated from the CTE's own plan, and errors
  inside it propagate to everything above.
- **Table functions, `unnest()`, JSON expansion** — fixed guesses.
- **Partitioned tables** with per-partition statistics that don't aggregate
  cleanly across the parent.

### 6. Parameterized plans

With prepared statements, PostgreSQL may build a **generic plan** after five
executions — one plan for *all* parameter values, estimated from average
selectivity. That's fine for uniform data and terrible for skewed data where
`status = 'completed'` and `status = 'refunded'` want opposite plans.

```sql
SET plan_cache_mode = force_custom_plan;   -- re-plan per execution
EXPLAIN (GENERIC_PLAN) SELECT * FROM orders WHERE status = $1;  -- PG16+
```

---

## Diagnosing a Bad Estimate

Run `EXPLAIN ANALYZE` and compare `rows=` (estimate) with `actual rows=`
(reality) at every node:

```
Nested Loop  (cost=0.85..1502.10 rows=12 width=48)
             (actual time=0.04..48211.55 rows=248301 loops=1)
  ->  Index Scan using idx_city on customers c
        (cost=0.42..88.10 rows=12 width=24)
        (actual time=0.02..14.80 rows=24810 loops=1)          ← 12 vs 24,810
        Index Cond: (city = 'Copenhagen')
        Filter: (country = 'Denmark')
  ->  Index Scan using idx_cust on orders o  (actual rows=10 loops=24810)
```

Method:

1. **Work bottom-up.** Find the *deepest* node where estimate and actual
   diverge — everything above it inherits the error, so fixing the top node is
   treating a symptom.
2. **Compute the ratio.** Under 3× is normal noise. Over 10× is a real problem.
   Over 100× means the plan above it is essentially arbitrary.
3. **Remember loops.** In PostgreSQL, `actual rows` on an inner node is the
   **average per loop** — multiply by `loops` for the total before comparing
   against anything.
4. **Classify the direction.** *Underestimates* cause nested loops, missing
   hash tables, and undersized memory. *Overestimates* cause unnecessary
   sequential scans and hash joins where an index lookup would have won.
5. **Look at the predicate.** In the example above, `city` is in `Index Cond`
   and `country` in `Filter`, and the two are perfectly correlated — textbook
   independence-assumption failure.

---

## Fixing Bad Estimates

### Refresh the statistics first

```sql
ANALYZE orders;                                     -- PostgreSQL, one table
ANALYZE VERBOSE orders;                             -- shows sample size
ANALYZE TABLE orders;                               -- MySQL
```

Cheap, safe, and the fix for a surprisingly large share of "the optimizer went
crazy" incidents.

### Collect more detail on skewed columns

```sql
ALTER TABLE orders ALTER COLUMN status SET STATISTICS 1000;   -- default 100
ANALYZE orders;
```

Higher target = longer MCV list and more histogram buckets = better handling
of skew and ranges.

### Teach PostgreSQL about correlated columns

Extended statistics fix the independence assumption directly:

```sql
CREATE STATISTICS stat_customers_geo (dependencies, ndistinct, mcv)
  ON city, country FROM customers;
ANALYZE customers;
```

- `dependencies` — functional dependencies (`city → country`), fixing `AND`
  selectivity for equality predicates
- `ndistinct` — the *joint* distinct count, fixing `GROUP BY` estimates over
  multiple columns
- `mcv` — a multi-column MCV list, the most accurate and most expensive

Check that it took effect:

```sql
SELECT * FROM pg_stats_ext WHERE statistics_name = 'stat_customers_geo';
```

### Give expressions something to measure

Creating an expression index makes PostgreSQL collect statistics on the
expression itself — you get a usable index *and* an honest estimate:

```sql
CREATE INDEX idx_lower_email ON users (LOWER(email));
ANALYZE users;
```

PostgreSQL 14+ can also collect expression statistics without an index:

```sql
CREATE STATISTICS stat_orders_month ON date_trunc('month', created_at) FROM orders;
```

Better still, rewrite the predicate to be sargable where you can —
`created_at >= '2026-08-01' AND created_at < '2026-09-01'` beats
`date_trunc('month', created_at) = '2026-08-01'` on both counts.

### Declare row counts for functions

```sql
CREATE FUNCTION recent_orders(int) RETURNS SETOF orders
  AS $$ ... $$ LANGUAGE sql STABLE ROWS 25;   -- instead of the 1000 default
```

---

## Keeping Statistics Fresh

PostgreSQL's autovacuum daemon runs `ANALYZE` when
`n_mod_since_analyze > autovacuum_analyze_threshold + autovacuum_analyze_scale_factor × n_live_tup`
— by default `50 + 0.1 × rows`, i.e. after 10% of the table changes. On a
100-million-row table that's 10 million modifications before stats refresh,
which is far too lax for a column tracking recent activity. Tune per table:

```sql
ALTER TABLE orders SET (autovacuum_analyze_scale_factor = 0.02,
                        autovacuum_analyze_threshold = 5000);
```

MySQL recalculates InnoDB statistics automatically when ~10% of the table
changes (`innodb_stats_auto_recalc`, on by default), but **histograms are
never refreshed automatically** — re-run `ANALYZE TABLE ... UPDATE HISTOGRAM`
on a schedule or they silently rot.

Refresh explicitly after: bulk loads, restores, large `DELETE`s, schema
migrations, and partition swaps. None of these reliably trigger auto-analyze
before your next query runs.

---

## Trade-offs

- **Higher statistics targets** improve estimates but make `ANALYZE` slower
  (it samples more rows) and **planning slower** (longer MCV lists to scan on
  every plan). Raise it on the specific skewed columns that need it, not
  database-wide.
- **Extended statistics** aren't free — `mcv` in particular costs meaningful
  `ANALYZE` time and planning time. Add them where you've *proven* a
  correlation problem via estimate-vs-actual, not preemptively.
- **More frequent auto-analyze** costs background I/O on hot tables. That is
  almost always cheaper than one bad plan on a large join, but it isn't zero.
- **Expression indexes** give you statistics plus an access path, at the usual
  index cost on writes.

---

## Quick Reference

| Task                              | PostgreSQL                                                  | MySQL                                                    |
| :-------------------------------- | :----------------------------------------------------------- | :--------------------------------------------------------- |
| Refresh statistics                | `ANALYZE table;`                                             | `ANALYZE TABLE table;`                                     |
| Inspect column statistics         | `SELECT * FROM pg_stats WHERE tablename='t';`                | `information_schema.column_statistics`, `SHOW INDEX FROM t` |
| When were stats last updated      | `pg_stat_user_tables.last_analyze`                           | `mysql.innodb_table_stats.last_update`                     |
| Increase detail on one column     | `ALTER TABLE t ALTER COLUMN c SET STATISTICS 1000;`          | `ANALYZE TABLE t UPDATE HISTOGRAM ON c WITH 512 BUCKETS;`  |
| Fix correlated-column estimates   | `CREATE STATISTICS ... (dependencies, mcv) ON a, b FROM t;`  | No equivalent — rewrite the query or index the combination |
| Statistics on an expression       | Expression index, or `CREATE STATISTICS ON expr FROM t;`     | Generated column + index                                   |
| Default sample size               | `300 × default_statistics_target` (30,000 rows)              | 20 leaf pages per index (`innodb_stats_persistent_sample_pages`) |
| Auto-refresh trigger              | 10% of rows modified (`autovacuum_analyze_scale_factor`)     | ~10% of rows (`innodb_stats_auto_recalc`); histograms never |
| Spot a bad estimate               | `EXPLAIN ANALYZE` → compare `rows=` vs `actual rows=`        | `EXPLAIN ANALYZE` (8.0.18+) → same comparison               |

**Bottom line:** the optimizer is only as good as its guesses. Before blaming
the planner, run `EXPLAIN ANALYZE` and find the deepest node where estimated
and actual rows diverge by more than 10×. Nine times out of ten it's stale
statistics, correlated columns, or a predicate wrapped in a function — and all
three have direct fixes that outlast any hint.
