# Deadlocks — Part 2

Part 1 showed how a deadlock forms and the five ordinary coding patterns that
produce one. You cannot eliminate them entirely, so this part is about making
them cheap: a correct retry loop, the conditions that make a retry safe, the
changes that make deadlocks rarer, and how to investigate one after the alert
has already fired.

> **⬅️ This continues [Part 1](./05-deadlocks-part-1.md).**

> **📌 In one line:** a deadlock is an expected outcome of concurrency, not a
> bug report — the code that handles it correctly restarts the *whole*
> transaction, a bounded number of times, with jitter.

## Table of Contents

1. [Retrying Correctly](#retrying-correctly)
2. [Making the Retry Safe](#making-the-retry-safe)
3. [Reducing Deadlock Frequency](#reducing-deadlock-frequency)
4. [Diagnosing After the Fact: A Runbook](#diagnosing-after-the-fact-a-runbook)
5. [Advanced: Deadlock vs Livelock vs a Plain Lock Wait](#advanced-deadlock-vs-livelock-vs-a-plain-lock-wait)
6. [Common Mistakes](#common-mistakes)
7. [Questions to Test Yourself](#questions-to-test-yourself)
8. [Related](#related)

---

## Retrying Correctly

You cannot eliminate deadlocks. You can make them cheap.

Some deadlocks are genuinely unavoidable — a batch job and a user request
touching an overlapping set of rows with no natural common order, or a third-
party trigger you cannot change. And a rare deadlock is a much better outcome
than the serialisation you would need to guarantee none.

So: **application code must retry.**

```ts
const RETRYABLE = new Set([
  '40P01',  // deadlock_detected
  '40001',  // serialization_failure (see file 02)
])

async function withRetry<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const MAX_ATTEMPTS = 5
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // The WHOLE transaction is restarted, from BEGIN.
      return await db.transaction(work)
    } catch (err: any) {
      if (!RETRYABLE.has(err.code) || attempt === MAX_ATTEMPTS) throw err
      lastError = err

      // Exponential backoff with full jitter: 0-40ms, 0-80ms, 0-160ms, ...
      const backoffMs = Math.random() * 20 * 2 ** attempt
      metrics.increment('db.deadlock_retry', { attempt })
      await sleep(backoffMs)
    }
  }
  throw lastError
}
```

Four details that are easy to get wrong:

**1. Retry the whole transaction, not the failing statement.** This is the one
people get wrong most often. After `40P01` the transaction is aborted — every
statement in it has been rolled back, and the session refuses further commands
until you end the block. Re-running just the `UPDATE` is meaningless; the reads
it depended on are gone too.

**❌ BROKEN:**

```ts
await db.transaction(async (tx) => {
  const invoice = await tx.one('SELECT * FROM invoices WHERE id = $1', [id])
  for (let i = 0; i < 3; i++) {
    try {
      await tx.query('UPDATE invoices SET amount_cents = $1 WHERE id = $2', [n, id])
      break
    } catch (e) { /* retry just this statement */ }
  }
})
// After a deadlock, every statement on tx fails with
// "current transaction is aborted, commands ignored until end of transaction block"
```

**2. Bound the attempts.** Unbounded retries turn a contention problem into an
outage. Five is plenty; if five fail, the ordering is wrong and needs fixing.

**3. Add jitter.** Two transactions that deadlocked are, by definition, running
at the same time. Retrying both after exactly 50 ms recreates the collision.
Random backoff breaks the synchrony. See
[circuit-breakers-and-retries](../../system-design/reliability/circuit-breakers-and-retries.md).

**4. Count them.** A metric on retries turns an invisible problem into a
dashboard. A slow rise in deadlock retries is usually the first sign that a new
code path introduced an ordering conflict.

---

## Making the Retry Safe

A retry re-runs your transaction body. If that body does anything the second run
would duplicate, the retry is worse than the failure.

| Inside the transaction | Safe to retry? |
|---|---|
| `UPDATE invoices SET status = 'paid'` | ✅ Yes — same end state every time |
| `UPDATE companies SET seats = seats + 1` | ⚠️ Only because the first attempt rolled back. Fine — but be sure it *did* |
| `INSERT INTO payments ...` with a unique `provider_ref` | ✅ Yes — the constraint protects you |
| `INSERT INTO payments ...` with no unique key | ❌ No — a retry can double-insert if the failure was ambiguous |
| `await stripe.charges.create(...)` | ❌ **Never** — it should not be in the transaction at all |
| `await sendEmail(...)` | ❌ Never — same reason |

The last two are the rule from [01-transactions-and-acid-part-2.md](01-transactions-and-acid-part-2.md),
now with a sharper edge: even if you accept "the email might be sent for a
rolled-back transaction", a retry loop means it might be sent **five times**.

Two protections:

**Idempotency keys** make a repeated operation collapse into one:

```sql
-- The unique constraint is the whole mechanism.
CREATE UNIQUE INDEX payments_provider_ref_key ON payments (provider_ref);

INSERT INTO payments (invoice_id, amount_cents, provider_ref)
VALUES (4021, 25000, 'pi_3Nx...')
ON CONFLICT (provider_ref) DO NOTHING;
```

Read [idempotency](../../system-design/reliability/idempotency.md) for the full
treatment; it is the concept that makes every retry in this file safe.

**Pure transaction bodies.** The safest retryable transaction touches only the
database and computes only from what it reads inside itself. If your transaction
body captures a value computed *before* `BEGIN`, make sure that value is still
correct on attempt three.

---

## Reducing Deadlock Frequency

In rough order of impact:

| Technique | Why it works |
|---|---|
| **Shorter transactions** | The window in which a cycle can form shrinks proportionally. Move HTTP calls, file I/O and user waits out |
| **Consistent lock ordering** | Removes the possibility of a cycle entirely for those rows. Ascending primary key, everywhere |
| **Take locks up front** | Progressive acquisition creates cycles; acquiring everything at the start turns them into ordinary waits |
| **`SELECT ... FOR UPDATE` on the parent** | Serialises a whole workflow on one object — one queue instead of many possible cycles |
| **Touch fewer rows** | Fewer locks held, smaller chance of overlap. Prefer targeted updates over broad ones |
| **Avoid lock upgrades** | Never `FOR SHARE` then `UPDATE`. Ask for the strong mode immediately |
| **Sort every batch** | Makes multi-row statements deterministic |
| **Atomic single-statement updates** | `SET x = x + 1` takes and releases its lock inside one statement — nothing to interleave |
| **`lock_timeout`** | Does not prevent deadlocks, but bounds how long a *near*-deadlock hurts |

The "lock the parent" technique deserves a note, because it feels heavy-handed
and is often right:

```sql
BEGIN;
-- Everything that touches this company's billing serialises here.
SELECT id FROM companies WHERE id = 1 FOR UPDATE;

UPDATE invoices SET status = 'void' WHERE company_id = 1 AND id = 4021;
UPDATE invoices SET amount_cents = 0 WHERE company_id = 1 AND id = 4022;
INSERT INTO payments (invoice_id, amount_cents, provider_ref) VALUES (4022, 0, 'adj_991');

COMMIT;
```

You have deliberately reduced concurrency for one tenant to eliminate a class of
bug. If the transaction is short, that is an excellent trade. If it is long, you
have built the hot-row problem from [04-locks-part-2.md](04-locks-part-2.md) on purpose.

---

## Diagnosing After the Fact: A Runbook

**Step 1 — confirm it is really a deadlock.** Count them:

```sql
SELECT datname, deadlocks, stats_reset
FROM   pg_stat_database
WHERE  datname = current_database();
```

```text
 datname | deadlocks |          stats_reset
---------+-----------+-------------------------------
 saas    |       418 | 2026-09-01 00:00:00+00
```

418 in 17 days is a real problem. Zero means your "deadlock" is something else —
see the next section.

**Step 2 — get both statements from the server log.** Search for
`deadlock detected` and read the two `Process NNNNN:` lines. Those two
statements are the pair.

**Step 3 — find the code paths.** Map each statement to the function that issues
it. The bug is almost always visible the moment you see both call sites side by
side: they touch the same rows in different orders.

**Step 4 — determine the lock order each path uses.** Write it down literally:

```text
mergeInvoices():        invoices(fromId) → invoices(toId)      ← caller-dependent
bulkArchiveTasks():     tasks in planner order                 ← non-deterministic
applyLateFees():        invoices ordered by due_date           ← different order again
```

**Step 5 — impose one canonical order** across all of them and add a test that
runs the two paths concurrently.

**Step 6 — turn on the early warning.** `log_lock_waits = on` logs any wait
longer than `deadlock_timeout`, including the ones that resolve:

```text
LOG:  process 31902 still waiting for ShareLock on transaction 5187 after 1000.114 ms
DETAIL:  Process holding the lock: 29144. Wait queue: 31902, 31955.
CONTEXT:  while updating tuple (0,7) in relation "invoices"
STATEMENT:  UPDATE invoices SET amount_cents = 0 WHERE id = 4022
```

Long waits are deadlocks that got lucky. Fixing them fixes the deadlocks too.

**Step 7 — alert on the retry metric**, not on the error rate. By the time
deadlocks show up as 500s, the retry loop has already failed five times.

---

## Advanced: Deadlock vs Livelock vs a Plain Lock Wait

When an application "hangs", people say deadlock. It usually is not.

| | Deadlock | Plain lock wait | Livelock |
|---|---|---|---|
| What is happening | A cycle of waits | One transaction waits for another that is doing real work (or nothing) | Transactions keep retrying and keep colliding |
| Detected by PostgreSQL? | **Yes**, after `deadlock_timeout` | No — waiting is normal | No |
| How it ends | One transaction aborted with `40P01` | When the holder commits, or a timeout fires | Never, on its own |
| What you see | An error in the logs | A **hang**, then eventual success or timeout | High CPU, high retry rate, no progress |
| How common | Uncommon | **Very common** | Rare, usually self-inflicted |

> **📌 An application that hangs is far more often a plain lock wait than a
> deadlock.** A deadlock announces itself with an error within about a second. A
> hang that lasts minutes is something holding a lock — usually a transaction
> that is idle in transaction, or a long-running query.

The diagnostic that tells them apart in one query:

```sql
SELECT a.pid,
       a.state,
       now() - a.xact_start           AS txn_age,
       now() - a.query_start          AS query_age,
       a.wait_event_type,
       a.wait_event,
       pg_blocking_pids(a.pid)        AS blocked_by,
       left(a.query, 60)              AS query
FROM   pg_stat_activity a
WHERE  a.datname = current_database()
  AND  a.pid <> pg_backend_pid()
ORDER  BY a.xact_start NULLS LAST;
```

```text
  pid  |        state        |   txn_age   |  query_age  | wait_event_type | wait_event  | blocked_by |          query
-------+---------------------+-------------+-------------+-----------------+-------------+------------+--------------------------
 28841 | idle in transaction | 00:12:04.10 | 00:12:01.88 | Client          | ClientRead  | {}         | SELECT * FROM invoices W
 31902 | active              | 00:11:50.33 | 00:11:50.33 | Lock            | transactionid | {28841}  | UPDATE invoices SET stat
 31955 | active              | 00:11:44.02 | 00:11:44.02 | Lock            | transactionid | {28841}  | UPDATE invoices SET stat
```

Read it like this:

- `wait_event_type = 'Lock'` and a non-empty `blocked_by` → it is waiting on a
  lock. Follow `blocked_by` to the root.
- If the root is `idle in transaction` with `wait_event = ClientRead`, **it is
  not a deadlock.** It is an abandoned transaction. Nothing will ever resolve it
  and PostgreSQL will never kill it — it is not part of a cycle. You terminate
  it, and you set `idle_in_transaction_session_timeout` so it cannot recur.
- If `blocked_by` forms a cycle (A blocked by B, B blocked by A), you have a
  genuine deadlock, and it will resolve itself within `deadlock_timeout`.
- If `pg_stat_database.deadlocks` is not rising but retries are, you have a
  livelock: usually an unbounded retry loop with no jitter, hammering the same
  rows. The fix is the jitter and the attempt bound from
  [Retrying Correctly](#retrying-correctly).

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Retrying only the failed statement | The transaction is aborted; every further statement errors | Restart from `BEGIN` |
| No retry at all | An unavoidable deadlock becomes a user-visible 500 | Bounded, jittered retry on `40P01` and `40001` |
| Unbounded retries | Turns contention into an outage | Cap at about five attempts |
| Retrying with no jitter | The two transactions collide again on the same schedule | Full jitter |
| Calling every hang a deadlock | Deadlocks resolve in ~1 second with an error | Check `pg_stat_database.deadlocks` and `pg_blocking_pids` |
| An HTTP call inside the retried transaction | It can now fire five times | Move it after `COMMIT`; use idempotency keys |

---

## Questions to Test Yourself

1. Write a correct retry loop. Name the two SQLSTATEs, and say why the whole
   transaction must be restarted.
2. Why is jitter necessary in the backoff?
3. What must be true of a transaction body for a retry to be safe? How does an
   idempotency key help?
4. Your application is hanging. Give the query that tells you whether it is a
   deadlock or a lock wait, and say what each result means.
5. `pg_stat_database.deadlocks` is flat but your retry metric is climbing.
   What is happening?
6. What is a livelock, and why does a retry loop with no jitter and no attempt
   bound make one more likely?

---

## Related

- [Part 1](05-deadlocks-part-1.md) — what a deadlock is, the worked timeline,
  how PostgreSQL detects and reports one, and the five common causes.
- [Locks](04-locks-part-2.md) — inspecting locks during an incident, and the
  hot rows that keep producing them.
- [Isolation Levels and Anomalies](02-isolation-levels-and-anomalies-part-2.md)
  — the other retryable error, `40001`.
- [Transactions and ACID](01-transactions-and-acid-part-2.md) — short
  transactions as the root fix, and why side effects must stay outside.
- [Optimistic vs Pessimistic Locking](06-optimistic-vs-pessimistic-locking-part-1.md)
  — how avoiding locks changes the deadlock picture.
- [circuit-breakers-and-retries](../../system-design/reliability/circuit-breakers-and-retries.md)
  — backoff, jitter and when to stop retrying.
- [idempotency](../../system-design/reliability/idempotency.md) — what makes a
  retried operation safe.
