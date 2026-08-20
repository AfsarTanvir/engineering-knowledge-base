# SELECT *: Why It Hurts Performance

`SELECT *` is convenient to type and easy to forget about. It also quietly
disables some of the cheapest optimizations a database offers — covering
indexes, minimal I/O, stable client contracts — trading a few keystrokes for
a cost that compounds with every row and every call site.

## Table of Contents

1. [What SELECT * Actually Costs](#what-select-actually-costs)
2. [Defeats Covering Indexes](#defeats-covering-indexes)
3. [Extra IO and Network Overhead](#extra-io-and-network-overhead)
4. [MySQL Specifics](#mysql-specifics)
5. [PostgreSQL Specifics](#postgresql-specifics)
6. [Schema Fragility](#schema-fragility)
7. [When SELECT * Is Fine](#when-select-is-fine)
8. [How to Fix It](#how-to-fix-it)
9. [Quick Reference](#quick-reference)

---

## What SELECT * Actually Costs

The cost isn't just "more bytes come back." Pulling every column can change
which access path the optimizer even considers — turning a query that could
be answered entirely from an index into one that has to visit the full
table row for every match.

## Defeats Covering Indexes

A [covering index](../query-optimization/covering-indexes.md) lets the
database answer a query straight from the index, skipping the table
entirely — but only if every selected column is in the index.

```sql
-- Index: (customer_id, order_date) INCLUDE (total_amount)

-- Can be answered entirely from the index (Index Only Scan)
SELECT customer_id, order_date, total_amount
FROM orders WHERE customer_id = 12345;

-- Forces a table lookup for every matched row — the covering
-- index doesn't help at all, because status/notes/etc aren't in it
SELECT * FROM orders WHERE customer_id = 12345;
```

The extra columns don't have to be useful to the caller — their mere
presence in the `SELECT` list is enough to force the lookup.

## Extra IO and Network Overhead

Pulling large `TEXT`/`BLOB`/`JSON` columns you don't use inflates the result
set: more bytes read from disk, more bytes serialized, more bytes sent over
the wire, more client-side memory spent deserializing them. On a single ad
hoc query this is noise. On a high-traffic endpoint or a tight loop, the
per-row waste multiplies with every call.

---

## MySQL Specifics

InnoDB stores row data clustered by the primary key. If a query could
otherwise be answered from a secondary index alone, `SELECT *` forces a
**bookmark lookup** back into the clustered index for every matched row —
one extra random I/O per row that a narrower `SELECT` would have avoided.

`BLOB`/`TEXT` columns are frequently stored off-page; `SELECT *` pulls them
into memory and across the wire even when the caller immediately discards
them.

## PostgreSQL Specifics

Large column values (`text`, `jsonb`, `bytea`) may be compressed and stored
out-of-line via **TOAST** (The Oversized-Attribute Storage Technique).
`SELECT *` forces Postgres to detoast every such column in every returned
row — decompression work paid even when the client never reads the value.

The same covering-index effect applies: a query that could run as an
`Index Only Scan` degrades to a regular `Index Scan` with heap fetches the
moment an uncovered column enters the `SELECT` list, visible directly in
`EXPLAIN ANALYZE`.

---

## Schema Fragility

- **Adding a column changes every `SELECT *` caller's result shape** —
  silently, with no error. Code that maps result columns by position
  (rather than by name) breaks the moment a column is added or reordered.
- **ORMs often issue `SELECT *` by default** (`Model.objects.all()`,
  `Model.all` in ActiveRecord). Check whether your ORM supports narrowing
  the projection (`.only()`, `.values_list()`, explicit `select(:col)`) and
  use it on hot paths.
- **API responses that mirror a `SELECT *`** grow every time someone adds a
  column to the underlying table — a `internal_notes` or `password_hash`
  column added later can end up silently exposed through an endpoint that
  was never updated to account for it. This is as much a security concern
  as a performance one.

---

## When SELECT * Is Fine

- One-off interactive debugging in a `psql`/`mysql` shell.
- A narrow, stable lookup/config table where "all columns" already *is* the
  intended contract.
- Existence checks aren't a `SELECT *` case at all — use `SELECT 1` (or
  `EXISTS`, see
  [subqueries-vs-joins-vs-ctes.md](subqueries-vs-joins-vs-ctes.md)) instead
  of pulling full rows just to check whether something exists.
- Admin/migration scripts run once, off the hot path.

## How to Fix It

- List the exact columns the caller needs, always, in application code.
- Configure the ORM to select only the fields actually used by that call
  site rather than the full model by default.
- Add a lint/code-review rule flagging `SELECT *` outside migrations and ad
  hoc consoles.
- Replace existence checks that pull full rows with `SELECT 1` /
  `SELECT COUNT(*)` / `EXISTS`.

---

## Quick Reference

| Cost                        | Cause                                              | Fix                              |
| :----------------------------- | :------------------------------------------------------ | :------------------------------------ |
| Table lookup despite an index    | Selected columns aren't all in the covering index         | List only the columns actually needed  |
| Wasted I/O and network transfer  | Large TEXT/BLOB/JSON columns pulled but unused             | Narrow the `SELECT` list                |
| Silent behavior change on schema change | Column added/reordered, positional mapping breaks   | Select by name; version API contracts   |
| Accidental data exposure         | New sensitive column added to a table an API mirrors       | Explicit column lists on any external-facing query |

**Bottom line:** name the columns you need. It costs a few extra characters
and buys back covering-index eligibility, less I/O, and a result shape that
doesn't change out from under you the next time someone alters the table.
