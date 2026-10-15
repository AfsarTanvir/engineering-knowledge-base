# PostgreSQL Data Types That Change Your Design — Part 1

Choosing `text` over `varchar(255)` is a detail. Choosing `timestamp` over
`timestamptz` is a decision you will still be paying for in three years, when a
customer in Auckland reports that their nightly report runs at the wrong hour
twice a year and nobody can reproduce it.

This file is about the second kind of choice.

> **📌 In one line:** A handful of PostgreSQL types — `timestamptz`, `numeric`,
> `jsonb`, arrays, ranges — decide the shape of your schema, not just the shape
> of a column.

The basic catalogue — integers, text, booleans, what a type even is — is in
[../fundamentals/02-tables-rows-and-data-types-part-1.md](../fundamentals/02-tables-rows-and-data-types-part-1.md)
and is not repeated here.

This part covers the two that cause the most expensive bugs: time and money.
Part 2 covers the types that change the *shape* of a schema.

## Table of Contents

1. [Time, Done Properly](#time-done-properly)
2. [Money: numeric vs float vs integer cents](#money-numeric-vs-float-vs-integer-cents)
3. [Common Mistakes](#common-mistakes)
4. [Questions to Test Yourself](#questions-to-test-yourself)
5. [Related](#related)

---

## Time, Done Properly

This causes more production bugs than every other type combined, and the
confusion is almost always the same one.

### What `timestamptz` actually stores

Both types are 8 bytes. Neither stores a time zone.

- **`timestamp`** (`timestamp without time zone`) stores a wall-clock reading:
  "2026-03-29 02:30". It does not say where. It is a number on a clock face,
  and there is no way to know what moment in history it refers to.
- **`timestamptz`** (`timestamp with time zone`) stores an **absolute instant** —
  a point on the universal timeline, internally as microseconds from an epoch
  in UTC.

> **⚠️ Warning:** The name `timestamp with time zone` is actively misleading.
> **No time zone is stored.** What the "with time zone" means is that the value
> is *converted* on the way in and on the way out, using the session's
> `TimeZone` setting.

```sql
SET TimeZone = 'Asia/Dhaka';                    -- UTC+6

CREATE TABLE tz_demo (
    naive   timestamp,
    instant timestamptz
);

INSERT INTO tz_demo VALUES ('2026-03-29 14:00', '2026-03-29 14:00');

SELECT * FROM tz_demo;
```
```text
        naive        |        instant
---------------------+------------------------
 2026-03-29 14:00:00 | 2026-03-29 14:00:00+06
```

Now read the same rows as a colleague in London:

```sql
SET TimeZone = 'Europe/London';
SELECT * FROM tz_demo;
```
```text
        naive        |        instant
---------------------+------------------------
 2026-03-29 14:00:00 | 2026-03-29 09:00:00+01
```

The `timestamptz` correctly says "the same instant, which for you was 09:00".
The `timestamp` still says 14:00 — and it is now impossible to say whether that
meant 14:00 in Dhaka, in London, or anywhere else.

**Use `timestamptz` for everything that is a moment in time.** Creation times,
login times, payment times, when a notification was read. There is no case
where `timestamp` is the safer default.

The genuine exceptions for `timestamp` are rare and specific: a store's opening
hours ("we open at 09:00 local, wherever that store is"), or an alarm clock
that should ring at 07:00 no matter what zone the user flies to.

### `AT TIME ZONE`

This operator converts, and it works in both directions:

```sql
-- Instant -> local wall clock in a named zone (returns timestamp)
SELECT created_at AT TIME ZONE 'Asia/Dhaka' AS local_time
FROM   invoices WHERE id = 1;

-- Local wall clock -> instant, interpreting it in that zone (returns timestamptz)
SELECT timestamp '2026-06-01 09:00' AT TIME ZONE 'Asia/Dhaka';
```
```text
      timezone
------------------------
 2026-06-01 03:00:00+00
```

The rule to remember: `AT TIME ZONE` applied to a `timestamptz` gives you a
`timestamp`, and applied to a `timestamp` gives you a `timestamptz`. It always
swaps.

Grouping a report by the customer's local day needs it:

```sql
SELECT date_trunc('day', issued_at AT TIME ZONE 'Asia/Dhaka') AS local_day,
       sum(amount_cents)
FROM   invoices
WHERE  company_id = 7
GROUP  BY 1
ORDER  BY 1;
```

Without the conversion, you group by UTC days, and a customer in Dhaka sees
their evening sales land on tomorrow's row.

### Store the user's zone separately

An instant is not enough to reconstruct what a person saw on their clock, and
it is not enough to schedule something in their future local time. Store the
zone as data:

```sql
ALTER TABLE users
    ADD COLUMN time_zone text NOT NULL DEFAULT 'UTC';

ALTER TABLE users
    ADD CONSTRAINT users_time_zone_valid
    CHECK (now() AT TIME ZONE time_zone IS NOT NULL);
```

That `CHECK` is a neat trick: the conversion raises an error for an invalid
zone name, so the constraint rejects `'Asia/Dahka'` at write time rather than
at report time.

Store the **IANA name** (`Asia/Dhaka`, `Europe/London`), never an offset like
`+06:00`. An offset is a fact about one moment; a zone name is a rule that
knows about daylight saving and about the law changing.

### `date` vs `timestamptz`

| Use `date` when | Use `timestamptz` when |
|---|---|
| A birthday — it is the 4th of July everywhere | A payment — it happened at one instant |
| A due date the user picked on a calendar | A deadline at a specific moment |
| A billing period boundary | A login |
| An invoice's accounting date | A row's `created_at` |

A birthday stored as `timestamptz` becomes the previous day for anyone west of
you, which is how people receive birthday emails a day early. `tasks.due_date`
in the shared schema is a `date` for exactly this reason: "due Friday" is a
calendar fact, not an instant.

### `interval`

An `interval` is a duration, and it has a subtlety: it is stored as **months,
days, and microseconds separately**, because those units are not
interchangeable.

```sql
SELECT interval '1 month' = interval '30 days';
```
```text
 ?column?
----------
 t
```

PostgreSQL treats a month as 30 days for *comparison*, but not for
*arithmetic*:

```sql
SELECT date '2026-01-31' + interval '1 month' AS plus_month,
       date '2026-01-31' + interval '30 days' AS plus_30d;
```
```text
     plus_month      |      plus_30d
---------------------+---------------------
 2026-02-28 00:00:00 | 2026-03-02 00:00:00
```

For billing periods this matters enormously. "One month after 31 January" is
28 February — which is what a customer expects, and why you should add
`interval '1 month'` rather than 30 days.

### The worked example: a reminder that fires an hour late twice a year

A user in London sets a daily reminder for 09:00. You store the next fire time
as a `timestamptz` and, after each run, add 24 hours.

```sql
CREATE TABLE reminders (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    next_fire_at timestamptz NOT NULL
);

INSERT INTO reminders (user_id, next_fire_at)
VALUES (31, timestamp '2026-03-28 09:00' AT TIME ZONE 'Europe/London');
```
```text
 next_fire_at: 2026-03-28 09:00:00+00   (stored as 09:00 UTC)
```

```sql
-- ❌ BROKEN — the worker advances by a fixed duration
UPDATE reminders
SET    next_fire_at = next_fire_at + interval '24 hours'
WHERE  id = 1;
```
```text
 next_fire_at: 2026-03-29 09:00:00+00
```

On 29 March 2026 London moves to BST (UTC+1). 09:00 UTC is now **10:00 local**.
The user's 09:00 reminder arrives at 10:00, every day, for seven months. Then
in October it silently corrects itself and drifts the other way.

The bug is that "every day at 09:00" is a statement about **local wall clock**,
and you stored and advanced an **absolute instant**. Adding 24 hours to an
instant is not "the same time tomorrow" in any zone that observes daylight
saving.

```sql
-- ✅ FIXED — store the local intent, compute the instant each time
CREATE TABLE reminders (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    local_time  time   NOT NULL,        -- what the user asked for: 09:00
    time_zone   text   NOT NULL,        -- the zone that gives it meaning
    next_fire_at timestamptz NOT NULL   -- derived, recomputed after each run
);

-- Recompute from the local intent, in the user's zone
UPDATE reminders
SET    next_fire_at =
         ((next_fire_at AT TIME ZONE time_zone)::date
           + interval '1 day' + local_time) AT TIME ZONE time_zone
WHERE  id = 1;
```

Now the conversion happens on each computation, so it picks up the new offset.
The reminder fires at 09:00 local on both sides of the transition.

> **📌 Remember:** Store what the user meant (`09:00` + `Europe/London`), and
> derive the instant. An instant alone has thrown away the information you need
> to be right next March.

The mirror-image trap is the autumn transition, where 01:30 local happens
**twice**. `AT TIME ZONE` picks one; if you need to distinguish them, you need
the instant, which is why you keep both columns.

---

## Money: numeric vs float vs integer cents

### Never floating point

`real` and `double precision` are binary floating point. They cannot represent
0.1 exactly, in the same way decimal cannot represent one third exactly.

```sql
SELECT 0.1::float8 + 0.2::float8 AS sum,
       (0.1::float8 + 0.2::float8) = 0.3::float8 AS equals_point_three;
```
```text
        sum         | equals_point_three
--------------------+--------------------
 0.30000000000000004| f
```

Across ten thousand invoice lines those fractions accumulate into an amount
your finance team can see, and the ledger will not balance.

### `numeric` — exact decimal arithmetic

```sql
ALTER TABLE invoices ADD COLUMN tax_rate numeric(5,4);   -- e.g. 0.2000
```

`numeric(p, s)` stores digits in decimal, so `0.1 + 0.2` is exactly `0.3`. It
is variable length, slower than integer arithmetic, and every operation on it
is done in software rather than by the CPU.

Always give the precision and scale. A bare `numeric` accepts any number of
decimal places, so `19.999999` slips in and rounds differently in two places.

### Integer minor units — what the shared schema uses

```sql
amount_cents bigint NOT NULL
```

Store 4900 for £49.00. Arithmetic is plain 64-bit integer arithmetic: exact,
fast, and impossible to get a rounding surprise from.

| | `double precision` | `numeric(14,2)` | `bigint` cents |
|---|---|---|---|
| Exact | **No** | Yes | Yes |
| Speed | Fastest | Slowest | Fast |
| Size | 8 bytes | Variable, ~10 bytes | 8 bytes |
| Sums correctly over millions of rows | No | Yes | Yes |
| Handles sub-cent (tax rates, FX) | Yes | Yes | No — needs a separate scaled column |
| Risk of a unit mistake | Low | Low | **Real** — someone will treat cents as pounds |
| Recommended for | Never for money | Rates, multipliers, unit prices needing sub-cent | Stored amounts and balances |

**Recommendation:** `bigint` minor units for amounts, `numeric` for rates and
any intermediate that genuinely needs sub-cent precision, and never floating
point. Put the unit in the column name — `amount_cents`, never `amount` — so
the mistake is visible in every query.

### Getting money to JavaScript without corrupting it

This is the part that bites on the way out.

JavaScript's `number` is a double. It can hold integers exactly only up to
`Number.MAX_SAFE_INTEGER` (about 9.007 × 10^15). That is comfortably enough for
any realistic `amount_cents` — but **not** for a `bigint` primary key, and not
for a `numeric` with many digits.

Postgres drivers know this, which produces a different surprise: `node-postgres`
returns `bigint` and `numeric` as **strings** by default, precisely so nothing
is lost.

```ts
const { rows } = await db.query("SELECT id, amount_cents FROM invoices WHERE id = 1");
console.log(rows[0]);
// { id: '1', amount_cents: '4900' }   <- strings, not numbers
```

So the classic bug:

```ts
// ❌ BROKEN — string concatenation, silently
const total = rows.reduce((sum, r) => sum + r.amount_cents, 0);
// "04900490001200"
```

`+` on a string and a number produces a string, with no error at all. See
[../../typescript-fundamentals/equality-and-coercion/equality-and-coercion.md](../../typescript-fundamentals/equality-and-coercion/equality-and-coercion.md)
for exactly why.

```ts
// ✅ FIXED — convert explicitly at the boundary, keep minor units as integers
type InvoiceRow = { id: string; amount_cents: string };

const total = rows.reduce((sum, r) => sum + Number(r.amount_cents), 0);
// 4900 + 4900 + 1200 = 11000   (safe: cents fit well inside MAX_SAFE_INTEGER)
```

For a `numeric` that may exceed safe-integer range, do the arithmetic in the
database (`SUM(amount_cents)`) or use a decimal library. Keep `bigint` ids as
strings all the way to the client — an id is a label, not a number, and
`Number('9007199254740993')` quietly loses the last digit.

---

## Common Mistakes

1. **`timestamp` instead of `timestamptz`.** The single most expensive type
   mistake available.
2. **Believing `timestamptz` stores a time zone.** It stores an instant.
3. **Storing an offset (`+06:00`) instead of an IANA zone name.**
4. **Advancing a recurring schedule by `interval '24 hours'`.** Wrong for seven
   months of the year in any DST zone.
5. **`float` for money.** Sums that do not balance.
6. **`amount` instead of `amount_cents`.** Someone will treat it as pounds.
7. **Adding `bigint` values returned as strings by the driver.** String
   concatenation with no error.

---

## Questions to Test Yourself

1. What does `timestamptz` actually store, and why is its name misleading?
2. Two colleagues in different zones select the same `timestamp` column and see
   the same text. Why is that a problem?
3. `AT TIME ZONE` applied to a `timestamptz` returns what type? And applied to a
   `timestamp`?
4. Why is `tasks.due_date` a `date` rather than a `timestamptz`?
5. Explain why a daily reminder stored as an instant and advanced by 24 hours
   fires an hour late for seven months. What do you store instead?
6. Why is `date '2026-01-31' + interval '1 month'` not the same as `+ interval
   '30 days'`, and which one do you want for billing?
7. Give three reasons not to use `double precision` for money, and say when
   `numeric` is still needed alongside integer cents.
8. Why does `node-postgres` return `bigint` as a string, and what bug does that
   cause in a `reduce`?

---

> **➡️ Continued in [Part 2](./05-postgres-data-types-part-2.md)**

## Related

- [README](README.md) — the rest of this folder.
- [Part 2](05-postgres-data-types-part-2.md) — `jsonb`, arrays, `uuid`, ranges,
  enums, text and collation, and the network and binary types.
- [Tables, rows, and data types](../fundamentals/02-tables-rows-and-data-types-part-1.md)
  — the basic type catalogue this file builds on.
- [Schema design patterns](06-schema-design-patterns-part-2.md) — money and
  currency as a schema decision, and audit timestamp columns.
- [Constraints and data integrity](02-constraints-and-data-integrity-part-1.md)
  — the `CHECK` constraints that keep an amount non-negative.
- [Equality and coercion](../../typescript-fundamentals/equality-and-coercion/equality-and-coercion.md)
  — why adding a string to a number is silent.
