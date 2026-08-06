# Query Optimization: Finding and Fixing Slow Queries

A practical guide to identifying database bottlenecks and optimizing query performance, covering both MySQL and PostgreSQL.

## Table of Contents

1. [Finding Slow Queries](#finding-slow-queries)
2. [How to Analyze Slow Queries](#how-to-analyze-slow-queries)
3. [How to Fix Slow Queries](#how-to-fix-slow-queries)
4. [Best Practices Checklist](#best-practices-checklist)
5. [PostgreSQL-Specific Tips](#postgresql-specific-tips)
6. [Key Principles](#key-principles)
7. [Quick Reference: MySQL vs PostgreSQL](#quick-reference-mysql-vs-postgresql)
8. [Common Mistakes to Avoid](#common-mistakes-to-avoid)

---

## Finding Slow Queries

### MySQL

#### Step 1: Enable the Slow Query Log

First, identify which queries are actually slow. MySQL's built-in "Slow Query Log" records every query exceeding a threshold (typically 1-2 seconds).

**Check if the slow query log is enabled:**

```sql
SHOW VARIABLES LIKE 'slow_query_log';
```

**Enable it and set the threshold:**

```sql
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;  -- Log queries taking longer than 1 second
```

**Find the log file location:**

```sql
SHOW VARIABLES LIKE 'slow_query_log_file';
```

#### Step 2: Identify the Worst Offenders

With hundreds of slow queries logged, focus on the top 5 that have the highest impact. Use `mysqldumpslow` to summarize and sort by execution time:

```bash
mysqldumpslow -s at -t 10 /var/log/mysql/mysql-slow.log
```

**Output Example:**

```text
Count: 1,236  Time=4.2s (5,191s)  Lock=0.0s  Rows=5023
  SELECT * FROM orders WHERE customer_id = 'S' AND order_date BETWEEN 'S' AND 'S'

Count: 845    Time=3.1s (2,619s)  Lock=0.0s  Rows=125
  SELECT * FROM products WHERE category_id = 'S' ORDER BY price DESC
```

This shows the worst query ran 1,236 times with an average of 4.2 seconds each—fix this first.

---

### PostgreSQL

#### Step 1: Enable pg_stat_statements Extension

PostgreSQL uses the `pg_stat_statements` extension to track query performance statistics. This is built-in but needs to be enabled.

**1.1 Create the extension:**

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

**1.2 Configure in postgresql.conf** (if not already enabled):

PostgreSQL may require a server restart if this is the first time. Add to your `postgresql.conf`:

```ini
shared_preload_libraries = 'pg_stat_statements'
```

Or if you already have other libraries:

```ini
shared_preload_libraries = 'some_other_lib, pg_stat_statements'
```

**Restart PostgreSQL:**

```bash
# On Linux
sudo systemctl restart postgresql

# With Docker
docker restart <your_postgres_container_name>
```

#### Step 2: Query the Top Slow Queries

Get the 10 slowest queries sorted by average execution time (equivalent to `mysqldumpslow -s at -t 10`):

```sql
SELECT 
    query,
    calls,
    ROUND(total_exec_time::numeric, 2) AS total_time_ms,
    ROUND(mean_exec_time::numeric, 2) AS avg_time_ms,
    rows
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

**Output Example:**

```
                                  query                                   | calls | total_time_ms | avg_time_ms | rows
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 SELECT * FROM orders WHERE customer_id = $1 AND order_date BETWEEN $2... |  1236 |      5191.00 |     4200.00 |   59
 SELECT * FROM products WHERE category_id = $1 ORDER BY price DESC        |   845 |      2619.00 |     3100.00 |   20
```

**Optional: Reset Statistics**

When you want a clean slate to focus on new queries:

```sql
SELECT pg_stat_statements_reset();
```

**Bonus: Other Useful Queries**

Find queries using the most total CPU time:

```sql
SELECT 
    query,
    calls,
    ROUND(total_exec_time::numeric, 2) AS total_time_ms,
    ROUND(mean_exec_time::numeric, 2) AS avg_time_ms
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

Find queries called most frequently (potential optimization targets):

```sql
SELECT 
    query,
    calls,
    ROUND(mean_exec_time::numeric, 2) AS avg_time_ms
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 10;
```

---

## How to Analyze Slow Queries

### MySQL

#### Step 3: Run EXPLAIN to Diagnose the Problem

Pick the worst query and run `EXPLAIN` to see what MySQL is doing internally:

```sql
EXPLAIN SELECT * FROM orders
WHERE customer_id = 12345
AND order_date BETWEEN '2025-01-01' AND '2025-12-31';
```

**Sample Output:**

| id  | select_type | table  | type | possible_keys | key  | rows      | Extra       |
| :-- | :---------- | :----- | :--- | :------------ | :--- | :-------- | :---------- |
| 1   | SIMPLE      | orders | ALL  | NULL          | NULL | 2,400,000 | Using where |

#### Step 4: Identify Red Flags

Look for these warning signs that indicate serious performance issues:

| Red Flag                 | Meaning                                                            | Severity     |
| :----------------------- | :----------------------------------------------------------------- | :----------- |
| `type = ALL`             | Full table scan—MySQL reads every single row                       | 💀 DEADLY    |
| `rows = 2,400,000`       | MySQL estimates scanning 2.4M rows to answer the query             | 💀 DEADLY    |
| `key = NULL`             | No index was used                                                  | 💀 DEADLY    |
| `Extra = Using filesort` | Manual in-memory sort instead of index-based sort                  | ⚠️ VERY BAD  |
| `Extra = Using temporary`| Temporary table created (usually for GROUP BY or DISTINCT)         | ⚠️ VERY BAD  |

**In our example:** `type = ALL`, `rows = 2.4M`, `key = NULL`  
**Problem:** MySQL scans the entire orders table to find one customer's orders. This is the bottleneck.

---

### PostgreSQL

#### Step 3: Run EXPLAIN ANALYZE to Diagnose the Problem

PostgreSQL's `EXPLAIN ANALYZE` is more powerful than MySQL's `EXPLAIN`—it actually executes the query and shows real execution statistics (not just estimates):

```sql
EXPLAIN ANALYZE SELECT * FROM orders
WHERE customer_id = 12345
AND order_date BETWEEN '2025-01-01' AND '2025-12-31';
```

**Sample Output:**

```
                                    QUERY PLAN
─────────────────────────────────────────────────────────────────────────────
 Seq Scan on orders  (cost=0.00..89247.00 rows=45 width=32) (actual time=0.12..245.30 rows=45 loops=1)
   Filter: ((customer_id = 12345) AND (order_date >= '2025-01-01'::date) AND (order_date <= '2025-12-31'::date))
   Rows Removed by Filter: 2399955
 Planning Time: 0.102 ms
 Execution Time: 245.401 ms
```

The key insight: **Seq Scan** = full table scan (bad!), actually filtered **2.4M rows** and returned **45**, took **245ms**.

#### Step 4: Identify Red Flags in PostgreSQL

| Red Flag                        | Meaning                                                          | Severity     |
| :------------------------------ | :--------------------------------------------------------------- | :----------- |
| `Seq Scan` (Sequential Scan)    | Full table scan—reads every single row                           | 💀 DEADLY    |
| High `actual time`              | Query took a long time in practice (245.30ms in our example)     | 💀 DEADLY    |
| `Rows Removed by Filter`        | Many rows filtered after scanning (should use index instead)     | 💀 DEADLY    |
| `Sort`                          | Manual sort operation (expensive, should use index)              | ⚠️ VERY BAD  |
| `Hash Aggregate` or `GroupAggregate` | Expensive aggregation operation                          | ⚠️ VERY BAD  |

**In our example:** `Seq Scan` with `2.4M` rows scanned to find `45` results  
**Problem:** Same as MySQL—no index being used, full table scan.

**Bonus: EXPLAIN Formats**

PostgreSQL supports different output formats:

```sql
-- JSON format (great for parsing)
EXPLAIN (FORMAT JSON, ANALYZE) SELECT * FROM orders WHERE customer_id = 12345;

-- Verbose output (shows more details)
EXPLAIN (VERBOSE, ANALYZE) SELECT * FROM orders WHERE customer_id = 12345;
```

---

## How to Fix Slow Queries

### MySQL

#### Step 5: Add the Right Index

Create an index on the columns used in WHERE clauses and JOIN conditions:

```sql
-- Single column index for the most common filter
CREATE INDEX idx_customer_id ON orders(customer_id);

-- Composite index for multiple filtering conditions
CREATE INDEX idx_customer_date ON orders(customer_id, order_date);
```

#### Step 6: Verify the Fix with EXPLAIN

Run EXPLAIN again on the same query to confirm improvement:

```sql
EXPLAIN SELECT * FROM orders
WHERE customer_id = 12345
AND order_date BETWEEN '2025-01-01' AND '2025-12-31';
```

**Expected improvement:**

| id  | select_type | table  | type | possible_keys      | key                | rows | Extra       |
| :-- | :---------- | :----- | :--- | :----------------- | :----------------- | :--- | :---------- |
| 1   | SIMPLE      | orders | ref  | idx_customer_date  | idx_customer_date  | 45   | Using where |

**Much better:** `rows` dropped from 2.4M to 45, and `key` now shows the index being used.

#### Step 7: Covering Index (Optional Advanced Optimization)

A "covering index" includes all columns needed by the query, eliminating the need to fetch from the main table:

```sql
-- Instead of just indexing WHERE clause columns
-- Include the SELECT columns too
CREATE INDEX idx_customer_covering ON orders(customer_id, order_date, total_amount, status);
```

**EXPLAIN result with covering index:**

```sql
EXPLAIN SELECT customer_id, order_date, total_amount FROM orders
WHERE customer_id = 12345
AND order_date BETWEEN '2025-01-01' AND '2025-12-31';
```

You'll see `Extra = Using index`, meaning MySQL never touches the main table—only the index.

---

### PostgreSQL

#### Step 5: Add the Right Index

PostgreSQL has more index types than MySQL (B-tree, Hash, GiST, GIN, BRIN). For most cases, B-tree is the default and best choice:

```sql
-- Single column index
CREATE INDEX idx_customer_id ON orders(customer_id);

-- Composite index for multiple filtering conditions
CREATE INDEX idx_customer_date ON orders(customer_id, order_date);

-- Explicitly specify B-tree (the default)
CREATE INDEX idx_customer_btree ON orders USING BTREE (customer_id, order_date);

-- For range queries, you can specify DESC ordering (if useful)
CREATE INDEX idx_customer_date_desc ON orders(customer_id, order_date DESC);
```

#### Step 6: Verify the Fix with EXPLAIN ANALYZE

Run `EXPLAIN ANALYZE` again to confirm the index is being used:

```sql
EXPLAIN ANALYZE SELECT * FROM orders
WHERE customer_id = 12345
AND order_date BETWEEN '2025-01-01' AND '2025-12-31';
```

**Expected improvement:**

```
                                         QUERY PLAN
──────────────────────────────────────────────────────────────────────────────────
 Index Scan using idx_customer_date on orders  (cost=0.42..125.00 rows=45 width=32) (actual time=0.15..0.25 rows=45 loops=1)
   Index Cond: ((customer_id = 12345) AND (order_date >= '2025-01-01'::date) AND (order_date <= '2025-12-31'::date))
 Planning Time: 0.201 ms
 Execution Time: 0.412 ms
```

**Much better:** Changed from `Seq Scan` to `Index Scan`, and execution time dropped from **245ms** to **0.4ms**—that's 600x faster!

#### Step 7: Covering Index with INCLUDE (PostgreSQL 11+)

PostgreSQL 11+ supports covering indexes using `INCLUDE`. These work like MySQL's covering indexes but with a cleaner syntax:

```sql
-- Include columns that aren't used for filtering but are needed in SELECT
CREATE INDEX idx_customer_covering ON orders(customer_id, order_date) 
  INCLUDE (total_amount, status);
```

Run `EXPLAIN ANALYZE` to see `Index Only Scan`:

```sql
EXPLAIN ANALYZE SELECT customer_id, order_date, total_amount FROM orders
WHERE customer_id = 12345
AND order_date BETWEEN '2025-01-01' AND '2025-12-31';
```

Expected output shows `Index Only Scan`:

```
 Index Only Scan using idx_customer_covering on orders  (cost=0.42..125.00 rows=45 width=32) (actual time=0.12..0.20 rows=45 loops=1)
   Index Cond: ((customer_id = 12345) AND (order_date >= '2025-01-01'::date) AND (order_date <= '2025-12-31'::date))
 Planning Time: 0.201 ms
 Execution Time: 0.320 ms
```

**Index Only Scan** = never touches the main table, only the index—maximum performance!

---

## Best Practices Checklist

### MySQL

- Enable slow query log with appropriate threshold (1-2 seconds)
- Use `mysqldumpslow -s at -t 10` to identify worst offenders
- Run `EXPLAIN` and look for red flags: `type = ALL`, `key = NULL`, `Using filesort`, `Using temporary`
- Create single or composite indexes on WHERE and JOIN columns
- Run `EXPLAIN` again to verify the index is being used
- Test in production during low-traffic windows (adding indexes locks tables)
- Monitor the slow query log for 24 hours to confirm the query is fixed
- Check for unused indexes with `SHOW INDEX FROM table_name` and remove them
- Consider covering indexes for frequently selected columns
- Use composite indexes wisely (column order matters for performance)

### PostgreSQL

- Enable `pg_stat_statements` extension: `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`
- Query slow queries: sort by `mean_exec_time DESC` or `total_exec_time DESC`
- Use `EXPLAIN ANALYZE` to see actual execution statistics (not just estimates)
- Look for red flags: `Seq Scan`, high `actual time`, `Rows Removed by Filter`
- Create B-tree indexes on WHERE and JOIN columns (default index type)
- Run `EXPLAIN ANALYZE` again to verify index is being used
- Test during low-traffic windows (concurrent index creation preferred with `CONCURRENTLY`)
- Use `CONCURRENTLY` when adding indexes to production (avoids table locks)
- Monitor `pg_stat_statements` for 24 hours after optimization
- Check for unused indexes: `SELECT * FROM pg_stat_user_indexes WHERE idx_scan = 0;`
- Consider covering indexes (PostgreSQL 11+) with `INCLUDE` for index-only scans
- Use `ANALYZE table_name;` to update table statistics if query plans seem off

---

## PostgreSQL-Specific Tips

### Creating Indexes Without Locking

PostgreSQL can create indexes concurrently, allowing reads/writes during the process:

```sql
-- Regular index creation (locks the table briefly during completion)
CREATE INDEX idx_customer_date ON orders(customer_id, order_date);

-- Concurrent index creation (safe for production—takes longer but no locks)
CREATE INDEX CONCURRENTLY idx_customer_date ON orders(customer_id, order_date);
```

### Monitoring Index Usage

Find unused indexes (candidates for deletion to speed up INSERT/UPDATE):

```sql
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY idx_blks_read DESC;
```

Find the most used indexes:

```sql
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC
LIMIT 10;
```

### Updating Statistics

PostgreSQL uses table statistics to plan queries. If indexes aren't being used, try updating statistics:

```sql
ANALYZE table_name;  -- Update stats for one table

ANALYZE;  -- Update stats for entire database
```

### Comparing Plan Performance

Use `EXPLAIN (FORMAT JSON)` to compare plans before and after indexing:

```sql
EXPLAIN (FORMAT JSON, ANALYZE) SELECT * FROM orders
WHERE customer_id = 12345
AND order_date BETWEEN '2025-01-01' AND '2025-12-31';
```

---

## Key Principles

### The Golden Rule: Measure First

> Never optimize a query you haven't measured.

**The Wrong Way (Guesswork):**
```
Developer: "I think adding an index here will help." 
→ Adds random indexes everywhere 
→ Slows down INSERT/UPDATE operations 
→ Original query unchanged
```

**The Right Way (Data-Driven):**

1. Check the slow query log
2. Run EXPLAIN
3. Identify the specific problem (e.g., full table scan)
4. Add the exact index needed
5. Measure and verify the improvement

### Index Trade-offs

- ✅ Indexes speed up SELECT queries
- ❌ Indexes slow down INSERT, UPDATE, DELETE operations
- ❌ Indexes consume disk space

**Solution:** Only create indexes that solve identified problems; remove unused indexes.

---

## Quick Reference: MySQL vs PostgreSQL

| Task                               | MySQL                                          | PostgreSQL                                     |
| :--------------------------------- | :--------------------------------------------- | :--------------------------------------------- |
| Find slow queries                  | `mysqldumpslow -s at -t 10 /path/to/log`       | `SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC;` |
| Analyze a query                    | `EXPLAIN SELECT ...`                           | `EXPLAIN ANALYZE SELECT ...`                  |
| Full table scan indicator          | `type = ALL`                                   | `Seq Scan`                                     |
| No index indicator                 | `key = NULL`                                   | `Seq Scan` or `Index` showing 0 usage          |
| Create single index                | `CREATE INDEX idx_name ON table(col);`         | `CREATE INDEX idx_name ON table(col);`        |
| Create composite index             | `CREATE INDEX idx_name ON table(col1, col2);`  | `CREATE INDEX idx_name ON table(col1, col2);` |
| Safe production indexing           | Use during low traffic                         | `CREATE INDEX CONCURRENTLY idx_name ...`      |
| Covering index                     | Part of index, automatic                       | `CREATE INDEX ... INCLUDE (col1, col2);`      |
| Find unused indexes                | Manual inspection                              | `SELECT * FROM pg_stat_user_indexes WHERE idx_scan = 0;` |
| Reset statistics                   | Restart slow query log                         | `SELECT pg_stat_statements_reset();`          |
| Update query statistics            | Automatic (mostly)                             | `ANALYZE table_name;`                         |

---

## Common Mistakes to Avoid

❌ **Mistake 1:** Adding indexes without measuring first  
✅ **Fix:** Always use slow query logs to identify problems before optimizing

❌ **Mistake 2:** Creating too many indexes  
✅ **Fix:** Each index slows INSERT/UPDATE; only create indexes that solve identified problems

❌ **Mistake 3:** Using wrong column order in composite indexes  
✅ **Fix:** Put filtering columns first, then sorting columns: `INDEX(customer_id, order_date)`

❌ **Mistake 4:** Adding indexes during peak traffic  
✅ **Fix:** Use MySQL's low-traffic windows or PostgreSQL's `CONCURRENTLY` option

❌ **Mistake 5:** Not monitoring after optimization  
✅ **Fix:** Check slow query logs for 24 hours post-deployment to confirm improvement