# Part 10 — Database Integration

Part 9 decided *where* your code lives: controllers, services, repositories.
This part answers the next question: **how does that code actually talk to the
database, and what goes wrong when it does?**

This is not a part about SQL performance. It is about the seam between your
application process and your database server. That seam is where a surprising
number of production incidents are born: a migration that locks a table for
four minutes, a transaction left open while the code waits on a Stripe call, a
connection pool that empties because of one missing `finally`, an ORM that
quietly runs 200 queries to render one page.

Every one of those is a boundary problem. None of them are fixed by a better
index.

> **Query tuning lives somewhere else.** Indexes, query plans, N+1 fixes,
> pagination performance, slow queries and bulk writes are already covered in
> depth in [databases/](../../databases/). This part links to that folder
> instead of repeating it. Rule of thumb: *if the question is "why is this
> query slow?", go to `databases/`. If the question is "how does my app get
> this query to the database at all?", stay here.*

## Files

1. [ORM vs Query Builder](01-orm-vs-query-builder.md) — the three ways to talk
   to a database, what an ORM really does, the convenience that costs you
   queries, and how to keep the ORM at the edge of your code.
2. [Migrations — Part 1](02-migrations-part-1.md) — versioned schema changes,
   how a migration runner works, writing `up` and `down`, schema versus data
   migrations, and running migrations in CI/CD.
3. [Migrations — Part 2](02-migrations-part-2.md) — zero-downtime
   expand/contract, renaming a column across three deploys, the dangerous
   PostgreSQL operations, the lock queue, and safe backfills.
4. [Transactions — Part 1](03-transactions-part-1.md) — ACID in plain words,
   the callback style, keeping transactions short, and why an HTTP call inside
   one is a bug.
5. [Transactions — Part 2](03-transactions-part-2.md) — isolation levels and
   the anomalies they prevent, locking, deadlocks and retries.
6. [Connection Pooling](04-connection-pooling.md) — why connections are
   expensive, how to size a pool (smaller than you think), pool leaks,
   PgBouncer, serverless connection storms, and graceful shutdown.
7. [Seeding and Test Data — Part 1](05-seeding-and-test-data-part-1.md) —
   seeds, factories and fixtures, idempotent reference data, realistic
   development volume, typed factories, and deterministic test data.
8. [Seeding and Test Data — Part 2](05-seeding-and-test-data-part-2.md) — test
   isolation with transaction rollback, parallel test runs, and why production
   data must never reach a laptop unanonymised.

## Read in this order

Read 1 → 8 in order, one file per sitting. The order is deliberate.

File 1 sets the vocabulary (model, relation, repository). Files 2–3 change the
shape of the data. Files 4–5 change the data itself, safely. File 6 explains
the resource that all of them consume — and file 4's "keep transactions short"
rule only makes full sense after you understand the pool. Files 7–8 are how you
get believable data in front of all of it.

If you only have time for two sections in this whole part, read
*Expand and contract* in file 3 and *Sizing the pool* in file 6. Those two
cause the most production pain per line of code.

## What you should be able to do after this part

- Look at a piece of ORM code and predict how many SQL queries it will run,
  then prove it by reading the query log.
- Take a column rename and split it into three deploys that never break the
  running application.
- Name three operations that lock a large PostgreSQL table, and give the safe
  alternative for each.
- Write a transaction that cannot leak a half-finished change, and explain why
  an HTTP call inside it is a bug.
- Calculate a safe pool size from `max_connections` and your instance count,
  and explain why doubling the pool usually makes things slower.
- Set up test data so that every test starts from the same known state, and
  explain why copying the production database to your laptop is not an option.

## Where this connects

- Query performance, indexes and plans: [databases/](../../databases/).
- The layer that should own the database calls:
  [Part 9 — Application Architecture](../09-application-architecture/).
- Running migrations as a deploy step:
  [cloud-devops/ci-cd/overview.md](../../cloud-devops/ci-cd/overview.md) and
  [rolling-updates](../../cloud-devops/deployment-strategies/rolling-updates.md).
- Reads served from replicas:
  [database-replication](../../system-design/foundational/database-replication.md).

## Next

Part 11 — [API Security](../11-api-security/) takes the input that reaches
these queries and asks what an attacker can do with it.
