# Transactions and ACID — Part 2

Part 1 defined the transaction and walked through the four letters of ACID,
ending at the moment `COMMIT` returns. This part is about the decisions you
make around that boundary: how far a transaction should reach, what must never
be inside it, and the damage an open transaction does to the rest of the
database.

> **⬅️ This continues [Part 1](./01-transactions-and-acid-part-1.md).**

> **📌 In one line:** every cost of a transaction is a cost per *second it stays
> open*, so the whole craft is deciding what belongs inside the boundary and
> getting out of it as fast as possible.

## Table of Contents

1. [Savepoints and Partial Rollback](#savepoints-and-partial-rollback)
2. [Transaction Scope Is a Design Decision](#transaction-scope-is-a-design-decision)
3. [Never Put External Side Effects Inside a Transaction](#never-put-external-side-effects-inside-a-transaction)
4. [Idle in Transaction: A Production Problem](#idle-in-transaction-a-production-problem)
5. [DDL Inside a Transaction](#ddl-inside-a-transaction)
6. [Advanced: Two-Phase Commit and Distributed Transactions](#advanced-two-phase-commit-and-distributed-transactions)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)
9. [Related](#related)

---

## Savepoints and Partial Rollback

A savepoint is a named marker inside a transaction. You can roll back to it
without abandoning everything before it.

The practical case: importing a batch where one bad row should not kill the
whole import, but the import as a whole must still be atomic.

```sql
BEGIN;

INSERT INTO projects (company_id, name, status)
VALUES (1, 'Q3 Migration', 'active');

SAVEPOINT before_tasks;

INSERT INTO tasks (project_id, title, status)
VALUES (currval('projects_id_seq'), 'Audit schema', 'todo');
-- ERROR: some constraint fails

ROLLBACK TO SAVEPOINT before_tasks;   -- transaction is usable again

INSERT INTO tasks (project_id, title, status)
VALUES (currval('projects_id_seq'), 'Audit schema (retry)', 'todo');

RELEASE SAVEPOINT before_tasks;       -- optional: forget the marker

COMMIT;                                -- project + the retried task both saved
```

`ROLLBACK TO SAVEPOINT` is also the escape hatch from the aborted-transaction
state you saw earlier — it is how ORMs implement "nested transactions", since
PostgreSQL has no real nesting.

> **⚠️ Savepoints are not free.** Each one starts a subtransaction with its own
> transaction id. A loop creating tens of thousands of savepoints in one
> transaction can overflow the per-transaction cache of subtransaction ids and
> degrade visibility checks across the whole server. Use savepoints for a
> handful of recovery points, not once per row in a large loop.

---

## Transaction Scope Is a Design Decision

The single most useful rule in this folder:

> **📌 Keep transactions short. Never do slow work inside one.**

"Short" means: open it as late as possible, do only database work, commit as
soon as the writes are done. Here is exactly what a long transaction costs you,
with three separate mechanisms — knowing all three is what makes the rule stick.

**1. Locks are held for the whole transaction.** PostgreSQL releases row and
table locks at `COMMIT` or `ROLLBACK`, never earlier. A transaction that
updates invoice 4021 and then spends 8 seconds doing something else blocks
every other writer of that row for 8 seconds. See [04-locks-part-1.md](04-locks-part-1.md).

**2. The connection is held for the whole transaction.** A connection inside a
transaction cannot be returned to the pool. If you have a pool of 20 and 20
requests each hold a transaction open across a slow call, request 21 waits for
a connection — and the whole service appears down even though the database is
idle. See [../operations/01-connection-pooling-part-1.md](../operations/01-connection-pooling-part-1.md).

**3. Old row versions cannot be cleaned up.** Under MVCC, an old version of a
row can only be removed once no running transaction could still need to see it.
One long transaction pins the cleanup horizon for the **entire database**, not
just for the tables it touched. Tables bloat, scans get slower, and autovacuum
runs and reclaims nothing. See [03-mvcc-part-2.md](03-mvcc-part-2.md) and
[../operations/02-vacuum-and-autovacuum-part-2.md](../operations/02-vacuum-and-autovacuum-part-2.md).

| Work inside a transaction | Verdict |
|---|---|
| `UPDATE` / `INSERT` / `SELECT` on your own database | Yes — this is what it is for |
| Reading a file, doing arithmetic in memory | Do it before `BEGIN` |
| Calling a payment provider or any HTTP API | Never (next section) |
| Sending an email, publishing to a queue | Never (next section) |
| Waiting for a user to click something | Absolutely never |
| A 30-second analytical report query | Not in the same transaction as writes |

---

## Never Put External Side Effects Inside a Transaction

A transaction can roll back a database change. It cannot un-send an email,
un-charge a card, or un-publish a message to Kafka.

**❌ BROKEN — the email is sent even when the transaction fails:**

```ts
await db.transaction(async (tx) => {
  await tx.update(invoices).set({ status: 'paid' }).where(eq(invoices.id, 4021))
  await sendReceiptEmail(customerEmail)          // ← external, cannot roll back
  await tx.insert(payments).values({ invoiceId: 4021, amountCents: 25000 })
  // if this INSERT violates a constraint, the invoice update rolls back
  // — but the customer already has a receipt for a payment we did not record
})
```

There is a second, quieter bug here: `sendReceiptEmail` might take 2 seconds.
For those 2 seconds the invoice row is locked and a pooled connection is held.

**✅ FIXED — commit first, then do the external work:**

```ts
await db.transaction(async (tx) => {
  await tx.update(invoices).set({ status: 'paid' }).where(eq(invoices.id, 4021))
  await tx.insert(payments).values({ invoiceId: 4021, amountCents: 25000 })
})                                                // committed and durable here

await sendReceiptEmail(customerEmail)             // outside; safe to retry
```

The ordering rule in one line: **database state first, outside world second.**

That still leaves a gap — the process can die after the commit and before the
email. The real answer is the *transactional outbox*: inside the transaction,
insert a row into an `outbox` table describing the email; a separate worker
reads the outbox and sends. Now the intent to send is atomic with the data, and
the send itself is retryable. That pattern belongs to
[event-driven-architecture](../../system-design/scale-patterns/event-driven-architecture.md),
and the application-code shape of all of this is in
[orm-vs-query-builder](../../backend-fundamentals/10-database-integration/01-orm-vs-query-builder.md).

---

## Idle in Transaction: A Production Problem

`idle in transaction` means a session ran `BEGIN`, ran some statements, and is
now sitting there doing nothing — not running a query, not committing. The
database is waiting for a client that has wandered off.

```sql
SELECT pid,
       state,
       now() - xact_start        AS txn_age,
       now() - state_change      AS idle_for,
       left(query, 60)           AS last_query
FROM   pg_stat_activity
WHERE  state = 'idle in transaction'
ORDER  BY xact_start;
```

```text
  pid  |        state        |    txn_age     |    idle_for    |          last_query
-------+---------------------+----------------+----------------+-------------------------------
 28841 | idle in transaction | 00:41:07.22    | 00:41:02.88    | SELECT * FROM invoices WHERE
 29103 | idle in transaction | 00:03:11.90    | 00:03:09.44    | UPDATE projects SET status =
```

That first row is 41 minutes of damage: locks held, a pooled connection held,
and — worst — the vacuum horizon pinned for 41 minutes across the whole
database.

Where it comes from, in practice:

- An exception thrown between `BEGIN` and `COMMIT` with no `finally` that rolls
  back.
- A driver in non-autocommit mode where someone ran a `SELECT` and never
  committed, so a "read-only" call pinned a transaction.
- A developer who typed `BEGIN;` in `psql`, got distracted, and went to lunch.
- An application waiting on a slow external call inside the transaction — the
  previous section's bug, seen from the database side.

The safety net is a server setting, and you should have it on:

```sql
-- kill any session idle inside a transaction for more than 60 seconds
ALTER SYSTEM SET idle_in_transaction_session_timeout = '60s';
SELECT pg_reload_conf();
```

The session gets `FATAL: terminating connection due to idle-in-transaction
timeout` and its transaction is rolled back. That is a loud, findable failure
instead of a slow, invisible one.

> **📌 Do not confuse the two states.** `idle` means the client holds a
> connection but no transaction — harmless, that is just a pooled connection.
> `idle in transaction` is the one that hurts.

Two related guards: `statement_timeout` caps how long one statement may run,
and `lock_timeout` caps how long a statement will wait for a lock. Both appear
again in [04-locks-part-1.md](04-locks-part-1.md).

---

## DDL Inside a Transaction

PostgreSQL supports **transactional DDL**, which is unusual and genuinely
useful. `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, `CREATE INDEX` — almost
all of it can be rolled back.

```sql
BEGIN;
ALTER TABLE invoices ADD COLUMN currency text NOT NULL DEFAULT 'USD';
ALTER TABLE invoices ADD CONSTRAINT invoices_currency_check
  CHECK (currency IN ('USD', 'EUR', 'GBP'));
UPDATE invoices SET currency = 'EUR' WHERE company_id IN (SELECT id FROM companies WHERE plan = 'eu');
-- something looks wrong
ROLLBACK;           -- schema is exactly as it was
```

This is why PostgreSQL migration tools can wrap each migration in a
transaction: a migration that fails halfway leaves the schema untouched, rather
than in a half-migrated state you have to repair by hand at 3 a.m.

**MySQL behaves differently:** most DDL there causes an implicit commit, so a
failed multi-statement migration leaves partial schema changes behind. If you
have only used MySQL, this is a real difference worth knowing.

Two PostgreSQL exceptions to remember:

- `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY` **cannot** run
  inside a transaction block — which is exactly the statement you want for a
  large table, so migration tools need a way to opt out of the wrapper.
- `CREATE DATABASE`, `DROP DATABASE` and `VACUUM` cannot run in a transaction
  block either.

The migration-writing side of this — expand/contract, backfills, zero-downtime
column renames — belongs to
[backend-fundamentals/10-database-integration/](../../backend-fundamentals/10-database-integration/).

---

## Advanced: Two-Phase Commit and Distributed Transactions

What if a change must span two databases? SQL has an answer: **two-phase
commit (2PC)**. A coordinator asks every participant "can you commit?" (the
prepare phase); if all say yes, it tells them all to commit.

PostgreSQL implements it with `PREPARE TRANSACTION`:

```sql
BEGIN;
UPDATE invoices SET status = 'paid' WHERE id = 4021;
PREPARE TRANSACTION 'pay-4021';     -- durable, but not committed yet
-- ... coordinator checks the other participants ...
COMMIT PREPARED 'pay-4021';         -- or ROLLBACK PREPARED 'pay-4021';
```

Now the honest part:

> **⚠️ Distributed transactions across services do not really work.** 2PC has a
> blocking window: between `PREPARE` and `COMMIT PREPARED`, the participant
> holds its locks and *cannot decide on its own*. If the coordinator dies in
> that window, the prepared transaction sits there holding locks and pinning
> the vacuum horizon until a human resolves it. `max_prepared_transactions` is
> `0` by default in PostgreSQL for exactly this reason.

And 2PC does not help at all with the case you actually have: your service, a
payment provider, and an email provider. You cannot ask Stripe to prepare a
transaction and wait for your coordinator.

What real systems do instead:

| Approach | Idea |
|---|---|
| Keep it in one database | The best answer when you can. One transaction, no distribution |
| Transactional outbox | Write the intent atomically with the data; a worker delivers it |
| Saga | A sequence of local transactions, each with a compensating action |
| Idempotency keys | Make retries safe so "at least once" becomes "effectively once" |

Read [idempotency](../../system-design/reliability/idempotency.md) next for
that last row — it is the one you will use most — and
[event-driven-architecture](../../system-design/scale-patterns/event-driven-architecture.md)
for the outbox and saga patterns.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| An HTTP call inside a transaction | It cannot roll back, and it holds locks and a connection | Commit first, then call. Or use an outbox |
| `BEGIN` before gathering input | Locks held while you compute | Prepare everything, then `BEGIN` |
| No `finally { rollback }` in error paths | Leaves the session idle in transaction | Use the driver's transaction helper; set `idle_in_transaction_session_timeout` |
| Long-running reporting query in the same transaction as writes | Pins the vacuum horizon, holds a connection | Separate transaction, ideally a read replica |
| Creating a savepoint per row in a big loop | Subtransaction id overflow degrades the whole server | A few savepoints, or handle failures outside the transaction |

---

## Questions to Test Yourself

1. What does `ROLLBACK TO SAVEPOINT` undo, what does it keep, and why is one
   savepoint per row in a large loop a server-wide problem?
2. Name the three separate costs of holding a transaction open for 30 seconds.
3. Your teammate calls the payment API inside the transaction "so it rolls back
   if the database write fails". What do you tell them, and what do you suggest?
4. What does `idle in transaction` mean, what damage does it do, and which
   setting protects you?
5. Why can migration tools wrap a PostgreSQL migration in a transaction but
   not a MySQL one? Name two PostgreSQL statements that still cannot be
   wrapped.
6. Why is a distributed transaction across two services a bad idea, and what
   do you use instead?

---

## Related

- [Part 1](01-transactions-and-acid-part-1.md) — `BEGIN`, `COMMIT`,
  `ROLLBACK`, autocommit, the four ACID letters, and what happens during a
  commit.
- [Isolation Levels and Anomalies](02-isolation-levels-and-anomalies-part-1.md)
  — the next file: what "I" actually means, and the anomalies each level
  allows.
- [MVCC](03-mvcc-part-2.md) — why a long transaction bloats the whole database.
- [Locks](04-locks-part-1.md) — what a transaction holds until it commits.
- [../operations/01-connection-pooling-part-2.md](../operations/01-connection-pooling-part-2.md)
  — the resource a long transaction monopolises.
- [../operations/02-vacuum-and-autovacuum-part-2.md](../operations/02-vacuum-and-autovacuum-part-2.md)
  — the cleanup a long transaction blocks.
- [orm-vs-query-builder](../../backend-fundamentals/10-database-integration/01-orm-vs-query-builder.md)
  — the application side: wrapping a service method in a transaction.
- [idempotency](../../system-design/reliability/idempotency.md) — what you use
  instead of a distributed transaction.
- [event-driven-architecture](../../system-design/scale-patterns/event-driven-architecture.md)
  — the outbox pattern in full.
