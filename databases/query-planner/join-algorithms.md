# Join Algorithms: Nested Loop vs Hash Join vs Merge Join

`JOIN` is a single keyword in SQL, but the engine has three fundamentally
different ways to execute it. Which one it picks decides whether a two-table
join costs 200 index lookups or a 10-million-row scan — and the optimizer
makes that choice from cost estimates, not from your SQL.

## Table of Contents

1. [The Three Algorithms](#the-three-algorithms)
2. [Nested Loop Join](#nested-loop-join)
3. [Hash Join](#hash-join)
4. [Merge Join](#merge-join)
5. [How the Optimizer Chooses](#how-the-optimizer-chooses)
6. [Engine Support: MySQL vs PostgreSQL](#engine-support-mysql-vs-postgresql)
7. [Spotting the Wrong Algorithm](#spotting-the-wrong-algorithm)
8. [Nudging the Optimizer](#nudging-the-optimizer)
9. [Trade-offs](#trade-offs)
10. [Quick Reference](#quick-reference)

---

## The Three Algorithms

Every join takes two inputs — conventionally the **outer** (driving) side and
the **inner** (probed) side — and produces matching row pairs. The algorithms
differ only in *how they find the matches*:

| Algorithm       | Strategy                                                      | Needs                          |
| :-------------- | :------------------------------------------------------------ | :----------------------------- |
| Nested Loop     | For each outer row, look up matching inner rows                | Ideally an index on the inner join column |
| Hash Join       | Build a hash table from one input, probe it with the other     | Equality predicate + memory    |
| Merge Join      | Walk both inputs in join-key order, advancing in lockstep      | Both inputs sorted on the key  |

The choice is not about correctness — all three return the same rows. It is
purely about which is cheapest given input sizes, indexes, sort order, and
available memory.

---

## Nested Loop Join

```
for each row R in outer:
    for each matching row S in inner:
        emit (R, S)
```

**Cost shape:** `outer_rows × cost_of_one_inner_lookup`

The whole algorithm lives or dies on that inner lookup. With an index on the
inner join column, each lookup is a cheap B-tree descent — a few page reads.
Without one, "look up matching rows" means *scan the entire inner table*,
once per outer row, and the cost becomes `outer_rows × inner_rows`.

```
Nested Loop  (cost=0.71..842.35 rows=205 width=40) (actual rows=205 loops=1)
  ->  Index Scan using idx_country on customers c   (actual rows=205 loops=1)
  ->  Index Scan using idx_cust_id on orders o      (actual rows=12 loops=205)
```

Read the `loops=205` on the inner node: it ran 205 times, once per outer row.
`actual rows=12` is the **average per loop**, not the total — 205 × 12 ≈ 2,460
rows produced. This per-loop averaging is the single most misread number in a
query plan.

**Best when:** the outer side is small after its own filters and the inner
side has a usable index. This is the plan you *want* for selective OLTP
queries — it touches only the rows it needs and streams results immediately
(near-zero startup cost, which also makes it the natural fit for `LIMIT`).

**Variants worth knowing:**

- **Block nested loop** — buffers a chunk of outer rows and scans the inner
  table once per *block* rather than per row, cutting the scan count by the
  block size. MySQL used this (`join_buffer_size`) before hash joins arrived.
- **Memoize** (PostgreSQL 14+) — caches inner-side results keyed by the join
  value, so repeated outer values skip the lookup entirely. Shows as a
  `Memoize` node with a hit-ratio line; it turns a nested loop over a skewed
  outer side into something close to a hash join.

---

## Hash Join

```
build phase:  load the smaller input into an in-memory hash table, keyed by
              the join column
probe phase:  scan the larger input, hash each row's key, emit matches
```

**Cost shape:** roughly `outer_rows + inner_rows` — each side is read once.

```
Hash Join  (cost=1834.00..48210.55 rows=98000 width=48)
  Hash Cond: (o.customer_id = c.id)
  ->  Seq Scan on orders o  (actual rows=1000000 loops=1)
  ->  Hash  (Buckets: 65536  Batches: 1  Memory Usage: 3452kB)
        ->  Seq Scan on customers c  (actual rows=50000 loops=1)
```

Note that the inner side is scanned **once**, not once per outer row — that is
the whole point. When you join two large tables and no index helps, a hash
join is usually an order of magnitude better than a nested loop.

**Requirements and limits:**

- **Equality only.** Hashing `a.x = b.y` works; `a.x < b.y` or
  `a.x BETWEEN b.lo AND b.hi` cannot be hashed and falls back to a nested loop.
- **Memory.** The build side must fit in working memory (`work_mem` ×
  `hash_mem_multiplier` in PostgreSQL, `join_buffer_size` in MySQL). If it
  doesn't, the join **spills to disk** and processes in multiple passes —
  visible as `Batches: 8` (any value > 1) plus temp-file I/O in `BUFFERS`.
- **No ordering.** Output comes out in hash order, so a downstream `ORDER BY`
  needs its own `Sort` node.
- **High startup cost.** Nothing is emitted until the build side is fully
  consumed, which makes hash joins a poor fit under a tight `LIMIT`.

**Best when:** large equi-joins where at least one side must be scanned
anyway, or where no index exists on the join column.

---

## Merge Join

```
sort both inputs on the join key (or read them already-sorted from an index)
walk both cursors forward together, emitting matches as keys line up
```

**Cost shape:** linear in both inputs *if already sorted*; otherwise add
`N log N` for each side that needs a `Sort` node.

```
Merge Join  (cost=0.85..71204.10 rows=1000000 width=48)
  Merge Cond: (o.customer_id = c.id)
  ->  Index Scan using idx_orders_cust on orders o
  ->  Index Scan using customers_pkey on customers c
```

**Best when:**

- Both inputs already arrive sorted on the join key — typically because both
  sides are read via an index on that column, or the data came out of an
  earlier merge/sort step you're paying for anyway.
- Both sides are large and roughly comparable in size (no small build side to
  make hashing cheap).
- The query also wants the result in join-key order — the sort is free.

Merge join uses bounded memory regardless of input size, so it degrades far
more gracefully than a hash join that spills. Its weakness is the sort: if
the planner must add two `Sort` nodes, a hash join is usually cheaper.

---

## How the Optimizer Chooses

The planner enumerates candidate (join order × algorithm) combinations and
costs each one. The inputs to that decision:

1. **Estimated row counts on each side** — from table statistics. This is the
   dominant factor, and the dominant source of *wrong* choices. See
   [cardinality-estimation-and-statistics.md](cardinality-estimation-and-statistics.md).
2. **Available indexes** — an index on the inner join column makes nested loop
   viable; an index that supplies sorted order makes merge join cheap.
3. **Predicate shape** — non-equality join conditions rule out hash and merge
   entirely, leaving nested loop as the only legal option.
4. **Memory settings** — a build side that fits in `work_mem` makes hash join
   cheap; one that spills makes it expensive.
5. **Required output order** — an `ORDER BY` on the join key tilts toward
   merge join, since its output is already sorted.

Rough heuristic for what a *correct* choice looks like:

| Situation                                                    | Expected plan  |
| :----------------------------------------------------------- | :------------- |
| Small filtered outer side + indexed inner side               | Nested Loop    |
| Large × large equi-join, no useful index                     | Hash Join      |
| Large × large, both sides indexed on the join key            | Merge Join     |
| Non-equi join condition (`<`, `BETWEEN`, range overlap)      | Nested Loop    |
| Small table joined to large table, no index on the large one | Hash Join      |

---

## Engine Support: MySQL vs PostgreSQL

**PostgreSQL** implements all three, plus parallel variants (`Parallel Hash
Join`), `Memoize` caching for nested loops, and `Materialize` nodes that
buffer an inner side so it can be rescanned without recomputation.

**MySQL/InnoDB** is more limited:

- **Nested loop** — the historical workhorse, with index lookups
  (`ref`/`eq_ref` in `EXPLAIN`) and block nested loop for unindexed inner
  sides.
- **Hash join** — added in 8.0.18, initially only for equi-joins with no
  usable index. 8.0.20 extended it to outer/semi/anti joins and to cases where
  an index exists, and retired block nested loop in its favour.
- **Merge join** — not implemented. MySQL has no sort-merge join at all.

So on MySQL 8.0.20+, "which algorithm?" is effectively a two-way choice, and
`EXPLAIN FORMAT=TREE` names it directly:

```sql
EXPLAIN FORMAT=TREE
SELECT o.id, c.name FROM orders o JOIN customers c ON c.id = o.customer_id;
```

```
-> Inner hash join (c.id = o.customer_id)  (cost=101250.4 rows=98000)
    -> Table scan on o  (rows=1000000)
    -> Hash
        -> Table scan on c  (rows=50000)
```

---

## Spotting the Wrong Algorithm

| Symptom in the plan                                              | Likely problem                                              | Fix                                                     |
| :--------------------------------------------------------------- | :----------------------------------------------------------- | :------------------------------------------------------- |
| Nested Loop with large `loops=` and a `Seq Scan` underneath      | No index on the inner join column                            | Add the index on the join column                         |
| Nested Loop chosen but `actual rows` ≫ estimated on the outer    | Underestimated outer side — planner thought the loop was tiny | Fix statistics; add extended statistics for correlated columns |
| `Hash` node with `Batches: 8` (any value > 1)                    | Build side exceeded working memory, spilled to disk           | Raise `work_mem` for that query, or reduce the build side with an earlier filter |
| Merge Join sitting on top of two `Sort` nodes                    | Paying full sorts to enable a merge                          | Index the join columns, or let it hash instead           |
| `Sort Method: external merge  Disk: 240MB`                       | Sort spilled                                                  | Raise `work_mem`, or supply order via an index           |
| MySQL `type = ALL` on the second table                           | Inner table full-scanned per outer row                        | Index the join column                                    |

The highest-value check is always the same: compare **estimated vs actual
rows** at the node that feeds the join. Nearly every catastrophic join plan is
a correct algorithm choice made from a wrong row count.

---

## Nudging the Optimizer

**PostgreSQL** has no per-query join hints in core. Session-level toggles
exist, but they are **diagnostic tools, not fixes**:

```sql
SET enable_nestloop = off;   -- prove the hash plan is faster
EXPLAIN ANALYZE SELECT ...;
RESET enable_nestloop;
```

These don't hard-disable the algorithm; they attach a large cost penalty, so
the planner still uses it when nothing else is legal. If turning one off makes
the query 50× faster, that's evidence of a bad *estimate* — go fix the
statistics. Real per-query hints require the third-party `pg_hint_plan`
extension.

Related knobs worth adjusting properly:

```sql
SET work_mem = '64MB';          -- per sort/hash node, per worker; not global
SET random_page_cost = 1.1;     -- SSD-appropriate; the default 4.0 assumes spinning disks
                                -- and systematically biases away from index-driven nested loops
```

**MySQL** has real optimizer hints. Since 8.0.20 the `BNL`/`NO_BNL` hints
control hash join usage (they outlived the block-nested-loop feature they were
named for):

```sql
SELECT /*+ NO_BNL(o, c) */ o.id, c.name
FROM orders o JOIN customers c ON c.id = o.customer_id;
```

`join_buffer_size` bounds MySQL's hash table before it spills to disk.

---

## Trade-offs

Each algorithm buys speed with a different resource, and the "best" one
changes as data grows:

- **Nested loop** trades random I/O for low memory and instant first rows. It
  is the most *fragile* choice: fine at 1,000 outer rows, catastrophic at
  1,000,000, with no warning in between.
- **Hash join** trades memory for a predictable single pass over each side.
  It's robust to bad join-column distributions but collapses when the build
  side outgrows `work_mem`.
- **Merge join** trades a sort for bounded memory. It's the most stable at
  scale and the least likely to blow up, but rarely the cheapest unless the
  ordering already exists.

Raising `work_mem` to fix one hash join is a per-node, per-worker setting —
a query with four hash nodes and two parallel workers can use many multiples
of it. Set it at the session or query level, not globally.

---

## Quick Reference

| Aspect                     | Nested Loop                     | Hash Join                        | Merge Join                    |
| :------------------------- | :------------------------------ | :------------------------------- | :---------------------------- |
| Cost shape                 | outer × inner-lookup            | outer + inner                    | outer + inner (+ sorts)       |
| Needs an index             | Yes, on the inner side          | No                               | Helps (supplies sort order)   |
| Memory use                 | Minimal                         | Build side must fit `work_mem`   | Bounded                       |
| Supports non-equi joins    | Yes                             | No                               | No                            |
| Output ordered             | By outer side                   | No                               | Yes, by join key              |
| Startup cost               | Near zero (good for `LIMIT`)    | High (build must finish first)   | High if sorting               |
| Worst case                 | Full inner scan per outer row   | Spilling to disk (`Batches > 1`) | Two large external sorts      |
| MySQL support              | Yes                             | 8.0.18+                          | Not implemented               |
| PostgreSQL support         | Yes (+ `Memoize`)               | Yes (+ `Parallel Hash`)          | Yes                           |

**Bottom line:** you don't choose the join algorithm — you choose the
conditions that make the right one cheapest. Index the join columns, keep
statistics fresh so row estimates are honest, and give hash/sort nodes enough
`work_mem`. When a plan is wrong, the algorithm is almost never the root
cause; the row estimate feeding it is.
