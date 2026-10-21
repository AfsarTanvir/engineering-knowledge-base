# Optimistic vs Pessimistic Locking — Part 1

Two users open invoice 4021 in their browsers. Ana changes the amount. Ben
changes the due date. Both press **Save**.

What should happen?

There are only three honest answers, and choosing between them is a product
decision as much as a technical one:

1. **Make Ben wait** while Ana's save completes — *pessimistic locking*.
2. **Let both try, and tell Ben his copy is out of date** — *optimistic
   locking*.
3. **Make the change expressible in a way that cannot conflict** — an *atomic
   update*, which beats both when it applies.

> **📌 In one line:** pessimistic locking prevents the conflict by making the
> second user wait; optimistic locking detects the conflict and makes the
> second user retry; an atomic update makes the conflict impossible.

This file is about picking the right one. This part covers the first two
strategies in full — how each is written, what each costs, and how they compare.
Part 2 covers the third, and everything you can do with a conflict other than
reject it.

## Table of Contents

1. [Pessimistic Locking](#pessimistic-locking)
2. [Optimistic Locking](#optimistic-locking)
3. [Checking the Affected Row Count](#checking-the-affected-row-count)
4. [Comparing the Two](#comparing-the-two)
5. [Both Solve the Lost Update](#both-solve-the-lost-update)
6. [Common Mistakes](#common-mistakes)
7. [Questions to Test Yourself](#questions-to-test-yourself)
8. [Related](#related)

---

## Pessimistic Locking

*Assume a conflict will happen. Take the lock first.*

```sql
BEGIN;

SELECT amount_cents, status
FROM   invoices
WHERE  id = 4021
FOR    UPDATE;                    -- ① nobody else can touch this row now

-- ② application computes the new values

UPDATE invoices
SET    amount_cents = 30000
WHERE  id = 4021;                 -- ③

COMMIT;                           -- ④ lock released here
```

The critical constraint: **steps ① to ④ must be one transaction.** Lock, work,
write, commit. If you commit between ① and ③, the lock is gone and you have the
original race back.

| Time | Session A (Ana) | Session B (Ben) |
|---|---|---|
| T1 | `BEGIN;` | |
| T2 | `SELECT ... FROM invoices WHERE id=4021 FOR UPDATE;` → `25000` 🔒 | |
| T3 | | `BEGIN;` |
| T4 | | `SELECT ... FROM invoices WHERE id=4021 FOR UPDATE;` ⏸ **blocked** |
| T5 | `UPDATE invoices SET amount_cents=30000 WHERE id=4021;` | ⏸ blocked |
| T6 | `COMMIT;` | |
| T7 | | unblocks, reads **`30000`** — the fresh value |
| T8 | | `UPDATE invoices SET due_date='2026-10-01' WHERE id=4021;` |
| T9 | | `COMMIT;` ✅ both changes survive |

Ben never saw a stale value and never got an error. From his point of view the
save took 200 ms longer than usual. That is the appeal.

**What it costs:**

- **Other sessions wait**, and they wait for the whole transaction, not the
  statement ([04-locks-part-1.md](04-locks-part-1.md)).
- **One slow transaction becomes everyone's problem.** If Ana's code calls an
  API between ② and ③, every other user of that invoice waits for that API.
- **Deadlock risk** rises with the number of rows locked and the length of the
  transaction ([05-deadlocks-part-1.md](05-deadlocks-part-1.md)).
- **It does not survive a user "thinking".** You cannot hold a database lock
  across an HTTP request boundary while a human decides what to type. A lock is
  a transaction-lifetime thing; a browser form is not.

**When it is right:**

| Condition | Why |
|---|---|
| The critical section is short — milliseconds, all in SQL | The wait is invisible |
| Contention is high | Optimistic would fail constantly and retry-storm |
| A retry would be expensive or user-visible | Better to wait 50 ms than redo work |
| The operation is server-to-server, not user-facing | No human in the loop to hold the lock open |
| Correctness matters more than throughput | Payments, ledgers, seat allocation |

---

## Optimistic Locking

*Assume conflicts are rare. Take no lock; detect the collision at write time.*

Add a version column (adding it to `invoices` for this folder):

```sql
ALTER TABLE invoices ADD COLUMN version integer NOT NULL DEFAULT 1;
```

Read it along with the data, then assert it has not moved when you write:

```sql
-- ① Read (no lock, no open transaction needed)
SELECT id, amount_cents, status, version
FROM   invoices
WHERE  id = 4021;
-- → amount_cents = 25000, version = 7

-- ② ... time passes. The user edits a form. Minutes, maybe. ...

-- ③ Write, asserting the version has not changed
UPDATE invoices
SET    amount_cents = 30000,
       version      = version + 1
WHERE  id      = 4021
  AND  version = 7;              -- ← the whole mechanism
```

If the row is still at version 7, one row is updated and the version becomes 8.
If somebody else saved in between, the row is at version 8, the `WHERE` matches
nothing, and the result is `UPDATE 0`.

| Time | Session A (Ana) | Session B (Ben) |
|---|---|---|
| T1 | `SELECT ... version` → `25000`, v7 | |
| T2 | | `SELECT ... version` → `25000`, v7 |
| T3 | *(user edits the form for 90 seconds)* | *(user edits the form)* |
| T4 | `UPDATE ... SET amount_cents=30000, version=8 WHERE id=4021 AND version=7;` → **`UPDATE 1`** ✅ | |
| T5 | | `UPDATE ... SET due_date=..., version=8 WHERE id=4021 AND version=7;` → **`UPDATE 0`** ⚠️ |
| T6 | | detects 0 rows → tells Ben the invoice changed |

Nobody waited. Nobody held a lock across 90 seconds of typing. Ben gets a clear,
honest message instead of a silently lost edit.

The full pattern in application code:

```ts
async function updateInvoiceAmount(id: number, newAmount: number, expectedVersion: number) {
  const result = await db.query(
    `UPDATE invoices
     SET    amount_cents = $1, version = version + 1
     WHERE  id = $2 AND version = $3`,
    [newAmount, id, expectedVersion],
  )

  if (result.rowCount === 0) {
    // Either the row is gone, or someone else saved first. Distinguish:
    const current = await db.maybeOne('SELECT version FROM invoices WHERE id = $1', [id])
    if (!current) throw new NotFoundError(`invoice ${id}`)
    throw new ConflictError(
      `invoice ${id} was modified by someone else (expected v${expectedVersion}, now v${current.version})`,
    )
  }
}
```

That `ConflictError` should become **HTTP 409 Conflict** at the API edge, with
enough information for the client to re-fetch and show the user what changed.

> **📌 `updated_at` instead of `version` works too** — `WHERE updated_at = $3`
> — and needs no schema change. Two cautions: timestamp precision can collide
> under fast concurrent writes, and any code path that forgets to bump
> `updated_at` silently breaks the check. An integer `version` is unambiguous.
> Use `updated_at` only when you cannot add a column.

---

## Checking the Affected Row Count

This is the most commonly missed step in the whole pattern, and skipping it
turns optimistic locking into a decoration that does nothing.

**❌ BROKEN — the version check is there, but nobody reads the answer:**

```ts
await db.query(
  `UPDATE invoices SET amount_cents = $1, version = version + 1
   WHERE id = $2 AND version = $3`,
  [newAmount, id, expectedVersion],
)
return { ok: true }        // ← no idea whether anything was updated
```

Ben's save matched zero rows. No error was thrown, because `UPDATE 0` is a
perfectly successful statement. The API returns `200 OK`, the UI shows "Saved",
and Ben's change does not exist. **This is strictly worse than no optimistic
locking at all**, because the team now believes the problem is handled.

**✅ FIXED — the row count is the result:**

```ts
const result = await db.query(
  `UPDATE invoices SET amount_cents = $1, version = version + 1
   WHERE id = $2 AND version = $3`,
  [newAmount, id, expectedVersion],
)
if (result.rowCount === 0) throw new ConflictError('invoice was modified by someone else')
return { ok: true }
```

Three reasons this matters beyond optimistic locking:

1. **`UPDATE 0` is a success, not an error.** SQL has no concept of "I expected
   to change a row". Only your code can assert that.
2. **It is your only signal.** No lock was taken, no exception was raised. The
   row count is the entire conflict-detection mechanism.
3. **It catches other bugs too.** A wrong id, a row deleted underneath you, a
   `WHERE` clause that no longer matches after a concurrent change (the Read
   Committed re-check from
   [02-isolation-levels-and-anomalies-part-2.md](02-isolation-levels-and-anomalies-part-2.md#read-committed-in-practice-two-queries-can-disagree))
   all show up as `UPDATE 0`.

Make it a habit for **every** `UPDATE` and `DELETE` that is supposed to affect a
specific row, optimistic locking or not.

---

## Comparing the Two

| | Pessimistic (`FOR UPDATE`) | Optimistic (`version` column) |
|---|---|---|
| **When the lock is taken** | At read time, held to commit | Never |
| **Contention it suits** | High — conflicts are expected | Low — conflicts are rare |
| **Transaction length it suits** | Short only (milliseconds) | Any, including across HTTP requests |
| **What the second user experiences** | **Waits**, then succeeds silently | **Fails**, must re-fetch and retry or merge |
| **Failure is** | Invisible latency | A visible 409 |
| **Complexity** | Low in SQL, but the whole read-write must be one transaction | Schema column, version plumbing through the API, client-side conflict UI |
| **Deadlock risk** | Real — grows with rows locked and transaction length | **None** — no locks held across statements |
| **Throughput under load** | Drops; waiters queue | Stays high; conflicts become retries |
| **Works across a stateless HTTP request?** | ❌ No | ✅ Yes — that is its main advantage |
| **Wasted work on conflict** | None | The loser's work is thrown away |

The user-experience difference is the part worth thinking about hardest,
because it is the part your users will actually feel:

**Pessimistic feels like the app is slow.** Ben clicks Save, the spinner turns a
little longer, it succeeds. He never knows a conflict occurred. Under heavy
contention the spinner turns for a long time and he assumes the app is broken.

**Optimistic feels like the app is honest.** Ben clicks Save and is told "Ana
updated this invoice while you were editing — here is what changed". That is a
better outcome when his edit took 90 seconds of typing, and an annoying one if
it happens every time.

> **📌 The deciding question is usually: how long is the gap between reading and
> writing?** Milliseconds inside one server call → pessimistic is fine.
> Seconds or minutes with a human in between → optimistic is the only option,
> because you cannot hold a database lock across a user's coffee break.

---

## Both Solve the Lost Update

Back to the lost update from
[02-isolation-levels-and-anomalies-part-1.md](02-isolation-levels-and-anomalies-part-1.md#lost-update):
two agents each add a late fee, both read `25000`, and 5000 disappears.

| Approach | What happens to agent 2 |
|---|---|
| **Nothing** | Silently overwrites. Final value 27000. Wrong, no error |
| **Pessimistic** | Blocks at the `SELECT ... FOR UPDATE`, then reads 30000 and writes 32000. Correct |
| **Optimistic** | `UPDATE 0`, gets a 409, re-reads 30000, writes 32000. Correct, with one extra round trip |
| **Atomic update** | `SET amount_cents = amount_cents + 2000`. Correct with no read at all |
| **Repeatable Read** | `could not serialize access due to concurrent update`. Correct, needs a retry |

Five paths to the same correct answer. The one that is wrong is the default —
read in application code, compute, write back.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Not checking `rowCount` after an optimistic update | `UPDATE 0` is a success; the conflict is invisible | Throw on zero rows, always |
| `SELECT ... FOR UPDATE`, commit, then update separately | The lock is released before the write | One transaction across the whole read-modify-write |
| Holding a `FOR UPDATE` lock across an HTTP request | A lock cannot span a user's thinking time | Optimistic locking with a version |
| Using `updated_at` as the version without care | Precision collisions; any path that forgets to bump it breaks the check | An integer `version` column |

---

## Questions to Test Yourself

1. Two users open the same invoice and both press Save. Describe what each of
   the three strategies does.
2. Write the pessimistic pattern in SQL. Which part must be inside one
   transaction, and what breaks if you commit early?
3. Write the optimistic pattern in SQL. What exactly signals a conflict?
4. Why is checking the affected row count essential? Describe what a user
   experiences when it is skipped.
5. Compare optimistic and pessimistic across contention, transaction length,
   user experience, complexity, and deadlock risk.
6. Which strategy can work across a stateless HTTP request, and why can the
   other not?
7. Give three different fixes for the lost update, and say which needs no
   schema change and no retry.

---

> **➡️ Continued in [Part 2](./06-optimistic-vs-pessimistic-locking-part-2.md)**

---

## Related

- [Part 2](06-optimistic-vs-pessimistic-locking-part-2.md) — atomic in-place
  updates, unique constraints, `ON CONFLICT`, conflict resolution beyond
  rejecting, and `ETag`/`If-Match`.
- [Locks](04-locks-part-1.md) — `SELECT ... FOR UPDATE`, `SKIP LOCKED`, and
  what pessimistic locking actually costs.
- [Isolation Levels and Anomalies](02-isolation-levels-and-anomalies-part-1.md)
  — the lost update this file solves four ways.
- [Deadlocks](05-deadlocks-part-1.md) — the risk pessimistic locking carries
  and optimistic locking avoids.
- [MVCC](03-mvcc-part-1.md) — why a plain read needs no lock in the first
  place.
- [Transactions and ACID](01-transactions-and-acid-part-2.md) — why the
  pessimistic transaction must stay short.
- [orm-vs-query-builder](../../backend-fundamentals/10-database-integration/01-orm-vs-query-builder.md)
  — built-in version columns and where the transaction boundary belongs.
