# Fundamentals

The entry point to the whole database track. It assumes you have written CRUD
through an ORM, seen a `WHERE` clause, and never really learned SQL itself.

Everything later in this track — indexes, query plans, transactions, tuning —
assumes you can read a query and say what it means before you ask why it is
slow. That is what this folder builds. By the end you should be able to open
`psql` against an unfamiliar database and answer a real question about the data
without help.

The examples use one SaaS schema throughout: `companies`, `users`, `projects`,
`tasks`, `invoices`, `notifications`. Every later folder reuses it.

## Files

1. [What Is a Relational Database](01-what-is-a-relational-database.md) — why a
   file is not enough, what "relational" really means, where the database sits
   relative to your app, why SQL being declarative forces a query planner to
   exist, and ACID named.
2. Tables, Rows and Data Types —
   [Part 1](02-tables-rows-and-data-types-part-1.md): `CREATE TABLE` line by
   line, the PostgreSQL types worth knowing, money in a float, `timestamp` vs
   `timestamptz`, `text` vs `varchar`. ·
   [Part 2](02-tables-rows-and-data-types-part-2.md): `NULL` explained properly,
   defaults and identity columns, altering a table, and how a row is stored.
3. SQL Basics: CRUD —
   [Part 1](03-sql-basics-crud-part-1.md): `SELECT` built up gradually, the
   logical order of evaluation, and filtering. ·
   [Part 2](03-sql-basics-crud-part-2.md): `INSERT ... RETURNING`, safe
   `UPDATE`/`DELETE`, upserts, set operations, and practical `psql`.
4. Joins Explained —
   [Part 1](04-joins-explained-part-1.md): every join type with real output,
   `ON` vs `WHERE`, and joining four tables. ·
   [Part 2](04-joins-explained-part-2.md): row fan-out and the wrong invoice
   total, semi-joins and anti-joins, and `LATERAL`.
5. Aggregations and Grouping —
   [Part 1](05-aggregations-and-grouping-part-1.md): `GROUP BY` as buckets,
   `HAVING` vs `WHERE`, and NULLs in aggregates. ·
   [Part 2](05-aggregations-and-grouping-part-2.md): `FILTER`, real reporting
   queries, subtotals, and why `count(*)` is slow in PostgreSQL.
6. CTEs and Window Functions —
   [Part 1](06-ctes-and-window-functions-part-1.md): readable query pipelines,
   the optimization fence, and recursive CTEs. ·
   [Part 2](06-ctes-and-window-functions-part-2.md): window functions from the
   core idea to frame clauses, and what they cost.

## Read in this order

Strictly 1 → 6. Each file uses the vocabulary of the one before it:

```text
01 concepts  →  02 types & NULL  →  03 CRUD & evaluation order
                                          ↓
          06 CTEs & windows  ←  05 grouping  ←  04 joins
```

Files 4, 5 and 6 are a chain: joins create the row fan-out that breaks
aggregates, and window functions are aggregates that do not collapse rows. Do
not skip 04's "row multiplication" section or 03's "logical order of
evaluation" — later folders assume both.

One file per sitting. Answer its "Questions to Test Yourself" from memory the
next day before moving on.

## What you should be able to do after this folder

- Explain what a relational database is, and where it sits relative to your
  application, without hand-waving.
- Choose the right column type for money, time, text and identifiers, and say
  what breaks if you choose wrong.
- Predict what `NULL` will do in a comparison, a `NOT IN`, an aggregate and a
  `UNIQUE` constraint.
- Write a multi-table `SELECT` with joins, filters, grouping and ordering, and
  say in which order the database evaluates them.
- Spot the two silent join bugs — a `WHERE` on the right side of a `LEFT JOIN`,
  and a fan-out that doubles a `SUM`.
- Write an upsert, an anti-join, a top-N-per-group query and a running total.
- Run a destructive statement safely: `SELECT` the filter first, wrap it in a
  transaction, check the row count.
- Use `psql` well enough to explore a schema you have never seen.

## Where this connects

- **Designing the tables** you are now able to query →
  [data-modeling/](../data-modeling/)
- **Why a query is slow** and how the planner decided →
  [query-planner/reading-query-plans.md](../query-planner/reading-query-plans.md)
- **Making a slow query fast** → [query-optimization/](../query-optimization/)
- **What happens when two users write at once** →
  [transactions-and-concurrency/](../transactions-and-concurrency/)
- **The application side** — ORMs, migrations, pooling →
  [backend-fundamentals/10-database-integration/](../../backend-fundamentals/10-database-integration/)

## Next

[data-modeling/](../data-modeling/) — turning what you now know about tables,
types and keys into a schema that still works in a year.
