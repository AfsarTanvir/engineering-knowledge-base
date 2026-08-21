# Reading a Query Plan in Depth

`EXPLAIN` tells you the plan; reading it properly tells you *why* the plan is
slow. That means knowing what the cost numbers actually measure, why "actual
rows" is often not the number of rows you think, and how to use `BUFFERS` to
separate "this query does too much work" from "this query reads from disk".

## Table of Contents

1. [Plan Structure: Reading the Tree](#plan-structure-reading-the-tree)
2. [Cost Units: What the Numbers Mean](#cost-units-what-the-numbers-mean)
3. [Rows, Loops, and the Averaging Trap](#rows-loops-and-the-averaging-trap)
4. [BUFFERS: Where the I/O Actually Goes](#buffers-where-the-io-actually-goes)
5. [EXPLAIN Options Worth Knowing](#explain-options-worth-knowing)
6. [Node Annotations and What They Reveal](#node-annotations-and-what-they-reveal)
7. [A Worked Diagnosis](#a-worked-diagnosis)
8. [Parallel Plans](#parallel-plans)
9. [Reading MySQL Plans](#reading-mysql-plans)
10. [Capturing Plans in Production](#capturing-plans-in-production)
11. [A Reading Checklist](#a-reading-checklist)
12. [Quick Reference](#quick-reference)

---

## Plan Structure: Reading the Tree

A plan is a tree of nodes. Each node consumes rows from its children and emits
rows to its parent. The printed output is that tree, indented:

```
Sort
  ->  Hash Join
        ->  Seq Scan on orders
        ->  Hash
              ->  Index Scan on customers
```

**Execution flows bottom-up and inside-out.** The leaves (scans) run first,
their output feeds joins, joins feed sorts and aggregates, and the topmost
node produces the final result. Sibling nodes at the same indentation are the
two inputs to their parent — for joins, the **first is the outer/driving side**
and the second is the inner side.

Read a plan by finding the leaves, then walking outward. Reading top-down
tells you the shape; reading bottom-up tells you where the time went.

---

## Cost Units: What the Numbers Mean

```
Seq Scan on orders  (cost=0.00..21925.00 rows=45 width=32)
```

### `cost=startup..total`

Two numbers, not a range:

- **Startup cost** — work done before the *first* row can be emitted. A
  `Seq Scan` starts at ~0 (first row is immediately available). A `Sort` or a
  `Hash` node has a high startup cost, because it must consume its entire
  input before emitting anything.
- **Total cost** — work to emit *all* rows.

This distinction matters under `LIMIT`: the planner costs a limited query as
roughly `startup + (total − startup) × limit/rows`, which is why `LIMIT 10`
can flip a plan from hash join to nested loop. A node with high startup cost
gets no benefit from the limit.

### The units are arbitrary

Cost is measured in multiples of **one sequential page read**, not in
milliseconds. The default constants in PostgreSQL:

| Parameter               | Default | Meaning                                    |
| :---------------------- | :------ | :----------------------------------------- |
| `seq_page_cost`         | 1.0     | Read one 8 kB page sequentially            |
| `random_page_cost`      | 4.0     | Read one page at a random offset           |
| `cpu_tuple_cost`        | 0.01    | Process one row                            |
| `cpu_index_tuple_cost`  | 0.005   | Process one index entry                    |
| `cpu_operator_cost`     | 0.0025  | Evaluate one operator or function call     |
| `parallel_tuple_cost`   | 0.1     | Pass one row from a worker to the leader   |
| `parallel_setup_cost`   | 1000.0  | Start up parallel workers                  |

So a sequential scan over a 1,000-page, 100,000-row table costs
`1000 × 1.0 + 100000 × 0.01 = 1100`. You can verify these against `relpages`
and `reltuples` in `pg_class` — the arithmetic is entirely reproducible.

Three consequences that trip people up:

1. **Cost is not time.** A cost of 21,925 says nothing about milliseconds. Two
   plans' costs are comparable only within the same query on the same
   configuration.
2. **`random_page_cost = 4.0` assumes spinning disks.** On SSDs or NVMe the
   real ratio is closer to 1.1–1.5. Leaving the default systematically biases
   the planner *away* from index scans and toward sequential scans. This is
   the single most commonly-wrong cost setting in production PostgreSQL.
3. **The cheapest-cost plan is only the fastest plan if the estimates are
   right.** Cost errors are almost always row-estimate errors in disguise —
   see [cardinality-estimation-and-statistics.md](cardinality-estimation-and-statistics.md).

### `rows` and `width`

`rows` is the **estimated** output row count for this node. `width` is the
estimated average bytes per row — useful for spotting a `SELECT *` dragging
wide columns through a sort (`width=2048` on a node that only needs two
integers is a real finding; see
[select-star-anti-pattern.md](../query-patterns/select-star-anti-pattern.md)).

---

## Rows, Loops, and the Averaging Trap

Add `ANALYZE` and each node gains a second parenthesised group:

```
(cost=0.42..8.51 rows=12 width=16) (actual time=0.014..0.021 rows=11 loops=205)
```

| Field         | Meaning                                                        |
| :------------ | :------------------------------------------------------------- |
| `actual time` | `first_row_ms..all_rows_ms`, **per loop**                       |
| `rows`        | Actual rows emitted, **averaged over all loops**                |
| `loops`       | How many times this node was executed                           |

**The trap:** in a nested loop, the inner node runs once per outer row. That
node showing `rows=11 loops=205` did **not** produce 11 rows — it produced
about 2,255. Likewise `actual time=0.014..0.021` is 0.021 ms *per loop*, so
the node consumed roughly 4.3 ms in total.

Always multiply by `loops` before:

- comparing actual rows to the estimate (the estimate is also per-loop)
- attributing time to a node
- deciding whether a subtree is "the expensive one"

Two more reading rules:

- **Times are inclusive.** A node's `actual time` includes all of its
  children. To get a node's own cost, subtract its children's totals.
- **`never executed`** means the node was planned but skipped at runtime —
  common under `LIMIT`, or on partitions eliminated at execution time. It is
  not an error.

The comparison that matters most is `rows` (estimated) vs `actual rows ×
loops`. A divergence over 10× at the deepest node where it appears is the root
cause of nearly every bad plan.

---

## BUFFERS: Where the I/O Actually Goes

`EXPLAIN (ANALYZE, BUFFERS)` is the difference between "this query is slow" and
"this query reads 4 GB from disk". It is on by default with `ANALYZE` from
PostgreSQL 18; add it explicitly on older versions.

```
Bitmap Heap Scan on orders  (actual time=12.4..884.1 rows=248301 loops=1)
  Buffers: shared hit=1024 read=38210 dirtied=12, temp read=5120 written=5120
```

| Counter          | Meaning                                                           |
| :--------------- | :----------------------------------------------------------------- |
| `shared hit`     | Pages found in PostgreSQL's buffer cache — effectively free         |
| `shared read`    | Pages **not** cached: read from the OS page cache or actual disk    |
| `shared dirtied` | Pages this query modified, creating future write work               |
| `shared written` | Pages this query flushed to disk itself                             |
| `local *`        | Same counters for temporary tables                                  |
| `temp read/written` | **Spill files** — a sort or hash exceeded `work_mem`             |

Every page is 8 kB, so `read=38210` is roughly 300 MB pulled in for one node.

What to do with the numbers:

- **High `shared read`, low `hit`** — the working set doesn't fit in cache, or
  this is a cold first run. Re-run to see if it's a caching artifact before
  concluding anything.
- **Any `temp written`** — a spill. Find the `Sort` or `Hash` node responsible
  and raise `work_mem` for that query, or reduce the data reaching it.
- **Buffers wildly out of proportion to rows returned** — the classic
  signature of over-fetching: reading 38,000 pages to return 45 rows means the
  access path is wrong, regardless of how fast it ran on a warm cache.
- **`dirtied` on a `SELECT`** — usually hint-bit setting after a bulk load, or
  the visibility map being updated. Harmless once, suspicious if persistent.

Buffers are the most *stable* metric in a plan: timings vary with cache state
and machine load, but the number of pages touched is a property of the plan
itself. When comparing two candidate plans, compare buffers first.

---

## EXPLAIN Options Worth Knowing

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, WAL, FORMAT TEXT)
SELECT ...;
```

| Option          | Since | What it adds                                                        |
| :-------------- | :---- | :------------------------------------------------------------------ |
| `ANALYZE`       | —     | **Actually runs the query** and reports real timings and rows        |
| `BUFFERS`       | —     | Page-level I/O counters (default with `ANALYZE` in PG18+)            |
| `VERBOSE`       | —     | Output column lists, schema-qualified names, worker-by-worker detail |
| `SETTINGS`      | 12    | Any planner-related setting that differs from its default            |
| `WAL`           | 13    | WAL records/bytes generated — for `INSERT`/`UPDATE`/`DELETE` plans   |
| `GENERIC_PLAN`  | 16    | Plan a parameterised query without supplying values                  |
| `MEMORY`        | 17    | Memory consumed by the *planner* itself                              |
| `SERIALIZE`     | 17    | Cost of converting rows to wire format — catches wide `TOAST` columns that `ANALYZE` alone hides |
| `TIMING OFF`    | —     | Skip per-node timing (still counts rows); reduces instrumentation overhead |
| `FORMAT JSON`   | —     | Machine-readable, for diffing plans or feeding a visualizer          |

Two warnings:

- **`ANALYZE` executes the statement.** On an `UPDATE`/`DELETE`/`INSERT` this
  means the write really happens. Wrap it:

  ```sql
  BEGIN;
  EXPLAIN (ANALYZE, BUFFERS) DELETE FROM orders WHERE created_at < '2020-01-01';
  ROLLBACK;
  ```

- **Instrumentation has overhead.** Per-node timing calls `gettimeofday()`
  twice per row on some platforms, which can inflate reported time
  substantially on plans that emit millions of rows through many nodes. If
  `Execution Time` looks far worse than the query's real-world latency, re-run
  with `TIMING OFF` and trust the row counts and buffers instead.

Finally, `Planning Time` vs `Execution Time` at the bottom: planning in the
tens of milliseconds is normal for many-table joins, but planning time
*exceeding* execution time on a fast query is a real problem — usually a huge
partition count, an oversized statistics target, or `join_collapse_limit` set
too high.

---

## Node Annotations and What They Reveal

The extra lines under a node are where the diagnosis usually lives:

| Annotation                            | What it tells you                                                       |
| :------------------------------------ | :----------------------------------------------------------------------- |
| `Index Cond: (...)`                   | Predicate satisfied **by the index** — rows are never fetched            |
| `Filter: (...)` + `Rows Removed by Filter: N` | Predicate applied **after** fetching rows. A large `N` means the index doesn't cover this predicate |
| `Heap Fetches: N` (Index Only Scan)   | Non-zero means the visibility map is stale — `VACUUM` the table          |
| `Recheck Cond` + `Lossy heap blocks`  | The bitmap outgrew `work_mem` and degraded to page granularity           |
| `Sort Method: quicksort  Memory: 28kB`| Sorted in memory — good                                                  |
| `Sort Method: external merge  Disk: 240MB` | Sort spilled to disk — raise `work_mem` or sort fewer/narrower rows  |
| `Buckets: 65536  Batches: 8`          | Hash join spilled: `Batches > 1` means multiple passes over both inputs  |
| `Hash Cond` / `Merge Cond` / `Join Filter` | Which predicate drove the join; a `Join Filter` with many removed rows means part of the condition couldn't be used by the algorithm |
| `Memoize` with `Hits: 9821 Misses: 12`| Nested-loop inner results being cached — a high hit ratio is a win       |
| `Subplan` / `InitPlan`                | A correlated subquery. `Subplan` re-executes per row; `InitPlan` runs once |
| `never executed`                      | Node was planned but skipped at runtime                                  |

Two distinctions worth internalising:

**`Index Cond` vs `Filter`.** `Index Cond` is work the index did for you.
`Filter` is work done on rows the index already handed over. A node showing
`Rows Removed by Filter: 2399955` read 2.4 million rows to discard them — the
index is either missing the filtered column or has it in the wrong position
(see [composite-index-ordering.md](../query-optimization/composite-index-ordering.md)).

**`Index Scan` vs `Bitmap Heap Scan`.** An `Index Scan` fetches heap rows one
at a time in index order — great for a handful of rows. A `Bitmap Heap Scan`
collects all matching row locations first, sorts them by physical page, then
reads each page once — better for thousands of scattered rows. The planner
switches between them based on estimated row count and `random_page_cost`.
Seeing a bitmap scan where you expected an index scan usually means the
estimate is higher than you think.

---

## A Worked Diagnosis

```
Limit  (cost=112834.21..112834.26 rows=20 width=88)
       (actual time=8421.334..8421.341 rows=20 loops=1)
  Buffers: shared hit=2841 read=95210, temp read=18420 written=18420
  ->  Sort  (cost=112834.21..113455.80 rows=248636 width=88)
            (actual time=8421.332..8421.336 rows=20 loops=1)
        Sort Key: o.created_at DESC
        Sort Method: external merge  Disk: 147MB
        Buffers: shared hit=2841 read=95210, temp read=18420 written=18420
        ->  Hash Join  (cost=1834.00..98210.55 rows=248636 width=88)
                       (actual time=48.221..7102.884 rows=248301 loops=1)
              Hash Cond: (o.customer_id = c.id)
              Buffers: shared hit=2841 read=95210
              ->  Seq Scan on orders o  (cost=0.00..89247.00 rows=1000000 width=64)
                                        (actual time=0.008..2841.102 rows=1000000 loops=1)
                    Buffers: shared read=89247
              ->  Hash  (cost=1210.00..1210.00 rows=49920 width=24)
                        (actual time=47.980..47.981 rows=50000 loops=1)
                    Buckets: 65536  Batches: 1  Memory Usage: 3452kB
                    ->  Seq Scan on customers c  (actual rows=50000 loops=1)
 Planning Time: 0.412 ms
 Execution Time: 8433.180 ms
```

Reading it bottom-up:

1. **Estimates are good.** 248,636 estimated vs 248,301 actual on the join —
   statistics are healthy, so this is *not* an estimation problem. Skip
   straight to the access paths.
2. **`Seq Scan on orders`, `read=89247`** — 700 MB read from disk to produce
   1 million rows, of which the join keeps a quarter. If the query filters
   orders at all, that filter isn't indexed.
3. **The `Sort` spilled**: `external merge  Disk: 147MB`, matching
   `temp written=18420` pages. That's the bulk of the 8.4 seconds.
4. **The `Limit` only wants 20 rows**, but the sort materialised all 248,301
   first. The plan is doing 12,000× more work than the output requires.
5. **`width=88`** through the sort — every wide column is being carried
   through a disk spill for rows that get discarded.

The fix is not `work_mem`. An index on `orders (created_at DESC)` lets the
planner read rows already in sort order and stop after 20, eliminating the
sort node entirely — the classic `ORDER BY ... LIMIT` pattern covered in
[pagination-performance.md](../query-optimization/pagination-performance.md).
Raising `work_mem` would only make the wrong plan spill less.

That's the general lesson: `Sort Method: external merge` looks like a memory
problem and is usually a *missing index* problem.

---

## Parallel Plans

```
Gather  (cost=1000.00..48210.55 rows=98000 width=48) (actual rows=98000 loops=1)
  Workers Planned: 2
  Workers Launched: 2
  ->  Parallel Seq Scan on orders  (actual rows=32667 loops=3)
```

Rules for reading these:

- **`loops=3`, not 2** — the leader process participates alongside the two
  workers.
- **Row counts below `Gather` are per-worker averages.** 32,667 × 3 = 98,000.
  This is the loops trap again, in a form that surprises people who expect
  parallelism to be transparent.
- **`Workers Launched` < `Workers Planned`** means the pool
  (`max_parallel_workers_per_gather`, `max_parallel_workers`) was exhausted at
  runtime — the plan was costed for parallelism it didn't get, which is a
  common cause of "the same query is sometimes 3× slower".
- **`work_mem` is per node, per worker.** A plan with two hash nodes and two
  workers can use 6× `work_mem`.
- `Gather Merge` preserves each worker's sort order; plain `Gather` does not.

---

## Reading MySQL Plans

MySQL's tabular `EXPLAIN` gives estimates only. Two better formats:

**`EXPLAIN FORMAT=TREE`** (8.0.16+) shows the actual execution tree, matching
PostgreSQL's shape:

```
-> Limit: 20 row(s)  (cost=112834.21 rows=20)
    -> Sort: o.created_at DESC  (cost=98210.55 rows=248636)
        -> Inner hash join (o.customer_id = c.id)  (cost=98210.55 rows=248636)
            -> Table scan on o  (cost=89247.00 rows=1000000)
            -> Hash
                -> Table scan on c  (cost=1210.00 rows=50000)
```

**`EXPLAIN ANALYZE`** (8.0.18+) adds real measurements, with the same per-loop
semantics as PostgreSQL:

```
-> Index lookup on o using idx_cust (customer_id=c.id)
   (cost=1.20 rows=12) (actual time=0.014..0.021 rows=11 loops=205)
```

Reading tabular `EXPLAIN`, the two columns people misread:

- **`rows`** — estimated rows examined for *this* table, not rows returned.
- **`filtered`** — the percentage of those rows expected to survive the
  table's conditions. Rows passed to the next table = `rows × filtered / 100`.
  A `filtered` of 5% on a million-row scan means the optimizer expects to
  throw away 95% of what it reads.

MySQL's cost constants are editable tables rather than settings:

```sql
SELECT * FROM mysql.server_cost;   -- row_evaluate_cost, sort/temptable costs
SELECT * FROM mysql.engine_cost;   -- io_block_read_cost, memory_block_read_cost
FLUSH OPTIMIZER_COSTS;             -- after changing them (affects new connections)
```

Two extras worth remembering:

```sql
EXPLAIN SELECT ...;
SHOW WARNINGS;      -- shows the query AFTER optimizer rewrites

SET optimizer_trace = 'enabled=on';
SELECT ...;
SELECT * FROM information_schema.optimizer_trace;   -- why each plan was rejected
SET optimizer_trace = 'enabled=off';
```

The optimizer trace is MySQL's answer to "but *why* didn't it use my index" —
it lists the considered access paths with their costs and rejection reasons.

---

## Capturing Plans in Production

The slow query you need to explain rarely reproduces on demand. Capture plans
as they happen:

**PostgreSQL** — the `auto_explain` module logs plans for slow statements:

```ini
shared_preload_libraries = 'auto_explain'
auto_explain.log_min_duration = '500ms'
auto_explain.log_analyze = on          # real rows/times — has runtime overhead
auto_explain.log_buffers = on
auto_explain.log_nested_statements = on
auto_explain.sample_rate = 0.05        # explain 5% of qualifying statements
```

`log_analyze` adds instrumentation to every statement that qualifies, so pair
it with `sample_rate` on a busy system, or start with `log_analyze = off` to
capture plan shapes only.

**MySQL** — the slow query log records statements, not plans; pair it with
`EXPLAIN` on the captured statement, or use Performance Schema
(`events_statements_history_long`) for per-statement execution detail. See
[slow-query-fixes.md](../query-optimization/slow-query-fixes.md) for the
capture side.

---

## A Reading Checklist

Work through a plan in this order — it puts the highest-yield checks first:

1. **Bottom line first.** `Execution Time` vs `Planning Time`. Is planning the
   problem?
2. **Find the time.** Which node has the largest `actual time` after
   subtracting its children? Remember to multiply by `loops`.
3. **Check the estimates there.** Compare `rows` to `actual rows × loops`.
   Over 10× off? The problem is statistics, not the plan — go to
   [cardinality-estimation-and-statistics.md](cardinality-estimation-and-statistics.md).
4. **Check the access path.** `Seq Scan` on a large table with a selective
   filter, or `Rows Removed by Filter` in the thousands, means a missing or
   wrongly-ordered index.
5. **Check for spills.** `external merge`, `Batches > 1`, or any `temp
   written` in the buffers line.
6. **Check the join algorithm** against what the row counts justify
   ([join-algorithms.md](join-algorithms.md)).
7. **Check the buffers.** Pages read wildly out of proportion to rows returned
   means over-fetching.
8. **Check `width`.** Wide rows through sorts and spills are often a
   `SELECT *` you don't need.

---

## Quick Reference

| Question                             | Where to look                                                    |
| :----------------------------------- | :---------------------------------------------------------------- |
| Is the estimate wrong?               | `rows=` vs `actual rows= × loops=`; >10× is a real problem        |
| How many rows did this node *really* emit? | `actual rows × loops`                                       |
| Where did the time go?                | Largest `actual time` minus children's, × `loops`                 |
| Did something spill to disk?          | `Sort Method: external merge`, `Batches > 1`, `temp written`      |
| Is the index doing the work?          | `Index Cond` (yes) vs `Filter` + `Rows Removed by Filter` (no)    |
| Why isn't it an Index Only Scan?      | `Heap Fetches > 0` → `VACUUM`; or the index doesn't cover the columns |
| How much I/O?                         | `Buffers: shared read=N` × 8 kB                                   |
| Is the plan cached-warm or cold?       | `shared hit` vs `shared read`; re-run to compare                  |
| Cost units                            | Multiples of one sequential 8 kB page read — **not milliseconds** |
| Cost too pessimistic about indexes?   | `random_page_cost` still at 4.0 on SSD storage                    |
| MySQL: real vs estimated              | `EXPLAIN ANALYZE` (8.0.18+); `EXPLAIN FORMAT=TREE` for shape only |
| MySQL: why not my index?              | `SET optimizer_trace='enabled=on'` then read `optimizer_trace`    |
| Capture plans in production           | PostgreSQL `auto_explain`; MySQL slow log + Performance Schema    |

**Bottom line:** read the plan bottom-up, find the deepest node where
estimated and actual rows diverge, and fix *that* — everything above it is a
consequence. Costs are a planner-internal currency and never milliseconds;
`actual rows` is a per-loop average and never a total; and buffers, not
timings, are the metric that stays honest between runs.
