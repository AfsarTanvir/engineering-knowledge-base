# Databases

Weeks 6–8 of [doc/career-roadmap.md](../doc/career-roadmap.md), expanded into a
full learning track.

The roadmap's goal for this block is blunt: **PostgreSQL should become one of
your strongest areas.** Not "I can write a SELECT" — but "I can look at a slow
endpoint, read the query plan, and explain exactly why the database chose that
plan and what to change."

Every folder goes from absolute beginner to production depth. Explanations are
in plain English, with diagrams, tables, and runnable SQL against one consistent
SaaS schema (users, companies, projects, tasks, invoices, notifications).

## Roadmap

| # | Folder | What it answers |
|---|---|---|
| 1 | [fundamentals/](fundamentals/) | What a relational database is, and how to actually query it |
| 2 | [data-modeling/](data-modeling/) | How to design tables that will not hurt you in a year |
| 3 | [indexing/](indexing/) | How indexes really work, and when they help or hurt |
| 4 | [query-optimization/](query-optimization/) | Making a slow query fast |
| 5 | [query-planner/](query-planner/) | Why the database chose that plan |
| 6 | [query-patterns/](query-patterns/) | Writing queries that stay fast as data grows |
| 7 | [transactions-and-concurrency/](transactions-and-concurrency/) | What happens when two users hit the same row |
| 8 | [operations/](operations/) | Pooling, vacuum, replicas, and keeping it healthy |

## Suggested order

If you are starting from scratch, read in this order:

```text
fundamentals  →  data-modeling  →  indexing  →  query-planner
                                        ↓
   operations  ←  transactions-and-concurrency  ←  query-optimization
                                                          ↕
                                                   query-patterns
```

Do not read a whole folder in one day. See the daily routine in the
[roadmap](../doc/career-roadmap.md): one file, then answer its questions from
memory the next day.

## Status

- [x] fundamentals — 12 files
- [x] data-modeling — 13 files
- [x] indexing — 7 files
- [x] query-optimization — 7 files
- [x] query-planner — 3 files
- [x] query-patterns — 4 files
- [x] transactions-and-concurrency — 13 files
- [x] operations — 9 files

Longer topics are split into `-part-1` / `-part-2` files so no single file runs
past ~500 lines. Each part stands on its own: its own contents, common
mistakes, and self-test questions, with links between the parts.

## What you should be able to do after this track

- Design a schema with the right keys, constraints, and types — and explain each choice.
- Read `EXPLAIN ANALYZE` output and say why a plan is slow.
- Choose the right index for a query, and know when an index is the wrong answer.
- Explain what a transaction guarantees, what an isolation level prevents, and where a deadlock comes from.
- Diagnose a slow endpoint from the database side rather than guessing.
- Size a connection pool and explain why a bigger pool is often slower.

## Related tracks

- **Application-side database work** — ORMs, migrations, transactions in code,
  pooling configuration, test data →
  [backend-fundamentals/10-database-integration/](../backend-fundamentals/10-database-integration/)
- **Scaling beyond one database** — replication, sharding, caching, CAP →
  [system-design/foundational/](../system-design/foundational/)

## Reading the diagrams

Files use [Mermaid](https://mermaid.js.org/) diagrams, which render on GitHub.
To read them locally with the repo's own viewer:

```
utils/markdown-viewer.html?file=databases/fundamentals/01-what-is-a-relational-database.md
```
