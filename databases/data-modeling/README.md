# Data Modeling

How to design a schema that will still be workable in two years.

Folder 2 of the [databases track](../README.md). Every file uses the same SaaS
schema — `companies`, `users`, `projects`, `tasks`, `invoices`,
`notifications` — so the examples build on each other rather than restarting.

The theme running through all six files: **the database is the last place a
rule can be guaranteed.** Application code changes, services multiply, and
someone will always write to your tables from somewhere you did not expect. A
key, a constraint, a type — those hold for every writer, forever.

## Files

| # | File | What it answers |
|---|---|---|
| 1 | [01-keys-and-relationships-part-1.md](01-keys-and-relationships-part-1.md) | What identifies a row, natural vs surrogate keys, and which key type to pick |
| 2 | [01-keys-and-relationships-part-2.md](01-keys-and-relationships-part-2.md) | The three relationship shapes, join tables, `ON DELETE`, trees, and unindexed foreign keys |
| 3 | [02-constraints-and-data-integrity-part-1.md](02-constraints-and-data-integrity-part-1.md) | Why the database is the only real guarantee, and `NOT NULL`, `CHECK` and `UNIQUE` in depth |
| 4 | [02-constraints-and-data-integrity-part-2.md](02-constraints-and-data-integrity-part-2.md) | `EXCLUDE`, enum strategies, catching violations in code, and constraining a table that already has bad data |
| 5 | [03-normalization-part-1.md](03-normalization-part-1.md) | The three anomalies, and 1NF, 2NF and 3NF worked through on one table |
| 6 | [03-normalization-part-2.md](03-normalization-part-2.md) | BCNF onward, what normalization costs, when to stop, and optional or variant data |
| 7 | [04-denormalization-and-read-models-part-1.md](04-denormalization-and-read-models-part-1.md) | The forms a deliberate copy takes: duplicated columns, counters, summary tables, arrays |
| 8 | [04-denormalization-and-read-models-part-2.md](04-denormalization-and-read-models-part-2.md) | The trade-off table, how copies drift, materialized views, caching, and what to check first |
| 9 | [05-postgres-data-types-part-1.md](05-postgres-data-types-part-1.md) | Time and money — the two type choices that cause the most expensive bugs |
| 10 | [05-postgres-data-types-part-2.md](05-postgres-data-types-part-2.md) | `jsonb`, arrays, `uuid`, ranges, enums, collation, and the binary types |
| 11 | [06-schema-design-patterns-part-1.md](06-schema-design-patterns-part-1.md) | Naming, audit columns, soft deletes, and multi-tenancy keys |
| 12 | [06-schema-design-patterns-part-2.md](06-schema-design-patterns-part-2.md) | Status columns, money and currency, event tables, nullability, and the review checklist |

## Read order

Read them in order. Files 3 and 4 are a deliberate pair — the second argues
against the first, and only makes sense once you believe the first.

```text
01 keys  →  02 constraints  →  03 normalization  →  04 denormalization
                                                            ↓
                          06 patterns  ←  05 types
```

If you only have time for two, read **01** and **06**: the key choice and the
naming/tenancy/soft-delete decisions are the ones that are hardest to change
later.

## Before this folder

[fundamentals/](../fundamentals/) — what a table is, what `SELECT` and `JOIN`
do, and the basic type catalogue. This folder assumes all of it.

## After this folder

[indexing/](../indexing/) — the schema above tells you *what* to store; indexing
tells you how to find it quickly. Several sections here point forward into it.

## What you should be able to do after this folder

- Choose a primary key type for any table and defend the choice on size, index
  locality, guessability and client generation.
- Model one-to-many, many-to-many and one-to-one relationships in DDL, and say
  when a one-to-one split is actually wrong.
- Pick the right `ON DELETE` action per foreign key, and explain what `CASCADE`
  would destroy.
- Find every unindexed foreign key in a database and explain why it makes
  parent deletes slow.
- Enforce a business rule with a `CHECK`, a partial unique index, or an
  `EXCLUDE` constraint, and turn its violation into a clean `409`.
- Explain the three normalization anomalies with a concrete example of each.
- Recognise a normalization problem in a schema you inherited.
- Denormalize deliberately, and write the reconciliation query that catches the
  drift before a customer does.
- Say why `timestamptz` is always right for an instant, and fix a recurring
  reminder that fires an hour late twice a year.
- Decide whether a field belongs in a column, a `jsonb` payload, or a separate
  table.
- Make cross-tenant references impossible at the database level.
- Run a schema review against any table someone hands you.
