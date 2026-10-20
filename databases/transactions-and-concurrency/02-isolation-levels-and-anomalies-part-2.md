# Isolation Levels and Anomalies — Part 2

Part 1 catalogued the five anomalies and the four levels the SQL standard
defines against them. The standard, however, describes a minimum — and
PostgreSQL differs from it in three places that matter every day. This part is
the practical half: what each PostgreSQL level really guarantees, how to set
it, why Serializable aborts instead of blocking, and how to choose.

> **⬅️ This continues [Part 1](./02-isolation-levels-and-anomalies-part-1.md).**

> **📌 In one line:** PostgreSQL gives you three usable levels, defaults to the
> weakest, and the strong one protects your invariants by aborting your
> transaction — so choosing a level is really choosing whether you write a
> retry loop.

## Table of Contents

1. [What PostgreSQL Actually Does](#what-postgresql-actually-does)
2. [Read Committed in Practice: Two Queries Can Disagree](#read-committed-in-practice-two-queries-can-disagree)
3. [Setting the Isolation Level](#setting-the-isolation-level)
4. [Serializable in Practice: It Aborts, It Does Not Block](#serializable-in-practice-it-aborts-it-does-not-block)
5. [Which Level for Which Situation](#which-level-for-which-situation)
6. [Advanced: Cost, Vacuum, and Replicas](#advanced-cost-vacuum-and-replicas)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)
9. [Related](#related)

---

## What PostgreSQL Actually Does

This is the section to remember, because PostgreSQL differs from the standard
in three places, and every one of them matters in practice.

| Requested level | What PostgreSQL gives you |
|---|---|
| `READ UNCOMMITTED` | **Treated as Read Committed.** Dirty reads are impossible in PostgreSQL — MVCC has no way to show you an uncommitted row version |
| `READ COMMITTED` | **The default.** Each *statement* sees a fresh snapshot of committed data |
| `REPEATABLE READ` | **Snapshot isolation.** One snapshot for the whole transaction, taken at the first statement. Also prevents phantoms — stronger than the standard requires |
| `SERIALIZABLE` | Snapshot isolation **plus predicate locking (SSI)**, which detects read/write dependency cycles and prevents write skew |

So the honest PostgreSQL matrix is:

| PostgreSQL level | Dirty read | Non-repeatable | Phantom | Lost update | Write skew |
|---|---|---|---|---|---|
| Read Committed | never | possible | possible | possible | possible |
| Repeatable Read | never | never | **never** | aborts with an error | possible |
| Serializable | never | never | never | aborts with an error | **never** |

Two details behind that table:

**Repeatable Read does not silently lose updates.** If your transaction tries
to update a row that another transaction modified and committed since your
snapshot, PostgreSQL does not overwrite — it raises:

```text
ERROR:  could not serialize access due to concurrent update
```

That is a *good* outcome: the lost update became a loud error. But it is still
an error you must catch and retry.

**Serializable is implemented as SSI (Serializable Snapshot Isolation).** It
does not take extra blocking locks. It tracks which predicates each transaction
read, watches for a dangerous pattern of read/write dependencies, and aborts
one of the participants. That design is why the next-but-one section exists.

**MySQL/InnoDB differs:** its default is Repeatable Read, not Read Committed,
and it prevents phantoms using next-key locks that genuinely block other
writers. Same level name, very different behaviour. Do not carry MySQL
intuition into PostgreSQL.

---

## Read Committed in Practice: Two Queries Can Disagree

Under Read Committed, the snapshot is taken **per statement**, not per
transaction. That one sentence explains most surprises at the default level.

| Time | Session A (invoice email job) | Session B |
|---|---|---|
| T1 | `BEGIN;` *(Read Committed)* | |
| T2 | `SELECT count(*) FROM invoices WHERE company_id=1 AND status='open';` → `12` | |
| T3 | | `UPDATE invoices SET status='paid' WHERE id=4021;` `COMMIT;` |
| T4 | `SELECT id FROM invoices WHERE company_id=1 AND status='open';` → **11 rows** | |
| T5 | `COMMIT;` | |

Session A is inside one transaction and its two queries disagree. The email it
sends says "you have 12 open invoices" and lists 11.

There is a second, sharper surprise. Under Read Committed, when an `UPDATE`
blocks on a row another transaction is changing, it does **not** simply fail
after that transaction commits — it re-reads the new version of the row and
re-evaluates the `WHERE` clause against it:

| Time | Session A | Session B |
|---|---|---|
| T1 | `BEGIN;` | `BEGIN;` |
| T2 | `UPDATE invoices SET status='void' WHERE id=4021 AND status='open';` | |
| T3 | | `UPDATE invoices SET amount_cents=30000 WHERE id=4021 AND status='open';` ⏸ blocked |
| T4 | `COMMIT;` | |
| T5 | | unblocks, re-checks `status='open'` against the **new** version → now `'void'` → `UPDATE 0` |

Session B reports `UPDATE 0` — zero rows. If your code does not check the
affected row count, it thinks it succeeded. This is the same lesson as
optimistic locking in [06](06-optimistic-vs-pessimistic-locking-part-1.md): **always
check how many rows you actually changed.**

> **📌 The fix for both surprises is the same:** if a transaction needs one
> stable view of the world, ask for Repeatable Read. Read Committed is a great
> default precisely because it does not promise that.

---

## Setting the Isolation Level

```sql
-- Per transaction, the usual way:
BEGIN ISOLATION LEVEL REPEATABLE READ;
  SELECT ...;
COMMIT;

-- Equivalent, set after BEGIN but before any query:
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

-- For this session's future transactions:
SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL REPEATABLE READ;

-- Check what you are running at:
SHOW transaction_isolation;
```

The level must be set **before the first query** of the transaction. After that
the snapshot exists and it is too late.

In application code, put it on the transaction boundary — the same place you
call `BEGIN` — not scattered through repository methods:

```ts
await db.transaction(
  async (tx) => { /* ... */ },
  { isolationLevel: 'serializable' }
)
```

Most ORMs expose exactly this option. Where that boundary should live in your
architecture is
[orm-vs-query-builder](../../backend-fundamentals/10-database-integration/01-orm-vs-query-builder.md).

---

## Serializable in Practice: It Aborts, It Does Not Block

This is the part people get wrong, and it is why you occasionally hear
"Serializable broke production".

> **📌 PostgreSQL's Serializable does not make the second transaction wait. It
> lets both run and **kills one** when it detects a cycle. Any code using
> Serializable must be prepared to retry.**

The error you will see:

```text
ERROR:  could not serialize access due to read/write dependencies among transactions
DETAIL:  Reason code: Canceled on identification as a pivot, during commit attempt.
HINT:  The transaction might succeed if retried.
SQLSTATE: 40001
```

`40001` is the SQLSTATE to catch. (`40P01` is a deadlock — different cause,
same response: retry.) Note the hint: PostgreSQL is telling you plainly that
retrying is the intended handling.

```ts
async function withSerializableRetry<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const MAX_ATTEMPTS = 5
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await db.transaction(fn, { isolationLevel: 'serializable' })
    } catch (err: any) {
      const retryable = err.code === '40001' || err.code === '40P01'
      if (!retryable || attempt === MAX_ATTEMPTS) throw err
      // exponential backoff with jitter, so retries do not collide again
      const delay = Math.random() * 20 * 2 ** attempt
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw new Error('unreachable')
}
```

Three rules that make this work:

1. **Retry the whole transaction from the start**, not the failing statement.
   The transaction is dead; there is nothing to resume.
2. **The work must be re-runnable.** If the transaction body also sent an
   email, retrying sends a second one — which is the previous file's rule about
   side effects, now with teeth. See
   [idempotency](../../system-design/reliability/idempotency.md).
3. **Bound the attempts and add jitter.** Without jitter, the retries collide
   again on the same schedule. See
   [circuit-breakers-and-retries](../../system-design/reliability/circuit-breakers-and-retries.md).

**❌ BROKEN — Serializable with no retry:**

```ts
await db.transaction(async (tx) => {
  const { count } = await tx.one('SELECT count(*) FROM users WHERE company_id=$1 AND role=$2', [1, 'admin'])
  if (count > 1) await tx.none('UPDATE users SET role=$1 WHERE id=$2', ['member', userId])
}, { isolationLevel: 'serializable' })
// Under load this throws 40001 and the user sees a 500. The team concludes
// "Serializable is unusable" and reverts to Read Committed — and the write
// skew comes back, silently.
```

**✅ FIXED:**

```ts
await withSerializableRetry(async (tx) => {
  const { count } = await tx.one('SELECT count(*) FROM users WHERE company_id=$1 AND role=$2', [1, 'admin'])
  if (count > 1) await tx.none('UPDATE users SET role=$1 WHERE id=$2', ['member', userId])
})
```

A serialization failure is **not a bug**. It is the database reporting that it
protected an invariant for you. The bug is not having a retry.

---

## Which Level for Which Situation

| Situation | Level | Why |
|---|---|---|
| Normal CRUD — read a row, write a row | Read Committed | The default. Cheapest, and enough |
| Read-modify-write on one row | Read Committed + `FOR UPDATE`, or an atomic `SET x = x + n` | Cheaper and simpler than raising the level |
| "This must not exist twice" | Read Committed + a `UNIQUE` constraint | The database enforces it with no cooperation from callers |
| A report that must be internally consistent | Repeatable Read | One snapshot for every query in it |
| Exporting a consistent multi-table dump | Repeatable Read | Same reason, across tables |
| A multi-row invariant (at least one admin, room not double-booked) | Serializable + retry | The only thing that catches write skew |
| Financial ledger with complex invariants | Serializable + retry | Correctness is worth the retries |
| Bulk import of independent rows | Read Committed | No invariants across rows; keep it cheap |

> **📌 The honest default:** Read Committed plus explicit locking or a unique
> constraint solves the large majority of real cases. Reach for Serializable
> when the invariant spans **multiple rows that no single lock covers** — that
> is the case nothing else handles.

---

## Advanced: Cost, Vacuum, and Replicas

**Relative cost.** Repeatable Read is not inherently slower per statement — it
takes one snapshot instead of many, which is marginally *less* work. Its cost
is elsewhere: a long-lived snapshot, and serialization errors on write
conflicts. Serializable adds real bookkeeping: SSI tracks predicate locks in
memory (`max_pred_locks_per_transaction`), and when that memory fills, locks
are *promoted* to coarser granularity — page or relation level — which causes
more false-positive aborts. High-contention workloads under Serializable can
spend real throughput on retried transactions.

**Long Repeatable Read transactions hold back vacuum.** A snapshot taken at
`BEGIN` must stay valid for the whole transaction, so no row version newer than
it can be removed anywhere in the database. A Repeatable Read transaction open
for an hour blocks an hour of cleanup — the mechanism is in
[03-mvcc-part-2.md](03-mvcc-part-2.md), the cleanup in
[../operations/02-vacuum-and-autovacuum-part-2.md](../operations/02-vacuum-and-autovacuum-part-2.md).

**Isolation stops at the edge of one server.** Isolation levels say nothing
about reading from a replica. A read replica applies WAL with some lag, so:

- A read on a replica may not see a transaction that already committed on the
  primary. Write-then-immediately-read across the two shows the user their own
  change missing — read-your-writes broken.
- No isolation level fixes this, because the replica is genuinely behind. You
  route the read to the primary, wait for LSN catch-up, or accept staleness.
- A long query on a hot-standby replica can conflict with WAL replay; the
  replica either delays applying WAL or cancels the query
  (`ERROR: canceling statement due to conflict with recovery`), depending on
  `hot_standby_feedback` and `max_standby_streaming_delay`.

See [database-replication](../../system-design/foundational/database-replication.md)
and
[cap-theorem-and-consistency-models](../../system-design/foundational/cap-theorem-and-consistency-models.md).
Isolation is about *concurrency on one node*; consistency models are about
*multiple nodes*. Different problems, frequently confused.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Using the SQL standard's table to reason about PostgreSQL | PostgreSQL's Repeatable Read prevents phantoms; the standard says it need not | Use the PostgreSQL matrix above |
| Raising to Serializable and shipping | It aborts instead of blocking; you get 500s under load | Add a bounded, jittered retry first |
| Ignoring the affected row count | Under Read Committed an `UPDATE` can match 0 rows after a concurrent change | Always check `rowCount` |
| Treating a `40001` error as a bug to be logged and swallowed | It is the database protecting an invariant | Retry the whole transaction |
| A Repeatable Read transaction left open for a report | Pins the vacuum horizon database-wide | Keep it short, or run it on a replica |

---

## Questions to Test Yourself

1. Name the three ways PostgreSQL differs from the SQL standard's isolation
   table.
2. Under Read Committed, how can two `SELECT`s in one transaction disagree?
3. A concurrent `UPDATE` under Read Committed reports `UPDATE 0`. Explain why,
   and what your code must do about it.
4. What does PostgreSQL do when Serializable detects a conflict — block or
   abort? What does that mean for your code?
5. Which SQLSTATE codes should a retry loop catch, and why must the *whole*
   transaction be retried?
6. Give one situation where Serializable is the right answer and one where
   Read Committed plus a unique constraint is better.
7. Why does a long Repeatable Read transaction hurt a database it is not even
   writing to?

---

## Related

- [Part 1](02-isolation-levels-and-anomalies-part-1.md) — the five anomalies as
  timelines, and the four levels the standard defines against them.
- [Transactions and ACID](01-transactions-and-acid-part-1.md) — what the "I"
  belongs to.
- [MVCC](03-mvcc-part-1.md) — the mechanism that makes snapshots possible.
- [Locks](04-locks-part-1.md) — `SELECT ... FOR UPDATE`, the Read Committed fix
  for lost update.
- [Deadlocks](05-deadlocks-part-2.md) — the other error your retry loop must
  catch.
- [Optimistic vs Pessimistic Locking](06-optimistic-vs-pessimistic-locking-part-1.md)
  — the application-level answer to lost update.
- [../operations/02-vacuum-and-autovacuum-part-2.md](../operations/02-vacuum-and-autovacuum-part-2.md)
  — what a long snapshot blocks.
- [circuit-breakers-and-retries](../../system-design/reliability/circuit-breakers-and-retries.md)
  — how to retry without making things worse.
- [idempotency](../../system-design/reliability/idempotency.md) — what makes a
  retry safe.
- [database-replication](../../system-design/foundational/database-replication.md)
  and
  [cap-theorem-and-consistency-models](../../system-design/foundational/cap-theorem-and-consistency-models.md)
  — isolation versus consistency across nodes.
