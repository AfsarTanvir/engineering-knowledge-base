# Denormalization and Read Models — Part 1

A busy kitchen keeps a small board by the pass with today's table numbers
copied onto it. The real record is in the booking system; the board is a copy,
kept because walking to the terminal for every plate is too slow. It works —
right up until someone changes a booking and forgets the board, and a table
gets the wrong food.

Denormalization is that board. It is a deliberate, useful copy that will
eventually be wrong, and the whole skill is in knowing when the speed is worth
the wrongness and how you will notice when it drifts.

> **📌 In one line:** Denormalization trades guaranteed correctness for read
> speed — take the trade only after you have measured the problem and decided
> how you will detect the drift.

Part 2 weighs these forms against each other, and covers the part nobody enjoys:
noticing when a copy has gone wrong.

## Table of Contents

1. [The Rule, Stated Plainly](#the-rule-stated-plainly)
2. [Duplicating a Column to Avoid a Join](#duplicating-a-column-to-avoid-a-join)
3. [Counter Columns](#counter-columns)
4. [Precomputed Aggregates and Summary Tables](#precomputed-aggregates-and-summary-tables)
5. [Storing a Derived or Formatted Value](#storing-a-derived-or-formatted-value)
6. [Arrays and JSONB as Deliberate Denormalization](#arrays-and-jsonb-as-deliberate-denormalization)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)
9. [Related](#related)

---

## The Rule, Stated Plainly

[03-normalization-part-1.md](03-normalization-part-1.md) argued for storing every fact once.
This file argues, in specific and limited circumstances, for storing it twice.

The rule that keeps this from becoming an excuse:

> **📌 Remember:** Denormalize only when you have **measured** a real problem,
> **understand** the consistency cost you are accepting, and have **written the
> reconciliation query** that will tell you when the copy has drifted.

All three. A denormalization without a reconciliation check is not an
optimisation, it is a future incident with a head start.

And the order is never reversible in practice. A normalized schema can be
denormalized in an afternoon. A denormalized schema that has drifted for two
years cannot be normalized at all without a human deciding, row by row, which
copy was telling the truth.

---

## Duplicating a Column to Avoid a Join

### The example

Every tenant-scoped query in a multi-tenant SaaS needs the company. But
`tasks` only knows its project, and only `projects` knows the company:

```sql
-- Normalized: two tables to answer "this company's open tasks"
SELECT t.id, t.title, t.due_date
FROM   tasks    t
JOIN   projects p ON p.id = t.project_id
WHERE  p.company_id = 7
AND    t.status = 'open'
ORDER  BY t.due_date
LIMIT  50;
```

```text
Limit  (cost=8942.11..8942.23 rows=50 width=44)
       (actual time=214.882..214.901 rows=50 loops=1)
  ->  Sort  (cost=8942.11..8953.40 rows=4516 width=44)
        ->  Hash Join  (cost=142.30..8792.44 rows=4516 width=44)
              Hash Cond: (t.project_id = p.project_id)
              ->  Seq Scan on tasks t  (cost=0.00..8104.00 rows=98240 width=44)
                    Filter: (status = 'open'::text)
              ->  Hash  (cost=140.12..140.12 rows=174 width=8)
                    ->  Index Scan using projects_company_idx on projects p
Execution Time: 215.402 ms
```

The join forces the planner to find all open tasks first, then filter by
company. You cannot build one index that covers `p.company_id` and
`t.due_date`, because they are in different tables.

### The denormalization

```sql
ALTER TABLE tasks ADD COLUMN company_id bigint;

UPDATE tasks t
SET    company_id = p.company_id
FROM   projects p
WHERE  p.id = t.project_id;

ALTER TABLE tasks
    ALTER COLUMN company_id SET NOT NULL,
    ADD CONSTRAINT tasks_company_fkey
        FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT;

CREATE INDEX tasks_company_status_due_idx
    ON tasks (company_id, status, due_date);
```

```sql
SELECT id, title, due_date
FROM   tasks
WHERE  company_id = 7
AND    status = 'open'
ORDER  BY due_date
LIMIT  50;
```

```text
Limit  (cost=0.43..24.18 rows=50 width=44)
       (actual time=0.038..0.291 rows=50 loops=1)
  ->  Index Scan using tasks_company_status_due_idx on tasks
        (cost=0.43..2145.90 rows=4516 width=44)
        Index Cond: ((company_id = 7) AND (status = 'open'::text))
Execution Time: 0.334 ms
```

215 ms to 0.3 ms, and no sort at all, because the index already provides the
order. This one is genuinely worth it — tenant filtering happens on every
request in the system.

### The exact risk

**A project moves to a different company.** Now `tasks.company_id` says 7 while
`projects.company_id` says 12, and — worse than being merely stale — the tasks
of company 12 are visible to company 7. A denormalized tenant key that drifts
is a **security bug**, not a reporting bug.

Whatever code moves a project must update its tasks in the **same
transaction**:

```sql
BEGIN;
    UPDATE projects SET company_id = 12 WHERE id = 88;
    UPDATE tasks    SET company_id = 12 WHERE project_id = 88;
COMMIT;
```

There is a stronger version of this technique — making the cross-tenant
reference structurally impossible with a composite foreign key — in
[06-schema-design-patterns-part-1.md](06-schema-design-patterns-part-1.md#multi-tenancy-columns).
Use it if you can; it removes the drift risk entirely rather than managing it.

> **💡 Tip:** Duplicating an **immutable** value is nearly free of risk. If
> projects can never change company, `tasks.company_id` cannot drift. Ask "can
> the source ever change?" first — often the answer is no, and the whole
> problem disappears.

---

## Counter Columns

### The example

Every project card in the UI shows a task count. Counting on read is honest
and, past a certain size, slow:

```sql
SELECT p.id, p.name, count(t.id) AS task_count
FROM   projects p
LEFT   JOIN tasks t ON t.project_id = p.id
WHERE  p.company_id = 7
GROUP  BY p.id, p.name;
```

```text
HashAggregate  (cost=11204.88..11206.62 rows=174 width=40)
               (actual time=182.401..182.470 rows=174 loops=1)
  ->  Hash Right Join  (cost=142.30..10712.19 rows=98538 width=32)
Execution Time: 182.903 ms
```

So you store it:

```sql
ALTER TABLE projects ADD COLUMN task_count integer NOT NULL DEFAULT 0;
```

Now the question is how it stays right. There are three answers and they are
genuinely different.

### Option 1 — application code

```ts
await db.transaction(async (tx) => {
  await tx.query("INSERT INTO tasks (project_id, title) VALUES ($1, $2)", [pid, title]);
  await tx.query("UPDATE projects SET task_count = task_count + 1 WHERE id = $1", [pid]);
});
```

**Fragile.** It is correct only if *every* path that touches `tasks` remembers
— including the bulk importer, the CSV job, the cascade delete that removes
tasks when a project is deleted, and the migration someone runs next year. A
`DELETE` that cascades from another table decrements nothing.

Under concurrency it is at least safe if written as `task_count + 1` rather
than read-modify-write in application memory — but `task_count = $newValue`
computed in JavaScript is a lost update waiting to happen.

### Option 2 — a trigger

```sql
CREATE FUNCTION sync_project_task_count() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE projects SET task_count = task_count + 1 WHERE id = NEW.project_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE projects SET task_count = task_count - 1 WHERE id = OLD.project_id;
    ELSIF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
        UPDATE projects SET task_count = task_count - 1 WHERE id = OLD.project_id;
        UPDATE projects SET task_count = task_count + 1 WHERE id = NEW.project_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_maintain_count
    AFTER INSERT OR UPDATE OF project_id OR DELETE ON tasks
    FOR EACH ROW EXECUTE FUNCTION sync_project_task_count();
```

**Reliable but hidden.** It catches every writer, including cascades and raw
SQL. It is also invisible to anyone reading the application code, it runs
inside every write transaction, and it creates the lock contention described
below.

### Option 3 — periodic recalculation

```sql
UPDATE projects p
SET    task_count = c.n
FROM  (SELECT project_id, count(*) AS n FROM tasks GROUP BY project_id) c
WHERE  c.project_id = p.id
AND    p.task_count IS DISTINCT FROM c.n;
```

Run it every ten minutes. **Simple and self-healing** — whatever drifted, from
whatever cause, is corrected on the next run with no investigation.

The count is up to ten minutes stale. For a card in a list, nobody notices. For
a quota check that blocks an action, it is unacceptable.

### Comparing them honestly

| | Application code | Trigger | Periodic recalculation |
|---|---|---|---|
| Catches every writer | No | Yes | Yes (eventually) |
| Visible to app developers | Yes | No | Partly |
| Cost per write | One extra `UPDATE` | One extra `UPDATE`, always | None |
| Accuracy | Exact, until a path is missed | Exact | Stale by the interval |
| Self-healing | No | No | Yes |
| Hot-row lock contention | Yes | Yes | No |
| Debuggability of a wrong value | Hard — which path missed it? | Easy — one place | It fixes itself |

### The concurrency cost of options 1 and 2

Both update the same `projects` row on every task write, so every task creation
in a busy project queues behind the last one.

| Time | Session A (create task) | Session B (create task, same project) |
|---|---|---|
| T1 | `BEGIN;` | |
| T2 | `INSERT INTO tasks ... project_id=42;` | |
| T3 | `UPDATE projects SET task_count = task_count + 1 WHERE id=42;` — takes row lock | |
| T4 | | `BEGIN;` |
| T5 | | `INSERT INTO tasks ... project_id=42;` |
| T6 | | `UPDATE projects SET task_count = ... WHERE id=42;` ⏸ **blocked** |
| T7 | ...calls an external service, 300 ms... | ⏸ still blocked |
| T8 | `COMMIT;` | lock acquired, proceeds |

Session B waited for the whole of Session A's transaction, including work that
had nothing to do with the counter. The contention is proportional to how long
your transactions are, not to how fast the `UPDATE` is. Keep the counter update
**last** in the transaction, and keep the transaction short. See
[../transactions-and-concurrency/04-locks-part-2.md](../transactions-and-concurrency/04-locks-part-2.md).

**Recommendation:** start with **periodic recalculation**. It is the only
option with no write cost, no contention, and no way to be permanently wrong.
Move to a trigger only when staleness is genuinely unacceptable, and when you
do, keep the recalculation job running anyway as a safety net.

---

## Precomputed Aggregates and Summary Tables

Reporting queries scan large amounts of history to produce small answers. The
answer for a finished month never changes, so computing it repeatedly is pure
waste.

```sql
CREATE TABLE company_monthly_revenue (
    company_id    bigint NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    month         date   NOT NULL,
    invoice_count int    NOT NULL,
    total_cents   bigint NOT NULL,
    currency      text   NOT NULL,
    computed_at   timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (company_id, month, currency)
);
```

```sql
-- Nightly: recompute only months that could still change
INSERT INTO company_monthly_revenue
      (company_id, month, currency, invoice_count, total_cents)
SELECT company_id,
       date_trunc('month', issued_at)::date,
       currency,
       count(*),
       sum(amount_cents)
FROM   invoices
WHERE  status = 'paid'
AND    issued_at >= date_trunc('month', now()) - interval '2 months'
GROUP  BY 1, 2, 3
ON CONFLICT (company_id, month, currency) DO UPDATE
SET    invoice_count = EXCLUDED.invoice_count,
       total_cents   = EXCLUDED.total_cents,
       computed_at   = now();
```

Two properties make this a good denormalization: the recompute is **idempotent**
(`ON CONFLICT DO UPDATE` means re-running it is always safe), and it only
touches recent months, so the job stays fast as history grows.

Note `currency` is part of the key — never sum across currencies. See
[06-schema-design-patterns-part-2.md](06-schema-design-patterns-part-2.md#money-and-currency).

---

## Storing a Derived or Formatted Value

Sometimes the copy is not of another table's column but of a **computation**.

```sql
ALTER TABLE users ADD COLUMN search_vector tsvector;

UPDATE users
SET    search_vector = to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(email,''));

CREATE INDEX users_search_idx ON users USING gin (search_vector);
```

This is denormalization: `search_vector` is derivable from `name` and `email`,
and it will be wrong the moment either changes without it.

PostgreSQL offers a way to get the benefit with **no drift risk at all** —
generated columns, which the database recomputes itself:

```sql
ALTER TABLE invoices
    ADD COLUMN amount_major numeric(14,2)
    GENERATED ALWAYS AS (amount_cents / 100.0) STORED;
```

A stored generated column cannot be written to directly and cannot disagree
with its source. When what you want to precompute can be expressed as an
immutable expression over columns of the same row, **use a generated column, not
a denormalized one**. You keep the index and lose the risk.

> **⚠️ Warning:** Storing a *formatted* value — `"£49.00"`, a rendered date, a
> localised label — is almost always wrong. Formatting depends on the viewer's
> locale, currency display rules, and your product's design, all of which change
> more often than the data. Format at the edge, store the value.

---

## Arrays and JSONB as Deliberate Denormalization

Putting a list inside a row is denormalization by another name: it is data that
would otherwise be rows in a child table.

```sql
ALTER TABLE projects ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
CREATE INDEX projects_tags_gin ON projects USING gin (tags);

SELECT id, name FROM projects WHERE tags @> ARRAY['urgent'];
```

What you gain: no join, no second table, and the tags arrive with the row.

What you lose:

- **No foreign key on an element.** An array of `user_id`s can contain a
  deleted user forever, and nothing will tell you.
- **Whole-value rewrite on update.** Adding one tag rewrites the entire array,
  the entire row, and the GIN index entries for it.
- **No per-element attributes.** The moment you need "who added this tag and
  when", you need the join table you avoided.
- **GIN index write cost.** GIN updates are more expensive than B-tree ones,
  though PostgreSQL buffers them with a pending list.

**Rule of thumb:** an array is reasonable for a short, closed list of scalars
with no attributes of its own — tags, feature flags, a handful of labels. The
moment an element needs a foreign key or a column of its own, it is a table.

Full treatment in
[05-postgres-data-types-part-2.md](05-postgres-data-types-part-2.md#arrays).

---

## Common Mistakes

1. **Denormalizing before measuring.** The most common mistake by a wide
   margin.
2. **Updating the copy outside the transaction that updates the source.** A
   crash between them guarantees drift.
3. **Hand-writing a derived column that a generated column could compute.**
   Taking drift risk for nothing.
4. **Storing formatted strings.** Locale and currency display change; the value
   does not.
5. **A counter maintained only in application code**, with cascade deletes
   quietly bypassing it.
6. **Summing a column across mixed currencies** in a summary table.

---

## Questions to Test Yourself

1. State the three conditions that must all be true before you denormalize.
2. Compare the three ways of maintaining a counter on catching every writer,
   visibility to developers, and self-healing.
3. Draw the timeline of two concurrent task creations in the same project with
   a trigger-maintained counter. Where exactly does the second one wait, and
   what determines how long?
4. When can a generated column replace a denormalized column entirely, and what
   do you gain?
5. Give two properties that make the summary-table recompute job safe to
   re-run.
6. An array column and a join table can both model "the tags on a task". Name
   the guarantee the array gives up.

---

> **➡️ Continued in [Part 2](./04-denormalization-and-read-models-part-2.md)**

## Related

- [README](README.md) — the rest of this folder.
- [Part 2](04-denormalization-and-read-models-part-2.md) — the trade-off table,
  how duplicated data drifts, materialized views, caching, read models, and the
  cheaper fixes to try first.
- [Normalization](03-normalization-part-1.md) — the default this file departs
  from.
- [Keys and relationships](01-keys-and-relationships-part-1.md) — the joins
  being avoided here.
- [PostgreSQL data types](05-postgres-data-types-part-2.md) — arrays, `jsonb`
  and generated columns in depth.
- [Schema design patterns](06-schema-design-patterns-part-1.md) — composite
  tenant foreign keys that remove the drift risk entirely.
- [Locks](../transactions-and-concurrency/04-locks-part-2.md) — hot-row contention from
  counters.
- [Reading query plans](../query-planner/reading-query-plans.md) — the evidence
  you need before denormalizing.
