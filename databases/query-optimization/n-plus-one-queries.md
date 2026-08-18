# The N+1 Query Problem

N+1 happens when your code runs one query to fetch a list of N rows, then
loops over them and fires one more query *per row* to fetch related data —
1 query becomes N+1 queries. It's the single most common cause of "the app is
slow" that has nothing to do with missing indexes.

## Table of Contents

1. [What N+1 Looks Like](#what-n1-looks-like)
2. [Why It's So Damaging](#why-its-so-damaging)
3. [How to Spot It](#how-to-spot-it)
4. [Fixing It: JOIN](#fixing-it-join)
5. [Fixing It: Batch Loading (IN clause)](#fixing-it-batch-loading-in-clause)
6. [ORM-Specific Notes](#orm-specific-notes)
7. [When N+1 Is Actually Fine](#when-n1-is-actually-fine)
8. [Quick Reference](#quick-reference)

---

## What N+1 Looks Like

```python
# 1 query: get all orders
orders = db.query("SELECT id, customer_id FROM orders LIMIT 50")

# N queries: one per order, fetching the customer
for order in orders:
    customer = db.query(
        "SELECT name FROM customers WHERE id = %s", order.customer_id
    )
```

50 orders means **51 total queries** (1 + 50) to render one page. At 100
orders, it's 101. The query count scales linearly with the result set — the
exact opposite of what you want.

This is rarely written by hand like this; it almost always comes from an
ORM lazily loading a relationship inside a loop:

```python
# Django — looks innocent, is N+1
for order in Order.objects.all()[:50]:
    print(order.customer.name)   # each .customer triggers a new query
```

## Why It's So Damaging

- **Network round-trips dominate.** Each query pays connection/round-trip
  latency even if the query itself is fast — 50 queries at 2ms each is
  100ms, versus one query at 5ms.
- **It scales with data, not code.** The bug is invisible with 5 test rows
  and catastrophic with 5,000 production rows.
- **It compounds.** Nested relationships (orders → customers → addresses)
  can turn N+1 into N×M+1 or worse.

---

## How to Spot It

### MySQL

Enable the slow query log (see [slow-query-fixes.md](slow-query-fixes.md)),
then look for the *pattern*, not just slow individual queries — many
fast, near-identical queries in a row is the signature:

```sql
SELECT name FROM customers WHERE id = 101;
SELECT name FROM customers WHERE id = 102;
SELECT name FROM customers WHERE id = 103;
-- ...repeated 50 times with only the id changing
```

`mysqldumpslow` groups these by normalized query shape, so N+1 shows up as
one entry with a high `Count`:

```bash
mysqldumpslow -s c -t 10 /var/log/mysql/mysql-slow.log
# Count: 5,000  Time=0.002s ...
#   SELECT name FROM customers WHERE id = 'N'
```

A `Count` in the thousands for a single-row lookup is the classic N+1
fingerprint.

### PostgreSQL

Same idea with `pg_stat_statements` — sort by `calls` instead of
`mean_exec_time`:

```sql
SELECT query, calls, mean_exec_time
FROM pg_stat_statements
WHERE query LIKE 'SELECT%customers%'
ORDER BY calls DESC
LIMIT 10;
```

A query with a normal-looking `mean_exec_time` but a huge `calls` count is
almost certainly being fired in a loop.

### Application-Level

Most ORMs offer a query counter or debug toolbar:

```python
# Django
from django.test.utils import CaptureQueriesContext
with CaptureQueriesContext(connection) as ctx:
    render_page()
print(len(ctx.captured_queries))  # 51 instead of ~3 is your smoking gun
```

---

## Fixing It: JOIN

Pull the related data in the same query using a `JOIN` — 1 query total,
regardless of how many orders there are:

```sql
SELECT o.id, o.customer_id, c.name
FROM orders o
JOIN customers c ON c.id = o.customer_id
LIMIT 50;
```

This works identically in MySQL and PostgreSQL. It's the right fix for a
1-to-1 or many-to-1 relationship (many orders, one customer each).

**Watch out for row multiplication:** joining a 1-to-many relationship
(one order, many line items) duplicates the "one" side's columns per
matching row. Fine if you're aggregating; wasteful if you just wanted the
order once.

## Fixing It: Batch Loading (IN clause)

For 1-to-many relationships, or when you want to keep result sets flat,
collect the IDs first and fetch related rows in a single batched query:

```sql
-- Query 1: get the orders
SELECT id, customer_id FROM orders LIMIT 50;

-- Query 2: fetch ALL related customers in one round-trip
SELECT id, name FROM customers
WHERE id IN (101, 102, 103, /* ...all 50 ids */);
```

2 queries total instead of 51 — then join the results in application
memory (a dictionary/map keyed by `id`).

```python
orders = db.query("SELECT id, customer_id FROM orders LIMIT 50")
customer_ids = [o.customer_id for o in orders]

customers = db.query(
    "SELECT id, name FROM customers WHERE id IN %s", (tuple(customer_ids),)
)
customers_by_id = {c.id: c for c in customers}

for order in orders:
    order.customer = customers_by_id[order.customer_id]
```

**MySQL note:** very large `IN (...)` lists (tens of thousands of values)
can be slower than a `JOIN` — benchmark past a few thousand IDs.

**PostgreSQL note:** `= ANY(ARRAY[...])` is equivalent to `IN` and often
preferred when passing an array parameter from application code:

```sql
SELECT id, name FROM customers WHERE id = ANY(%s);
```

---

## ORM-Specific Notes

Most ORMs have an explicit "eager load" mechanism — use it instead of
letting relationships lazy-load inside a loop:

| ORM               | Lazy (causes N+1)        | Eager-load fix                          |
| :------------------ | :-------------------------- | :------------------------------------------ |
| Django              | `order.customer`             | `.select_related('customer')` (JOIN)         |
| Django (1-to-many)   | `order.line_items.all()`     | `.prefetch_related('line_items')` (batch)    |
| SQLAlchemy           | default lazy relationship    | `joinedload()` or `selectinload()`           |
| Sequelize (Node)     | `order.getCustomer()`        | `include: [Customer]`                        |
| ActiveRecord (Rails) | `order.customer`             | `.includes(:customer)`                        |

The eager-load option name usually tells you which fix it applies:
"joined"/"select_related" → JOIN under the hood; "prefetch"/"selectin"/
"includes" → batched second query under the hood.

---

## When N+1 Is Actually Fine

Don't reflexively "fix" every loop that touches the database:

- **Small, bounded N** (e.g., looping over 3 filter tabs, not 3,000 rows) —
  the round-trip cost is negligible.
- **Admin/one-off scripts** run once, not on a hot request path.
- **Genuinely independent queries** that don't share a pattern — that's not
  N+1, that's just multiple queries.

Optimize based on what the slow query log or query counter actually shows,
not on reflexively batching every loop.

---

## Quick Reference

| Symptom                                             | Cause                          | Fix                                  |
| :----------------------------------------------------- | :--------------------------------- | :--------------------------------------- |
| Same query shape repeated N times, few ms each          | Lazy-loaded relationship in a loop  | `JOIN` (many-to-one) or batch `IN` (one-to-many) |
| Query count scales with result set size                 | N+1                                 | Eager-load via ORM, or rewrite manually  |
| `mysqldumpslow` shows huge `Count`, tiny `Time` each     | N+1 in MySQL                        | Same as above                            |
| `pg_stat_statements` shows huge `calls`, small `mean_exec_time` | N+1 in PostgreSQL              | Same as above                            |

**Bottom line:** one query that does more work almost always beats many
queries that each do less. Reach for `JOIN` when fetching one related row
per parent; reach for batched `IN`/`ANY` when fetching many related rows per
parent.
