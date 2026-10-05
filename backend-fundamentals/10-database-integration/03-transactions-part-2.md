# Transactions — Part 2: Under Pressure

Part 1's transaction was alone in the world. This part is what happens when it
is not: another request wants the same rows, the service you called also wants a
transaction, the pool is nearly empty, a test needs to undo everything, and
something outside the database needs to know the write happened.

> **⬅️ This continues [Part 1](03-transactions-part-1.md).**

> **📌 In one line:** a transaction can fail for reasons that are nobody's
> fault, so the whole thing must be safe to run again — and anything the outside
> world must learn about goes in the same transaction as a row, not in a network
> call.

> **🔍 Scope:** why serialization failures and deadlocks happen at all, and what
> each isolation level prevents, belong to
> [databases/transactions-and-concurrency/](../../databases/transactions-and-concurrency/).
> This file is about what your code does when one arrives.

## Table of Contents

1. [Nesting and Savepoints](#nesting-and-savepoints)
2. [Retrying Deadlocks and Serialization Failures](#retrying-deadlocks-and-serialization-failures)
3. [Making a Retry Safe: Idempotency](#making-a-retry-safe-idempotency)
4. [Choosing an Isolation Level from Code](#choosing-an-isolation-level-from-code)
5. [Transactions and the Connection Pool](#transactions-and-the-connection-pool)
6. [Testing Transactional Code](#testing-transactional-code)
7. [Advanced: The Outbox Pattern](#advanced-the-outbox-pattern)
8. [Advanced: Distributed Transactions Do Not Work](#advanced-distributed-transactions-do-not-work)
9. [Common Mistakes](#common-mistakes)
10. [Questions to Test Yourself](#questions-to-test-yourself)
11. [Related](#related)

---

## Nesting and Savepoints

`registerUser` opens a transaction and calls `createCompany`, which also opens
one. What does the database do?

**PostgreSQL has no nested transactions.** There is one transaction per
connection, full stop. What your ORM does instead is issue a **savepoint** — a
named marker you can roll back *to* without ending the outer transaction.

```text
  BEGIN                          ← the real transaction
    INSERT users ...
    SAVEPOINT trx_2              ← the "inner transaction"
      INSERT companies ...
    RELEASE SAVEPOINT trx_2      ← the inner "commit": marker discarded
    INSERT memberships ...
  COMMIT                         ← the only commit that ever happened
```

The consequence is the thing people get wrong: **the inner block "committing"
guarantees nothing.** If the outer transaction rolls back afterwards, the
company row disappears along with everything else. A savepoint can only undo a
*part* of the work; it can never make a part durable on its own.

```ts
// A savepoint is for recovering from an expected failure without losing the rest.
await db.transaction(async (trx) => {
  await trx.table('users').insert(user)

  try {
    // Nested call → SAVEPOINT. If it throws, only this part unwinds.
    await trx.transaction(async (sp) => {
      await sp.table('referral_credits').insert({ userId: user.id, cents: 500 })
    })
  } catch (error) {
    logger.warn({ error }, 'referral credit skipped')   // user still created
  }

  await trx.table('memberships').insert(membership)
})
```

> **⚠️ Warning:** check what your library does when a nested call receives no
> handle. Lucid and Knex create a savepoint when you nest on `trx`, but calling
> the *global* `db.transaction()` inside a block opens a **second, independent
> transaction on a second connection** — the escaped-query bug from Part 1, with
> the added risk of the two connections deadlocking against each other.

Practical rule: let the outermost caller own the transaction and pass the handle
down. Use a savepoint deliberately, for one optional step you expect might fail
— not as a way to "make a function transactional on its own".

---

## Retrying Deadlocks and Serialization Failures

Some transactions fail even though your code is correct. PostgreSQL aborts one
of two transactions caught in a deadlock (`40P01`), and under `REPEATABLE READ`
or `SERIALIZABLE` it aborts a transaction whose snapshot no longer holds
(`40001`). Both are the database saying *"try again"*, not *"you are wrong"*.

**The whole transaction must be retried from the start.** After the abort there
is nothing left — every statement in that transaction is gone, and the snapshot
it read from is invalid. Re-running the last statement on the dead transaction
does nothing but produce `current transaction is aborted`.

```ts
const RETRYABLE = new Set([
  '40001',   // serialization_failure
  '40P01',   // deadlock_detected
])

export async function withRetry<T>(
  work: () => Promise<T>,
  { attempts = 3, baseMs = 50 } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work()
    } catch (error: any) {
      const retryable = RETRYABLE.has(error?.code)
      if (!retryable || attempt >= attempts) throw error

      // Full jitter: without it, two conflicting transactions retry in step
      // and collide again at exactly the same moment, forever.
      const ceiling = baseMs * 2 ** (attempt - 1)
      const delay = Math.random() * ceiling
      logger.warn({ code: error.code, attempt, delay }, 'retrying transaction')
      await sleep(delay)
    }
  }
}

// The retry wraps the *whole* transaction, never a statement inside it.
await withRetry(() =>
  db.transaction(async (trx) => {
    const account = await trx.from('accounts').where('id', id).forUpdate().first()
    await trx.from('accounts').where('id', id).update({ cents: account.cents - amount })
    await trx.table('ledger').insert({ account_id: id, delta: -amount })
  }),
)
```

Four details decide whether this helps or hurts:

- **Bounded attempts.** Three is usually right. Unbounded retries turn a
  contention problem into a self-inflicted denial of service.
- **Jitter.** Exponential backoff alone keeps two colliding transactions
  synchronised; the random component is what breaks the tie.
- **Only retryable codes.** A unique-violation or a foreign-key error will fail
  identically every time. Retrying it wastes the pool and hides the bug.
- **Nothing outside the transaction inside the retry.** If an email send is in
  the retried block, three attempts means three emails.

The retry policy itself is the same machinery as elsewhere in the system — see
[circuit-breakers-and-retries.md](../../system-design/reliability/circuit-breakers-and-retries.md).
For *reducing* deadlocks rather than absorbing them (consistent lock ordering,
shorter transactions, smaller batches), read
[05-deadlocks-part-2.md](../../databases/transactions-and-concurrency/05-deadlocks-part-2.md).

---

## Making a Retry Safe: Idempotency

A retry re-runs work that may have partly happened. Inside one database
transaction that is fine — the abort erased it. The danger is everything else in
the same code path.

```ts
// ❌ BROKEN — attempt 2 charges the customer a second time.
await withRetry(async () => {
  const charge = await stripe.charges.create({ amount: 5000 })
  await db.transaction(async (trx) => {
    await trx.table('payments').insert({ provider_ref: charge.id })
  })
})
```

```ts
// ✅ FIXED — the external call is outside the retry, and carries its own key.
const charge = await stripe.charges.create(
  { amount: 5000 },
  { idempotencyKey: `invoice-${invoice.id}-attempt` },
)

await withRetry(() =>
  db.transaction(async (trx) => {
    await trx.table('payments').insert({ provider_ref: charge.id })
  }),
)
```

The general rule: an operation is safe to retry when running it twice leaves the
same state as running it once. Inside the database you get that from unique
constraints and `ON CONFLICT DO NOTHING`; outside it you get it from an
idempotency key the provider honours. The full treatment — key lifetime, storing
responses, replay semantics — is in
[idempotency.md](../../system-design/reliability/idempotency.md).

---

## Choosing an Isolation Level from Code

PostgreSQL's default is `READ COMMITTED`, and it is the right choice for the
large majority of endpoints. You raise it when a transaction makes a decision
from data it read and another transaction could invalidate that decision before
you commit — the classic case being a check-then-write on rows you did not lock.

```ts
// Repeatable reads across several statements, or a real serializability need.
await withRetry(() =>
  db.transaction(
    async (trx) => {
      const seats = await trx.from('subscriptions').where('id', subId).first()
      const used = await trx.from('memberships').where('company_id', companyId).count('*')
      if (used >= seats.limit) throw new ConflictError('Seat limit reached')

      await trx.table('memberships').insert({ company_id: companyId, user_id: userId })
    },
    { isolationLevel: 'serializable' },
  ),
)
```

Two things to notice. The isolation level is set **when the transaction opens**,
not partway through. And it is wrapped in `withRetry`, because raising the level
does not remove the conflict — it converts a silent wrong answer into a `40001`
error you must handle. *A serializable transaction without a retry loop is an
unfinished feature.*

| Situation | Reach for |
|---|---|
| Ordinary CRUD, one row at a time | `READ COMMITTED` (the default) |
| Read several tables that must agree with each other | `REPEATABLE READ` |
| Check a condition, then write based on it, without locking | `SERIALIZABLE` + retry |
| One known row, and you can lock it | `READ COMMITTED` + `SELECT ... FOR UPDATE` |

Locking the row explicitly is usually simpler and cheaper than raising the
isolation level, because the cost is paid only by writers of that row. Which
anomaly each level actually prevents — dirty read, non-repeatable read, phantom,
lost update, write skew — is in
[02-isolation-levels-and-anomalies-part-1.md](../../databases/transactions-and-concurrency/02-isolation-levels-and-anomalies-part-1.md),
and the locking alternative is in
[06-optimistic-vs-pessimistic-locking-part-1.md](../../databases/transactions-and-concurrency/06-optimistic-vs-pessimistic-locking-part-1.md).

---

## Transactions and the Connection Pool

A transaction lives on one connection for its entire life. It cannot move, and
the connection cannot serve anyone else until `COMMIT` or `ROLLBACK`. So **a
transaction's duration is a pool reservation**, and this is where "keep
transactions short" stops being style advice.

```text
  pool max = 10, average transaction = 20 ms   →  ~500 transactions/second
  pool max = 10, average transaction = 2 s     →  5 transactions/second
```

Nothing about the database got slower. The second line is an outage during a
traffic spike, produced entirely by transaction length.

Worse than a slow transaction is an abandoned one. A block that never commits —
the early-return bug from Part 1, or a process killed mid-transaction — leaves a
session `idle in transaction`. That session holds its locks and its snapshot,
which also blocks vacuum from cleaning up dead rows across the database.

```sql
-- The first query to run when the pool is empty but the database looks idle.
SELECT pid, state, now() - state_change AS duration, left(query, 60)
  FROM pg_stat_activity
 WHERE state = 'idle in transaction'
 ORDER BY duration DESC;
```

Two settings turn this from an outage into an error message:
`idle_in_transaction_session_timeout` kills abandoned sessions, and
`statement_timeout` kills a single runaway statement. Set both on the
application's database role. Pool sizing, the multiplication trap and PgBouncer's
transaction mode are covered in
[01-connection-pooling-part-1.md](../../databases/operations/01-connection-pooling-part-1.md)
and [-part-2](../../databases/operations/01-connection-pooling-part-2.md); the
application side is [04-connection-pooling.md](04-connection-pooling.md).

---

## Testing Transactional Code

Tests need a database in a known state, and the cheapest way to get one is to
let the database undo the test for you.

```ts
// Each test runs inside a transaction that is never committed.
beforeEach(async () => {
  trx = await db.transaction()
  app.container.swap(Database, trx)   // every query in this test uses trx
})

afterEach(async () => {
  await trx.rollback()                // instant, complete cleanup
})
```

Compared with truncating tables or re-running migrations between tests, this is
an order of magnitude faster and it cannot leave residue behind. The seeding and
isolation trade-offs in full are in
[05-seeding-and-test-data-part-2.md](05-seeding-and-test-data-part-2.md).

**The one limitation is code that manages its own transactions** — which is
exactly the code in this file. When the service under test calls
`db.transaction()`, one of two things happens: it opens a second, independent
transaction that your rollback cannot reach, or, if you injected the handle
properly, it becomes a savepoint. Savepoint nesting is usually fine, but be
clear about what it no longer proves:

| What you still test | What the rollback technique hides |
|---|---|
| Statements, constraints, triggers on write | Anything that happens at real `COMMIT` time |
| Business logic end to end | Deferred constraints, which fire on commit |
| That rows are written as expected | Whether the service actually committed at all |
| Rollback on a thrown error | True concurrency between two connections |

So keep a small number of tests that commit for real and clean up by truncation:
the checkout flow, the retry path, anything with a deferred constraint. Testing
a deadlock retry needs two real connections and cannot use this technique at
all. See
[03-integration-and-api-testing-part-1.md](../13-testing-and-quality/03-integration-and-api-testing-part-1.md).

---

## Advanced: The Outbox Pattern

Part 1 said: publish to the queue after the commit. That leaves a real gap —
the process can die between `COMMIT` and `publish`, and the message is lost
forever with no trace.

You cannot fix this by publishing *inside* the transaction either, because then
a consumer may act on data that rolls back. Two systems, no shared transaction.

The outbox turns the message into a row, so one transaction covers both.

```mermaid
flowchart LR
    A["Service"] -->|"one transaction"| B[("invoices<br/>+ outbox row")]
    B --> C["Relay<br/>polls unpublished rows"]
    C --> D["Message broker"]
    C -->|"mark published"| B
```

```ts
await db.transaction(async (trx) => {
  await trx.from('invoices').where('id', id).update({ status: 'paid' })

  // Same transaction: if the update rolls back, so does the event.
  await trx.table('outbox').insert({
    id: randomUUID(),                       // becomes the broker's dedup key
    topic: 'invoice.paid',
    payload: JSON.stringify({ invoiceId: id }),
    created_at: new Date(),
  })
})
```

A separate relay process reads unpublished rows in order, publishes them, and
marks them done. The guarantee it buys is **at-least-once**: the relay can crash
after publishing and before marking, so the same message goes out twice. That is
why the row carries a stable id — consumers must deduplicate. You have traded a
message that can be *lost* for one that can be *duplicated*, which is the better
trade, because duplicates are detectable and losses are not.

The consumer side, ordering guarantees and the broker semantics are in
[event-driven-architecture.md](../../system-design/scale-patterns/event-driven-architecture.md).

---

## Advanced: Distributed Transactions Do Not Work

Two services, two databases, one operation: "reserve the seat and charge the
card". The instinct is a transaction spanning both. The instinct is wrong, and
it is worth knowing why before you spend a sprint on it.

The classic mechanism is **two-phase commit**. A coordinator asks every
participant "can you commit?", collects the yeses, then tells everyone to
commit. It is correct on paper and unusable in practice:

- **It blocks.** Between "yes" and "commit", every participant holds its locks.
  If the coordinator dies in that window, those locks are held until a human
  intervenes.
- **Availability multiplies downward.** The operation needs *every* participant
  up at the same instant. Four services at 99.9% give you 99.6%.
- **Most things you call do not support it.** Stripe, SendGrid, S3 and every
  HTTP API have no `PREPARE TRANSACTION` phase. There is nothing to enlist.

The working alternative is a **saga**: a sequence of local transactions, each
committed on its own, each with a compensating action if a later step fails.
"Charge the card" is compensated by "refund the card" — not undone, *reversed*,
which leaves both events in the history. The application becomes responsible for
the consistency the database used to provide, which is the real cost of
splitting one database into several.

> **📌 Remember:** if two writes must be atomic, the strongest argument in this
> entire part is to keep them in one database. Reach for sagas when a service
> boundary already exists for an independent reason — not to justify one.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Expecting a nested block to commit on its own | It is a savepoint; the outer rollback erases it | Let the outermost caller own the transaction |
| `db.transaction()` inside a transaction block | A second independent transaction on a second connection | Nest on `trx`, or pass the handle |
| Retrying one statement after a `40001` | The whole transaction is already dead | Retry the entire transaction from the start |
| Retrying on any error code | Unique violations fail identically forever | Retry only `40001` and `40P01` |
| Exponential backoff with no jitter | Colliding transactions stay synchronised | Add full jitter |
| An email or HTTP call inside the retried block | Three attempts, three emails | Keep side effects outside the retry |
| `SERIALIZABLE` with no retry loop | The first conflict becomes a 500 | Always pair the level with retries |
| Long transaction on a small pool | Pool reservations, not query time, cap throughput | Short transactions; set the timeouts |
| No `idle_in_transaction_session_timeout` | One abandoned session blocks vacuum and holds locks | Set it on the application role |
| Every test using transaction rollback | Nothing is proven about real commits | Keep a few committing tests |
| Publishing to a queue after `COMMIT` and hoping | The message is lost if the process dies | Outbox row in the same transaction |
| Two-phase commit across services | Blocking locks, multiplied downtime, no support | One database, or a saga |

---

## Questions to Test Yourself

1. Your ORM lets you nest `transaction()` calls. What SQL does it actually
   issue, and what does the inner "commit" guarantee?
2. A nested call uses the global `db` instead of `trx`. Name both problems.
3. Why must a `40001` be retried at the transaction level rather than the
   statement level?
4. What exactly goes wrong with exponential backoff and no jitter?
5. Name two error codes that must never be retried, and say what retrying them
   costs.
6. Why is `SERIALIZABLE` without a retry loop worse than leaving the default?
7. Pool of 10, transactions averaging 2 seconds. What is the throughput ceiling,
   and what has to change to raise it?
8. Explain `idle in transaction` and give two consequences beyond the lost
   connection.
9. Transaction-per-test rollback is fast and clean. Name three things it cannot
   prove.
10. The outbox trades one failure mode for another. Name both, and say why the
    trade is worth making.
11. Give three reasons two-phase commit fails between services, and say what a
    saga does instead.

---

## Related

- [Part 1](03-transactions-part-1.md) — the callback style, the three mistakes,
  and passing the handle through your layers.
- [05-deadlocks-part-2.md](../../databases/transactions-and-concurrency/05-deadlocks-part-2.md)
  — retrying correctly, and reducing deadlock frequency at the source.
- [02-isolation-levels-and-anomalies-part-1.md](../../databases/transactions-and-concurrency/02-isolation-levels-and-anomalies-part-1.md)
  — the anomalies each level prevents.
- [06-optimistic-vs-pessimistic-locking-part-1.md](../../databases/transactions-and-concurrency/06-optimistic-vs-pessimistic-locking-part-1.md)
  — locking a row instead of raising the isolation level.
- [01-connection-pooling-part-1.md](../../databases/operations/01-connection-pooling-part-1.md)
  — pool sizing, and diagnosing `idle in transaction`.
- [circuit-breakers-and-retries.md](../../system-design/reliability/circuit-breakers-and-retries.md)
  — backoff, jitter and attempt budgets as a general pattern.
- [idempotency.md](../../system-design/reliability/idempotency.md) — making an
  operation safe to run twice.
- [event-driven-architecture.md](../../system-design/scale-patterns/event-driven-architecture.md)
  — the outbox relay, at-least-once delivery, and consumer deduplication.
- [03-integration-and-api-testing-part-1.md](../13-testing-and-quality/03-integration-and-api-testing-part-1.md)
  — the test suite these techniques belong to.
- [04-connection-pooling.md](04-connection-pooling.md) — the application side of
  the resource every transaction consumes.
