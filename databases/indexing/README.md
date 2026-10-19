# Indexing

How an index actually works, and — just as important — when adding one is the
wrong answer.

Folder 3 of the [databases track](../README.md). Every file uses the same SaaS
schema — `companies`, `users`, `projects`, `tasks`, `invoices`,
`notifications` — so the examples build on each other.

The theme running through these files: **an index is a trade, not a gift.** You
buy faster reads with slower writes, more disk, more memory and more
maintenance. A good engineer can say what each index in a database is for, and
can defend the ones that are missing.

## Files

| # | File | What it answers |
|---|---|---|
| 1 | [01-how-indexes-work-part-1.md](01-how-indexes-work-part-1.md) | What a B-tree is, and how three page reads find one row among millions |
| 2 | [01-how-indexes-work-part-2.md](01-how-indexes-work-part-2.md) | The scan types a planner can choose, why a sequential scan is sometimes correct, and what an index costs |
| 3 | [02-expression-and-functional-indexes.md](02-expression-and-functional-indexes.md) | Why `WHERE LOWER(email) = ...` ignores your index, and how to index the expression instead |
| 4 | [03-when-not-to-index-part-1.md](03-when-not-to-index-part-1.md) | The write tax, HOT updates, and the cases where an index does nothing |
| 5 | [03-when-not-to-index-part-2.md](03-when-not-to-index-part-2.md) | Finding redundant, duplicate and unused indexes, and retiring one safely |
| 6 | [04-index-maintenance-and-bloat.md](04-index-maintenance-and-bloat.md) | Bloat, `REINDEX CONCURRENTLY`, `ANALYZE`, `fillfactor`, and a maintenance routine |

## Read order

Read them in order. File 01 is the foundation — the rest assume you can picture
a B-tree and read a plan node.

```text
01 how indexes work (part 1 → part 2)
            ↓
02 expression indexes  →  03 when not to index (part 1 → part 2)
                                      ↓
                        04 maintenance and bloat
```

If you only have time for two, read **01 part 2** and **03 part 1**: the scan
types and the write tax are what most day-to-day index decisions come down to.

## How this folder relates to `../query-optimization/`

This folder is about **the index itself** — the data structure, its cost, and
its upkeep. [query-optimization/](../query-optimization/) is about **choosing
the right index for a specific slow query**. They do not overlap; they are read
together.

| Question | Where it is answered |
|---|---|
| What does a B-tree look like inside? | here, [01 part 1](01-how-indexes-work-part-1.md) |
| Which index type suits this data shape? | [index-types-deep-dive.md](../query-optimization/index-types-deep-dive.md) |
| Which column goes first in `(a, b)`? | [composite-index-ordering.md](../query-optimization/composite-index-ordering.md) |
| How do I avoid touching the table at all? | [covering-indexes.md](../query-optimization/covering-indexes.md) |
| How do I index only the rows I query? | [partial-indexes.md](../query-optimization/partial-indexes.md) |
| Why is this index never used? | here, [03 part 2](03-when-not-to-index-part-2.md) |

## Before this folder

[fundamentals/](../fundamentals/) for `SELECT`, `JOIN` and `WHERE`, and
[data-modeling/](../data-modeling/) for keys and constraints — several
constraints create indexes for you, and this folder assumes you know which.

## What you should be able to do after this folder

- Draw a B-tree and explain why a lookup costs three or four page reads
  regardless of table size.
- Read a plan and name the access method: sequential scan, index scan,
  index-only scan, or bitmap index scan.
- Explain to a colleague why the planner chose a sequential scan **and was
  right**.
- Fix a query that ignores an index because of a function, a type mismatch, or
  a leading wildcard.
- Say out loud what a new index will cost on writes before you create it.
- Find every duplicate, redundant and unused index in a live database, and
  retire one without breaking anything.
- Add an index to a busy production table without blocking writes.
- Measure index bloat and decide whether it needs a `REINDEX CONCURRENTLY`.
