# Constraints and Data Integrity — Part 2

Part 1 made the case for database-level integrity and worked through
`NOT NULL`, `CHECK` and `UNIQUE`. This part covers the rules those cannot
express — overlaps, and fixed lists of values — and then the code around them:
turning a violation into a clean API error, and adding a constraint to a table
that already contains data that would fail it.

> **⬅️ This continues [Part 1](./02-constraints-and-data-integrity-part-1.md).**

> **📌 In one line:** `EXCLUDE` and a well-chosen enum strategy cover what
> `CHECK` and `UNIQUE` cannot say, and the code around a constraint decides
> whether its violation becomes a clean `409` or a `500` at 3am.

## Table of Contents

1. [EXCLUDE: Preventing Overlaps](#exclude-preventing-overlaps)
2. [Enum Values: Three Ways](#enum-values-three-ways)
3. [Handling Constraint Violations in Application Code](#handling-constraint-violations-in-application-code)
4. [Adding a Constraint to a Table With Bad Data](#adding-a-constraint-to-a-table-with-bad-data)
5. [Advanced: Triggers for What Constraints Cannot Say](#advanced-triggers-for-what-constraints-cannot-say)
6. [Advanced: Row-Level Security](#advanced-row-level-security)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)
9. [Related](#related)

---

## EXCLUDE: Preventing Overlaps

Some rules are not "these two rows are equal" but "these two rows **overlap**".
A meeting room cannot be booked by two people at once. A subscription period
cannot overlap another for the same company.

Most teams try to solve this in application code: read the existing bookings,
check for a clash, then insert. Under concurrency that is simply wrong — two
requests both read, both see no clash, and both insert. The usual patch is an
advisory lock or a table lock, which works but must be remembered at every call
site, and does nothing about the migration or the admin in `psql`.

PostgreSQL has a constraint for it.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Adding a table to the shared schema for this example
CREATE TABLE subscriptions (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id   bigint    NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
    plan         text      NOT NULL,
    period       tstzrange NOT NULL,

    CONSTRAINT subscriptions_no_overlap
        EXCLUDE USING gist (company_id WITH =, period WITH &&)
);
```

Read the constraint out loud: "reject any two rows where `company_id` is equal
**and** `period` overlaps". `&&` is the range overlap operator. `btree_gist` is
the extension that lets a plain `bigint` participate in a GiST index alongside
a range.

```sql
INSERT INTO subscriptions (company_id, plan, period) VALUES
  (1, 'pro', tstzrange('2026-01-01', '2026-07-01', '[)'));
-- INSERT 0 1

INSERT INTO subscriptions (company_id, plan, period) VALUES
  (1, 'enterprise', tstzrange('2026-06-01', '2027-01-01', '[)'));
```

```text
ERROR:  conflicting key value violates exclusion constraint
        "subscriptions_no_overlap"
DETAIL:  Key (company_id, period)=(1, ["2026-06-01 00:00:00+00",
         "2027-01-01 00:00:00+00")) conflicts with existing key
         (company_id, period)=(1, ["2026-01-01 00:00:00+00",
         "2026-07-01 00:00:00+00")).
```

A different company may of course overlap freely, because `company_id WITH =`
only compares within the same company.

**Why this is more reliable than an application lock:**

| | Application check + lock | `EXCLUDE` constraint |
|---|---|---|
| Correct under concurrency | Only if every writer takes the same lock | Always — the index enforces it |
| Applies to migrations and `psql` | No | Yes |
| Can it be forgotten at a call site | Yes | There are no call sites |
| Throughput | Lock serialises all bookings | Only conflicting rows block |
| Where the rule is written | Spread across services | One line of DDL |

> **💡 Tip:** The `'[)'` bound notation means "include the start, exclude the
> end". Use it for time ranges. It is what makes a period ending at 10:00 and
> one starting at 10:00 *not* overlap, which is what a human expects.

This is PostgreSQL-only. MySQL has no equivalent, and there you genuinely do
need application-level locking.

---

## Enum Values: Three Ways

Every schema has status columns, and there are three ways to constrain them.

```sql
-- 1. A PostgreSQL enum type
CREATE TYPE task_status AS ENUM ('open', 'in_progress', 'blocked', 'done');
ALTER TABLE tasks ALTER COLUMN status TYPE task_status USING status::task_status;

-- 2. A CHECK constraint on a text column
ALTER TABLE tasks ADD CONSTRAINT tasks_status_valid
    CHECK (status IN ('open', 'in_progress', 'blocked', 'done'));

-- 3. A lookup table with a foreign key
CREATE TABLE task_statuses (
    code       text PRIMARY KEY,
    label      text    NOT NULL,
    sort_order int     NOT NULL,
    is_final   boolean NOT NULL DEFAULT false
);
ALTER TABLE tasks ADD CONSTRAINT tasks_status_fkey
    FOREIGN KEY (status) REFERENCES task_statuses (code);
```

| | `enum` type | `CHECK` constraint | Lookup table |
|---|---|---|---|
| Add a value | `ALTER TYPE ... ADD VALUE` — cannot run inside some transactions | Drop and re-add the constraint, scans the table | `INSERT` one row |
| Remove a value | Not supported — recreate the type | Drop and re-add | `DELETE`, and the FK stops you if in use |
| Rename a value | `ALTER TYPE ... RENAME VALUE` | Drop and re-add | `UPDATE` one row |
| Referential integrity | Type system | Expression | Real foreign key |
| Extra attributes (label, order, colour) | No | No | Yes — that is the point |
| Storage | 4 bytes | Full text per row | Full text per row (or an id) |
| Sort order | Declaration order | Alphabetical | Whatever column you add |
| Visible to the app as a list | Needs a catalogue query | Needs parsing the constraint | A plain `SELECT` |
| Deployment risk | Highest | Medium | Lowest |

### The pain of altering an enum

Adding a value to an enum type sounds trivial and is the one that catches
people out:

- `ALTER TYPE ... ADD VALUE` historically could not run inside a transaction
  block, which breaks migration tools that wrap everything in one. Recent
  versions relaxed this, but with conditions — check your version before
  relying on it.
- You **cannot remove** a value. The only way is to create a new type, convert
  every column, and drop the old one, which rewrites every table using it.
- Reordering values means recreating the type, because sort order is the
  declaration order.

### The recommendation

**Use a `CHECK` constraint on a `text` column for status values that are
fixed, few, and purely internal.** It is easy to read in `\d`, easy to change
with a normal migration, and the values are self-documenting in every query.

**Use a lookup table as soon as the values need attributes** — a display label,
a sort order, a colour, an "is this a terminal state" flag, or the ability for
a customer to add their own. A lookup table is the only option that is also a
place to put data about the values.

**Reach for an `enum` type only** when the set is truly closed (`'debit'`,
`'credit'`) and the four bytes per row genuinely matter across a very large
table.

See [06-schema-design-patterns-part-2.md](06-schema-design-patterns-part-2.md#status-and-state-machines)
for how this interacts with state machines.

---

## Handling Constraint Violations in Application Code

A constraint violation that reaches the user as a 500 is a wasted constraint.
The database told you exactly what was wrong; your job is to translate.

PostgreSQL returns a five-character **SQLSTATE** code with every error. These
codes are stable and standard — match on them, never on the message text,
which changes with locale and version.

| SQLSTATE | Name | Cause | Good HTTP response |
|---|---|---|---|
| `23502` | `not_null_violation` | Missing required column | `400` field error |
| `23503` | `foreign_key_violation` | Referenced row missing, or still referenced | `422`, or `409` on delete |
| `23505` | `unique_violation` | Duplicate value | `409 Conflict` |
| `23514` | `check_violation` | Failed a `CHECK` | `422` field error |
| `23P01` | `exclusion_violation` | Overlapping range | `409 Conflict` |
| `40001` | `serialization_failure` | Serializable conflict | Retry, then `409` |
| `40P01` | `deadlock_detected` | Deadlock victim | Retry once, then `500` |

```ts
// Turn a database constraint into a clean API error.
const CONSTRAINT_TO_FIELD: Record<string, { field: string; message: string }> = {
  users_email_unique: { field: "email", message: "That email is already registered." },
  users_one_primary_contact_per_company: {
    field: "isPrimaryContact",
    message: "This company already has a primary contact.",
  },
  subscriptions_no_overlap: {
    field: "period",
    message: "That period overlaps an existing subscription.",
  },
};

export function toApiError(err: unknown): ApiError {
  const e = err as { code?: string; constraint?: string };
  if (e.code === "23505" || e.code === "23P01") {
    const mapped = e.constraint ? CONSTRAINT_TO_FIELD[e.constraint] : undefined;
    return new ConflictError(mapped?.message ?? "That value is already taken.", {
      field: mapped?.field,
    });
  }
  if (e.code === "23514") return new UnprocessableError("A value was out of range.");
  if (e.code === "23503") return new UnprocessableError("A referenced record does not exist.");
  throw err; // not ours — let it become a 500 and get logged
}
```

Naming your constraints explicitly (rather than letting PostgreSQL generate
`users_email_key`) is what makes this mapping readable and stable.

### The race condition: why "check then insert" is not safe

This is the part that matters most.

```ts
// ❌ BROKEN — a race condition with a comfortable-looking shape
const existing = await db.query("SELECT 1 FROM users WHERE email = $1", [email]);
if (existing.rowCount > 0) throw new ConflictError("Email already registered");
await db.query("INSERT INTO users (company_id, email, name, role) VALUES ($1,$2,$3,$4)",
               [companyId, email, name, role]);
```

Two requests with the same email, arriving at the same moment:

| Time | Request A | Request B |
|---|---|---|
| T1 | `SELECT 1 FROM users WHERE email='sam@acme.com'` → 0 rows | |
| T2 | | `SELECT 1 FROM users WHERE email='sam@acme.com'` → 0 rows |
| T3 | `INSERT ...` → succeeds | |
| T4 | | `INSERT ...` → succeeds too |
| T5 | Two users now have the same email | |

No isolation level below `SERIALIZABLE` prevents this, because at T2 there is
no row for B to conflict with — the anomaly is about a row that does not exist
yet. The gap between the check and the insert is where the bug lives, and it is
microseconds wide, which is why it passes every test and fails in production.

```ts
// ✅ FIXED — let the constraint decide, and translate the error
try {
  await db.query(
    "INSERT INTO users (company_id, email, name, role) VALUES ($1,$2,$3,$4)",
    [companyId, email, name, role],
  );
} catch (err) {
  throw toApiError(err);   // 23505 -> 409 with a field error
}
```

The unique index is evaluated atomically as part of the insert. Exactly one of
the two requests wins; the other gets `23505` and a clean 409. There is no gap.

> **📌 Remember:** A pre-check is fine as a **user-experience optimisation** —
> it gives a nicer message before the form is submitted. It is never the
> enforcement. The enforcement is the constraint.

See
[../../backend-fundamentals/07-error-handling/01-error-taxonomy.md](../../backend-fundamentals/07-error-handling/01-error-taxonomy.md)
for how these map into your error hierarchy.

---

## Adding a Constraint to a Table With Bad Data

You want to add `CHECK (amount_cents >= 0)` to `invoices`. The table has ten
million rows and forty of them are negative from a bug two years ago.

Two problems: the constraint will be rejected, and even if the data were clean,
validating ten million rows holds an `ACCESS EXCLUSIVE` lock on the table for
the whole scan — which blocks every read and write.

PostgreSQL's answer is a two-step add.

```sql
-- Step 1: add the rule for NEW and UPDATED rows only. Fast, brief lock.
ALTER TABLE invoices
    ADD CONSTRAINT invoices_amount_non_negative
    CHECK (amount_cents >= 0) NOT VALID;
```

`NOT VALID` means: enforce this from now on, but do not scan what is already
there. This takes a brief `ACCESS EXCLUSIVE` lock to update the catalogue and
returns immediately. From this moment, no new bad row can be written.

```sql
-- Step 2: fix the existing bad rows, at your own pace.
SELECT id, company_id, amount_cents FROM invoices WHERE amount_cents < 0;

UPDATE invoices SET amount_cents = 0 WHERE amount_cents < 0 AND status = 'void';
-- ... and handle the rest by hand
```

```sql
-- Step 3: verify the history. Takes only a SHARE UPDATE EXCLUSIVE lock.
ALTER TABLE invoices VALIDATE CONSTRAINT invoices_amount_non_negative;
```

`VALIDATE CONSTRAINT` scans the table, but under a much weaker lock: normal
`SELECT`, `INSERT`, `UPDATE` and `DELETE` all continue. It will block, and be
blocked by, `VACUUM` and schema changes — nothing your users will notice.

| Approach | Lock taken | Duration | Blocks reads/writes |
|---|---|---|---|
| `ADD CONSTRAINT` in one step | `ACCESS EXCLUSIVE` | Full table scan | Yes — everything |
| `ADD ... NOT VALID` | `ACCESS EXCLUSIVE` | Milliseconds | Effectively no |
| `VALIDATE CONSTRAINT` | `SHARE UPDATE EXCLUSIVE` | Full table scan | No |

The same pattern works for foreign keys (`ADD CONSTRAINT ... REFERENCES ...
NOT VALID`), and the equivalent for unique constraints is `CREATE UNIQUE INDEX
CONCURRENTLY` followed by `ALTER TABLE ... ADD CONSTRAINT ... USING INDEX`.

> **⚠️ Warning:** A constraint left in the `NOT VALID` state forever still
> enforces new writes, but the planner will not use it for reasoning, and
> nobody knows whether the old data is clean. Always finish step 3.

---

## Advanced: Triggers for What Constraints Cannot Say

Some rules need to look at another table or at other rows. For those, a trigger
is the only enforcement the database offers.

```sql
CREATE FUNCTION enforce_task_in_same_company() RETURNS trigger AS $$
BEGIN
    IF NEW.assignee_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM   projects p
        JOIN   users u ON u.company_id = p.company_id
        WHERE  p.id = NEW.project_id
        AND    u.id = NEW.assignee_id
    ) THEN
        RAISE EXCEPTION 'assignee % is not in the same company as project %',
                        NEW.assignee_id, NEW.project_id
              USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_assignee_company_check
    BEFORE INSERT OR UPDATE OF assignee_id, project_id ON tasks
    FOR EACH ROW EXECUTE FUNCTION enforce_task_in_same_company();
```

> **⚠️ Warning:** Business logic in a trigger is **invisible to every developer
> reading the application code**. Someone will spend an afternoon looking for
> the code that rejected their insert, find nothing, and conclude the API is
> haunted. Triggers also run inside your transaction, so a slow one slows every
> write, and a trigger that writes to another table can deadlock in ways nobody
> predicted.

Use triggers for **integrity invariants** — facts about the data that must
never be false. Do not use them for **business processes** — sending an email,
calling a service, deciding a discount. And when you do use one, say so loudly:
name it obviously, comment it, and mention it in the model file in the
application code.

There is a much better answer to the specific example above: make
cross-company references **structurally impossible** by putting `company_id`
into the foreign key. See
[06-schema-design-patterns-part-1.md](06-schema-design-patterns-part-1.md#multi-tenancy-columns).

---

## Advanced: Row-Level Security

PostgreSQL can attach a policy to a table that filters which rows a given
database role may see or modify. The filter is applied by the engine, below
every query.

```sql
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tasks_tenant_isolation ON tasks
    USING (
        project_id IN (
            SELECT id FROM projects
            WHERE  company_id = current_setting('app.company_id')::bigint
        )
    );
```

With the session variable set per request, a `SELECT * FROM tasks` with no
`WHERE` clause returns only that tenant's tasks — even if the application
forgot the filter, even from `psql`.

It is powerful and it is not free: policies are extra predicates the planner
must handle, they can prevent index usage if written carelessly, and debugging
"why is this row missing" becomes harder. Treat it as **defence in depth**
behind correct application filtering, not as a replacement for it. See
[../../backend-fundamentals/06-authorization/01-authn-vs-authz.md](../../backend-fundamentals/06-authorization/01-authn-vs-authz.md)
for where authorization belongs overall.

---

## Common Mistakes

1. **Check-then-insert instead of catching `23505`.** A race condition that
   passes every test.
2. **Matching on error message text instead of SQLSTATE.** Breaks on a locale
   or version change.
3. **Letting PostgreSQL auto-name constraints.** You cannot map
   `users_email_key1` to a useful message.
4. **An `enum` type chosen for a list that will grow.** Every change becomes a
   risky migration.
5. **`ADD CONSTRAINT` in one step on a huge table.** An `ACCESS EXCLUSIVE` lock
   held for the length of a full scan, in production.
6. **Business rules hidden in triggers with no note anywhere else.**

---

## Questions to Test Yourself

1. Explain, with a two-column timeline, why check-then-insert produces duplicate
   users under concurrency, and why a unique constraint does not.
2. Which SQLSTATE codes map to `409 Conflict`, and why is matching on the
   message text a bug?
3. You need to stop two overlapping subscription periods for the same company.
   Compare an `EXCLUDE` constraint against an application lock on four axes.
4. You must add a `CHECK` to a table with ten million rows and some bad data.
   Describe the three steps and the lock each one takes.
5. When is a lookup table better than an `enum` type? Name two things a lookup
   table gives you that neither other option can.
6. A rule needs to look at other rows to decide whether a write is legal. Which
   mechanism do you reach for, and what do you write down so the next person
   finds it?

---

## Related

- [README](README.md) — the rest of this folder.
- [Part 1](02-constraints-and-data-integrity-part-1.md) — why the database is
  the only real guarantee, the constraint types and their errors, `CHECK`, and
  `UNIQUE` in depth.
- [Keys and relationships](01-keys-and-relationships-part-1.md) — primary and
  foreign keys, which are constraints too.
- [Schema design patterns](06-schema-design-patterns-part-2.md) — status
  columns and the lookup-table-vs-enum decision in context.
- [PostgreSQL data types](05-postgres-data-types-part-2.md) — range types for
  the `EXCLUDE` example, and enum types.
- [Partial indexes](../query-optimization/partial-indexes.md) — the mechanics
  behind the conditional unique index.
- [Error taxonomy](../../backend-fundamentals/07-error-handling/01-error-taxonomy.md)
  — turning SQLSTATE codes into API errors.
- [Why validation matters](../../backend-fundamentals/04-validation-and-input/01-why-validation-matters.md)
  — the application side of the same argument.
- [Authentication vs authorization](../../backend-fundamentals/06-authorization/01-authn-vs-authz.md)
  — where row-level security fits.
