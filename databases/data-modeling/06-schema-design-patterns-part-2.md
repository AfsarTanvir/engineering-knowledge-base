# Schema Design Patterns — Part 2

Part 1 covered naming, audit columns, soft deletes and tenancy — the decisions
that touch every table. This part covers the ones that touch particular kinds
of column: status, money, event history, lookup values and nullability. It
closes with the checklist to run against any table someone hands you.

> **⬅️ This continues [Part 1](./06-schema-design-patterns-part-1.md).**

> **📌 In one line:** One status column beats a pile of booleans, money always
> carries its currency, events always need a retention plan, and `NOT NULL` is
> the default you should have to argue your way out of.

## Table of Contents

1. [Status and State Machines](#status-and-state-machines)
2. [Money and Currency](#money-and-currency)
3. [Event and History Tables](#event-and-history-tables)
4. [Lookup Tables vs Enums vs Check Constraints](#lookup-tables-vs-enums-vs-check-constraints)
5. [Nullable Columns](#nullable-columns)
6. [The Schema Review Checklist](#the-schema-review-checklist)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)
9. [Related](#related)

---

## Status and State Machines

**The problem:** things have states, states change in an order, and some
combinations must never exist.

### One status column with a `CHECK`

```sql
ALTER TABLE invoices
    ADD CONSTRAINT invoices_status_valid
    CHECK (status IN ('draft', 'issued', 'paid', 'void', 'refunded'));
```

### Why booleans create impossible states

**The trap:** it starts with one flag, and each new flag doubles the number of
combinations you have to think about.

```sql
-- ❌ BROKEN — four booleans, sixteen combinations, four of them valid
ALTER TABLE projects
    ADD COLUMN is_active   boolean NOT NULL DEFAULT true,
    ADD COLUMN is_archived boolean NOT NULL DEFAULT false,
    ADD COLUMN is_draft    boolean NOT NULL DEFAULT false,
    ADD COLUMN is_deleted  boolean NOT NULL DEFAULT false;
```

What is a project that is both `is_active` and `is_archived`? Both `is_draft`
and `is_deleted`? The database has no opinion, so every one of those rows can
exist, and every query in your application has to decide what to do with them.
Worse, every reader invents a different rule: one endpoint checks
`is_active AND NOT is_archived`, another checks `NOT is_deleted`, and they
disagree about the same row.

```sql
-- ✅ FIXED — one column, states are mutually exclusive by construction
ALTER TABLE projects
    DROP COLUMN is_active,
    DROP COLUMN is_archived,
    DROP COLUMN is_draft,
    DROP COLUMN is_deleted;

ALTER TABLE projects
    ADD CONSTRAINT projects_status_valid
    CHECK (status IN ('draft', 'active', 'archived', 'deleted'));
```

One column, four states, and "active and archived at the same time" is not a
representable value. The impossible state is impossible, rather than merely
unlikely.

> **💡 Tip:** The test for whether two booleans should be one status column: can
> both be true at once in a way that means something? If not, they are one
> column.

### Recording transitions

A status column tells you where something is, never how it got there. When
"why is this invoice void?" matters — and for money it always does — record the
transitions:

```sql
CREATE TABLE invoice_status_history (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id  bigint      NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
    from_status text,                      -- NULL for the first row
    to_status   text        NOT NULL,
    reason      text,
    changed_by  bigint      REFERENCES users (id) ON DELETE SET NULL,
    changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoice_status_history_invoice_idx
    ON invoice_status_history (invoice_id, changed_at DESC);
```

The current status stays denormalized on `invoices` because every list query
needs it; the history is the audit trail.

Enforcing **which** transitions are legal (`draft → issued` yes, `paid → draft`
no) is beyond a `CHECK`, since it needs the old and new values together. A
`BEFORE UPDATE` trigger can do it, with the visibility caveat from file 02 — or
keep it in a single, well-tested place in the application and accept that the
database does not guarantee it.

---

## Money and Currency

**The problem:** an amount without a currency is not an amount.

**The rule:** store the currency in the same row as the amount, always.

```sql
ALTER TABLE invoices
    ADD COLUMN currency char(3) NOT NULL DEFAULT 'USD';

ALTER TABLE invoices
    ADD CONSTRAINT invoices_currency_valid
    CHECK (currency ~ '^[A-Z]{3}$');
```

Even if you are single-currency today. Adding the column later means deciding,
for every historical row, what currency it was — and the answer is a guess.

**The trap:** summing across currencies. It produces a number, it looks
reasonable, and it is meaningless.

```sql
-- ❌ BROKEN — adds dollars to euros to yen
SELECT sum(amount_cents) FROM invoices WHERE status = 'paid';
```

```sql
-- ✅ FIXED — currency is always a grouping key
SELECT currency, sum(amount_cents) AS total_cents
FROM   invoices
WHERE  status = 'paid'
GROUP  BY currency;
```

```text
 currency | total_cents
----------+-------------
 EUR      |     2884000
 GBP      |     1120050
 USD      |    18934200
```

If you must present one number, convert explicitly with a stored rate, and
store the rate you used:

```sql
ALTER TABLE invoices
    ADD COLUMN fx_rate_to_usd numeric(18,8),
    ADD COLUMN fx_rate_at     timestamptz;
```

Rates change, so "what was this worth" and "what is this worth" are different
questions. Storing the rate you applied is what makes last quarter's report
reproducible.

`amount_cents` as `bigint` rather than `float`, and the minor-units convention,
are covered in
[05-postgres-data-types-part-1.md](05-postgres-data-types-part-1.md#money-numeric-vs-float-vs-integer-cents).

> **⚠️ Warning:** Not every currency has two decimal places. JPY has none, and
> a few have three. "Cents" is shorthand — store minor units and keep the
> exponent per currency if you handle more than a couple.

---

## Event and History Tables

**The problem:** audit logs, activity feeds, notifications and webhook
deliveries are **append-only** and grow without limit. They will be your
biggest tables within a year, and the first place a backup or a `VACUUM`
becomes painful.

### Design them as append-only

```sql
CREATE TABLE activity_events (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id  bigint      NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    actor_id    bigint      REFERENCES users (id) ON DELETE SET NULL,
    entity_type text        NOT NULL,
    entity_id   bigint      NOT NULL,
    action      text        NOT NULL,
    payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX activity_events_company_time_idx
    ON activity_events (company_id, occurred_at DESC);
CREATE INDEX activity_events_entity_idx
    ON activity_events (entity_type, entity_id, occurred_at DESC);
```

Properties that matter:

- **No `updated_at`, no updates.** An event is a record of something that
  happened; it cannot change. An append-only table never produces dead row
  versions, so `VACUUM` has almost nothing to do.
- **`occurred_at`, not `created_at`.** When the event happened may differ from
  when you recorded it, especially for events arriving from a queue.
- **The tenant key is first in the index**, and time is second, descending —
  which is exactly how a feed is read.
- **Payload in `jsonb`** because event shapes genuinely vary and are never
  filtered on in the hot path. This is one of the honest `jsonb` use cases from
  [05-postgres-data-types-part-2.md](05-postgres-data-types-part-2.md#jsonb).

### Keep them from eating the database

Three tools, in the order you will need them:

1. **A retention policy.** Decide how long events are useful before you write
   the first one. Most activity feeds are never read past 90 days.
2. **Deleting old rows is expensive.** A `DELETE` of ten million rows writes
   ten million dead tuples that `VACUUM` must then reclaim, and does not return
   disk to the operating system.
3. **Partitioning by time** is the real answer. Split the table by month;
   dropping a month is `DROP TABLE` on a partition — instant, no dead tuples,
   space returned immediately.

```sql
CREATE TABLE activity_events (
    id          bigint GENERATED ALWAYS AS IDENTITY,
    company_id  bigint      NOT NULL,
    actor_id    bigint,
    entity_type text        NOT NULL,
    entity_id   bigint      NOT NULL,
    action      text        NOT NULL,
    payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE activity_events_2026_05 PARTITION OF activity_events
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
```

Note the primary key must include the partition key — a PostgreSQL requirement
that surprises people, and a reason to design partitioning in early rather than
retrofit it.

Partitioning also gives the planner **partition pruning**: a query with
`occurred_at >= '2026-05-01'` skips every other partition entirely.

The conceptual step beyond this — splitting data across machines — is
[../../system-design/foundational/database-sharding.md](../../system-design/foundational/database-sharding.md).

---

## Lookup Tables vs Enums vs Check Constraints

**The problem:** constraining a column to a set of values.

The full comparison table, the operational pain of altering an `enum` type, and
the recommendation are in
[02-constraints-and-data-integrity-part-2.md](02-constraints-and-data-integrity-part-2.md#enum-values-three-ways).

The short form, repeated here because it is a per-table decision you will make
constantly:

| Situation | Choose |
|---|---|
| Fixed, internal, no attributes (`draft`/`issued`/`paid`) | `CHECK` on a `text` column |
| Needs a label, sort order, colour, or an "is terminal" flag | Lookup table + foreign key |
| Customers can define their own values | Lookup table, with `company_id` |
| Genuinely closed set, hundreds of millions of rows, bytes matter | `enum` type |

**The trap:** an `enum` type chosen early for a list that turns out to grow.
Every addition becomes a migration with version-dependent transaction rules,
and removal is not supported at all.

---

## Nullable Columns

**The problem:** `NULL` is not a value, it is "unknown", and it behaves
differently from a value in every operation. Each nullable column pushes that
difference into every query that touches it.

```sql
-- NULL is not equal to anything, including itself
SELECT NULL = NULL;                         -- NULL, not true
SELECT count(*) FROM tasks WHERE assignee_id <> 5;  -- excludes unassigned tasks!
```

That second query is the classic bug. "Tasks not assigned to user 5" reads
correctly and silently omits every unassigned task, because `NULL <> 5` is
`NULL`, not true. The correct form is
`WHERE assignee_id IS DISTINCT FROM 5`.

`NULL` also spreads through aggregates (`sum` ignores them, `count(col)` ignores
them but `count(*)` does not), through joins, and through unique constraints
(multiple `NULL`s are allowed — see
[02-constraints-and-data-integrity-part-1.md](02-constraints-and-data-integrity-part-1.md#nulls-are-not-equal-to-each-other)).

**The rule: make every column `NOT NULL` by default, and justify each
exception.** Write the justification down.

| Column | Nullable? | Justification |
|---|---|---|
| `tasks.title` | `NOT NULL` | A task without a title is meaningless |
| `tasks.project_id` | `NOT NULL` | Every task belongs to a project |
| `tasks.assignee_id` | Nullable | "Unassigned" is a real, meaningful state |
| `tasks.due_date` | Nullable | "No deadline" is a real state |
| `tasks.status` | `NOT NULL DEFAULT 'open'` | Always has a state |
| `invoices.paid_at` | Nullable | Unpaid invoices exist; `NULL` means "not yet" |
| `projects.archived_at` | Nullable | `NULL` means "not archived" — a timestamp doing double duty as a flag |

Notice the pattern in the legitimate cases: `NULL` means **"this has not
happened"** or **"there genuinely is none"**. That is a good use. `NULL` meaning
"we did not bother to fill this in" or "zero" or "empty string" is not — use a
default instead.

> **💡 Tip:** Adding `NOT NULL` to an existing column used to require a full
> table scan under an exclusive lock. Recent PostgreSQL versions can use a
> validated `CHECK (col IS NOT NULL)` constraint to skip that scan. The
> two-step pattern from
> [02-constraints-and-data-integrity-part-2.md](02-constraints-and-data-integrity-part-2.md#adding-a-constraint-to-a-table-with-bad-data)
> applies — add the `CHECK` as `NOT VALID`, validate it, then set `NOT NULL`.

---

## The Schema Review Checklist

Run this against any table before it ships.

**Keys**

- [ ] Has a primary key.
- [ ] The key is a surrogate (`bigint` identity, or UUIDv7/ULID if externally
      visible), not a business value that can change.
- [ ] Natural keys have their own `UNIQUE` constraint.
- [ ] Every foreign key column has an index.
- [ ] Join tables are indexed from **both** directions.

**Relationships**

- [ ] Every `ON DELETE` is a deliberate choice, not a default.
- [ ] No `CASCADE` on anything with independent value (invoices, audit records).
- [ ] The tenant key is part of the foreign key where the child is tenant-owned.

**Constraints**

- [ ] Every column is `NOT NULL` unless there is a written reason.
- [ ] Status columns have a `CHECK` listing the valid values.
- [ ] Amounts have a non-negative `CHECK`.
- [ ] Date pairs have an ordering `CHECK`.
- [ ] Every constraint is explicitly named.
- [ ] Soft-deleted tables use partial unique indexes.

**Types**

- [ ] Every instant is `timestamptz`, never `timestamp`.
- [ ] Calendar dates are `date`.
- [ ] Money is `bigint` minor units with the unit in the column name.
- [ ] Every money column has a currency alongside it.
- [ ] `text`, not `varchar(n)`.
- [ ] No `jsonb` column holding something you filter or sort on.
- [ ] No array holding ids that should be a join table.

**Naming**

- [ ] Plural table, `snake_case`, `id` primary key, `<table>_id` foreign keys.
- [ ] Booleans are `is_`/`has_`; timestamps are `_at`; dates are `_on`/`_date`.
- [ ] Indexes and constraints follow the naming pattern.

**Multi-tenancy**

- [ ] Tenant-owned tables carry `company_id`.
- [ ] `company_id` is the leading column of composite indexes.
- [ ] A reconciliation query exists for any denormalized tenant key.

**Operations**

- [ ] `created_at` and `updated_at` exist, with a trigger maintaining
      `updated_at`.
- [ ] Append-only tables have a retention plan and, if large, a partitioning
      plan.
- [ ] Every denormalized value has a scheduled reconciliation query.

---

## Common Mistakes

1. **A pile of booleans instead of one status column.** Impossible states become
   representable.
2. **`sum(amount_cents)` across mixed currencies.**
3. **No currency column "because we are single-currency".** You will not be.
4. **An events table with no retention or partitioning plan.** It becomes the
   biggest table you own and the hardest to shrink.
5. **Nullable by default.** `NULL` leaks into every query, and `<> value`
   silently excludes rows.

---

## Questions to Test Yourself

1. `is_active` and `is_archived` are both booleans. How many states can exist,
   how many are valid, and what replaces them?
2. Give two reasons to store a currency column even in a single-currency
   product.
3. Why is `DELETE` a poor way to expire an events table, and what is the
   better answer?
4. Why does `WHERE assignee_id <> 5` omit unassigned tasks, and what is the
   correct form?
5. The review checklist asks whether every foreign key has an index. Why does
   that belong on a *schema* checklist rather than a performance one?

---

## Related

- [README](README.md) — the rest of this folder.
- [Part 1](06-schema-design-patterns-part-1.md) — naming conventions, audit
  columns, soft deletes, and multi-tenancy columns.
- [Keys and relationships](01-keys-and-relationships-part-1.md) — primary keys,
  foreign keys, and `ON DELETE`.
- [Constraints and data integrity](02-constraints-and-data-integrity-part-2.md)
  — the enum comparison, and adding a constraint to existing data.
- [Normalization](03-normalization-part-1.md) — deciding which table a column
  belongs to.
- [Denormalization and read models](04-denormalization-and-read-models-part-2.md)
  — reconciliation queries for the values duplicated here.
- [PostgreSQL data types](05-postgres-data-types-part-1.md) — `timestamptz` and
  money; [Part 2](05-postgres-data-types-part-2.md) for `jsonb` and `text`.
- [Database sharding](../../system-design/foundational/database-sharding.md) —
  partitioning's bigger sibling.
- [ORM vs query builder](../../backend-fundamentals/10-database-integration/01-orm-vs-query-builder.md)
  — how these conventions surface in application code.
