# Tables, Rows and Data Types — Part 1

Choosing a column type feels like a small decision. It is not. The type you
pick decides whether invoice totals are correct, whether a timestamp still
means the right thing after a daylight-saving change, how much disk a billion
rows take, and which indexes are even possible.

Most data-quality bugs in real systems were created on the day the table was
written, by someone typing `float` or `varchar(255)` without thinking about it.

> **📌 In one line:** the column type is the first and cheapest constraint you
> will ever add — get it right at `CREATE TABLE` time, because changing it
> later on a big table is an outage-shaped problem.

## Table of Contents

1. [CREATE TABLE, Line by Line](#create-table-line-by-line)
2. [The Type Reference](#the-type-reference)
3. [BROKEN vs FIXED: Money in a Float](#broken-vs-fixed-money-in-a-float)
4. [Time Zones: timestamp vs timestamptz](#time-zones-timestamp-vs-timestamptz)
5. [varchar(n) vs text vs char(n)](#varcharn-vs-text-vs-charn)
6. [Common Mistakes](#common-mistakes)
7. [Questions to Test Yourself](#questions-to-test-yourself)
8. [Related](#related)

---

## CREATE TABLE, Line by Line

Here is `companies` from the shared SaaS schema, with every piece explained.

```sql
CREATE TABLE companies (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       text        NOT NULL,
    plan       text        NOT NULL DEFAULT 'free',
    created_at timestamptz NOT NULL DEFAULT now()
);
```

| Piece | What it does |
|---|---|
| `CREATE TABLE companies` | Creates the table in the current schema (normally `public`) |
| `id bigint` | A 64-bit integer column |
| `GENERATED ALWAYS AS IDENTITY` | PostgreSQL fills this in from a sequence; you are not allowed to supply it by accident |
| `PRIMARY KEY` | Unique **and** `NOT NULL`, and creates a unique index automatically |
| `name text NOT NULL` | Free-length text; the row is rejected if `name` is missing |
| `DEFAULT 'free'` | If you do not mention `plan` on insert, it becomes `'free'` |
| `timestamptz` | A point in time, stored as an absolute instant (see below) |
| `DEFAULT now()` | The transaction's start time is filled in automatically |

Now `users`, which adds the relationship and two more constraint types:

```sql
CREATE TABLE users (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint      NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    email      citext      NOT NULL UNIQUE,
    name       text        NOT NULL,
    role       text        NOT NULL DEFAULT 'member'
                           CHECK (role IN ('owner', 'admin', 'member')),
    created_at timestamptz NOT NULL DEFAULT now()
);
```

- `REFERENCES companies (id)` — a **foreign key**. The database now refuses any
  `company_id` that does not exist, and refuses to delete a company that still
  has users, unless you tell it what to do instead.
- `ON DELETE CASCADE` — that instruction: deleting a company deletes its users.
  Use this deliberately; it is a loaded gun on tables you care about.
- `UNIQUE` — no two users share an email.
- `CHECK (...)` — a rule evaluated on every insert and update.
- `citext` — a case-insensitive text type from the `citext` extension
  (`CREATE EXTENSION citext;`). Worth it for email, because
  `Ana@Acme.com` and `ana@acme.com` are the same person. Without it, use
  `text` and store a lowercased value.

> **💡 Tip:** a constraint is a rule the database enforces even when your
> application has a bug, a script runs by hand, or a second service writes to
> the same table. Application-level validation does not replace it.

---

## The Type Reference

The PostgreSQL types actually worth knowing. Sizes are for the value itself;
see the storage section for the per-row overhead.

| Type | Stores | Size | Use it when |
|---|---|---|---|
| `smallint` | −32,768 → 32,767 | 2 bytes | Tiny bounded counters; rarely worth it |
| `integer` / `int` | ±2.1 billion | 4 bytes | Counts, quantities, most IDs in small systems |
| `bigint` | ±9.2 quintillion | 8 bytes | **Primary keys**, money in minor units, anything that might grow |
| `numeric(p, s)` | Exact decimal, arbitrary precision | variable, ~8+ bytes | **Money**, tax rates, anything where a cent must be a cent |
| `real` | Approximate float | 4 bytes | Sensor readings, scores where tiny error is fine |
| `double precision` | Approximate float | 8 bytes | Scientific values, geometry, averages |
| `text` | Any length string | 1–4 bytes + data | **Default choice for all strings** |
| `varchar(n)` | String, max `n` characters | same as `text` | Only when a real external limit exists |
| `char(n)` | Blank-padded fixed length | same as `text` | Almost never |
| `boolean` | `true` / `false` / `NULL` | 1 byte | Flags |
| `date` | A calendar date, no time | 4 bytes | Birthdays, due dates, invoice periods |
| `timestamp` | Date + time, **no zone** | 8 bytes | Rarely — see the warning below |
| `timestamptz` | An absolute instant | 8 bytes | **Every event time**: `created_at`, `paid_at` |
| `interval` | A length of time | 16 bytes | `'30 days'`, `'1 hour'` arithmetic |
| `uuid` | A 128-bit identifier | 16 bytes | Public IDs, IDs generated by clients |
| `jsonb` | Parsed, binary JSON | variable | Flexible blobs, webhook payloads, settings |
| `json` | Raw JSON text | variable | Almost never — use `jsonb` |
| `type[]` | An array of any type | variable | Small fixed lists like tags, with care |
| `enum` | One of a fixed named set | 4 bytes | Stable value sets; see the caveat |
| `bytea` | Raw bytes | variable | Small binaries; large files belong in object storage |
| `inet` / `cidr` | IP addresses and ranges | 7–19 bytes | Audit logs, allow-lists |

A few notes that save arguments:

- **`jsonb` vs `json`.** `jsonb` parses once on write, stores a binary form,
  supports indexing (`GIN`) and operators, and drops key ordering and
  duplicates. `json` stores the literal text and re-parses on every access. Use
  `jsonb` unless you must reproduce the original text byte for byte.
- **`enum` caveat.** A PostgreSQL enum is fast and small, but adding a value is
  a schema change, and removing one is painful. A `text` column with a `CHECK`
  constraint, or a small lookup table, is more flexible. For `tasks.status`,
  either is defensible — just decide on purpose.
- **Arrays caveat.** `tags text[]` is convenient, but you cannot foreign-key
  into an array, and querying it well needs a GIN index. If the list is really
  another entity, make it another table.
- **`uuid` vs `bigint` keys.** `bigint` identity keys are smaller, sort
  naturally, and keep indexes compact. Random UUIDs (v4) scatter inserts across
  the index and make it bigger. Use `bigint` internally; if you need an
  unguessable public identifier, add a separate `public_id uuid` column.

---

## BROKEN vs FIXED: Money in a Float

This is the single most damaging type mistake, and it is easy to demonstrate.

```sql
-- ❌ BROKEN — amounts stored as double precision.
CREATE TABLE invoices (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint NOT NULL REFERENCES companies (id),
    amount     double precision NOT NULL,   -- money as a float
    status     text NOT NULL DEFAULT 'draft',
    issued_at  timestamptz NOT NULL DEFAULT now(),
    paid_at    timestamptz
);
```

Floating point cannot represent `0.1` exactly, for the same reason base 10
cannot represent one third exactly. Watch:

```sql
SELECT 0.1::double precision + 0.2::double precision AS total;
```

```text
        total
----------------------
  0.30000000000000004
(1 row)
```

```sql
SELECT (0.1::double precision + 0.2::double precision) = 0.3 AS is_equal;
```

```text
 is_equal
----------
 f
(1 row)
```

Now scale it to an invoice with 1,000 line items of 0.10 each:

```sql
SELECT sum(x) AS total
FROM generate_series(1, 1000) AS g,
     LATERAL (SELECT 0.1::double precision AS x) s;
```

```text
        total
----------------------
   99.99999999999859
(1 row)
```

The invoice should say 100.00. It says 99.99999999999859, which rounds to 100.00
on the screen and to 99.99 in a report that truncates. Payments reconcile
one cent short, and nobody can find where the cent went.

```sql
-- ✅ FIXED — integer minor units. amount_cents is the shared-schema column.
CREATE TABLE invoices (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id   bigint NOT NULL REFERENCES companies (id),
    amount_cents bigint NOT NULL CHECK (amount_cents >= 0),  -- 100.00 -> 10000
    currency     char(3) NOT NULL DEFAULT 'USD',
    status       text NOT NULL DEFAULT 'draft',
    issued_at    timestamptz NOT NULL DEFAULT now(),
    paid_at      timestamptz
);
```

```sql
SELECT sum(1000 * 10) AS total_cents;   -- 1000 line items of 10 cents
```

```text
 total_cents
-------------
       10000
(1 row)
```

Exactly 10000 cents. Always.

**The two correct options:**

| Option | How | Best for |
|---|---|---|
| **Integer minor units** | `amount_cents bigint` — store 10000 for 100.00 | Systems that only ever deal in whole cents. Fastest, smallest, no surprises |
| **`numeric`** | `amount numeric(14, 2)` — exact decimal | Tax rates, currencies with more than 2 decimals, or when SQL-side arithmetic must read naturally |

`numeric` is exact but slower than integers, because it is arbitrary-precision
arithmetic in software rather than a CPU instruction. That cost is irrelevant
next to a wrong total.

> **⚠️ Warning:** `real` and `double precision` are correct types — for physics,
> not for money. The rule is simple: **if a human will compare the number to a
> bank statement, it must not be a float.**

---

## Time Zones: timestamp vs timestamptz

The names are actively misleading, so here is what each one really does.

| Type | Full name | What it stores | Time zone stored? |
|---|---|---|---|
| `timestamp` | `timestamp without time zone` | Wall-clock digits: "2026-03-29 02:30" | **No** |
| `timestamptz` | `timestamp with time zone` | An absolute instant on the universal timeline | **No — but it does not need one** |

Neither type stores a time zone. The difference is what the number *means*:

- `timestamp` is a set of digits with no anchor. "2026-03-29 02:30" — in whose
  clock? Unknown. It is a note on a wall, not a moment.
- `timestamptz` is an absolute instant. On input, PostgreSQL converts the value
  you give it into UTC using the zone you supplied (or the session's
  `TimeZone`). On output, it converts back into the session's zone.

```sql
SET TimeZone = 'UTC';
CREATE TEMP TABLE t (naive timestamp, exact timestamptz);
INSERT INTO t VALUES ('2026-06-01 09:00+02', '2026-06-01 09:00+02');

SELECT * FROM t;
```

```text
        naive        |         exact
---------------------+------------------------
 2026-06-01 09:00:00 | 2026-06-01 07:00:00+00
```

The `timestamptz` column understood that 09:00 in `+02` **is** 07:00 UTC. The
`timestamp` column threw the `+02` away and kept the digits. The information is
gone; nothing can recover it later.

Now read the same rows from a session in Dhaka:

```sql
SET TimeZone = 'Asia/Dhaka';
SELECT * FROM t;
```

```text
        naive        |         exact
---------------------+------------------------
 2026-06-01 09:00:00 | 2026-06-01 13:00:00+06
```

`timestamptz` renders the same instant in local terms. `timestamp` still shows
the same digits, which are now wrong for every reader.

### The daylight-saving bug

Europe/London moves its clocks forward on the last Sunday of March. The local
times between 01:00 and 02:00 **do not exist** that day.

```sql
-- A reminder stored as local wall-clock time
INSERT INTO reminders (run_at) VALUES ('2026-03-29 01:30');  -- timestamp
```

That instant never occurs. A scheduler comparing `run_at <= localtime` either
skips the job entirely or fires it twice, depending on how it rounds. In
October the reverse happens: 01:30 occurs twice, and a job scheduled with a
naive timestamp runs twice.

> **📌 Remember the rule:** store **`timestamptz`** for anything that *happened*
> — `created_at`, `paid_at`, `read_at`, log lines, audit rows. Store plain
> `date` for calendar concepts with no instant, such as `tasks.due_date` or an
> invoice period. Store `timestamp` only for a genuine wall-clock intention
> ("the meeting is at 09:00 local, whatever UTC that turns out to be") — and
> then store the zone name in a separate `text` column, because the type does
> not.

Practical operational advice: run your servers and database in UTC
(`SET TimeZone = 'UTC'`), store `timestamptz`, and convert to the user's zone in
the last layer before display. `AT TIME ZONE` does the conversion in SQL when
you need it for grouping:

```sql
SELECT date_trunc('day', issued_at AT TIME ZONE 'Asia/Dhaka') AS local_day,
       count(*)
FROM invoices
GROUP BY local_day
ORDER BY local_day;
```

MySQL differs here: its `TIMESTAMP` type converts to UTC like `timestamptz` but
is limited to a range ending in 2038, while `DATETIME` is the naive one. The
PostgreSQL advice does not transfer directly.

---

## varchar(n) vs text vs char(n)

In PostgreSQL these three are the *same underlying storage*. There is no
performance difference between `text` and `varchar(n)`. The only difference is a
length check.

| Type | Behaviour |
|---|---|
| `text` | Any length. No check |
| `varchar(n)` | Rejects strings longer than `n` characters |
| `varchar` (no `n`) | Identical to `text` |
| `char(n)` | Pads with spaces to exactly `n` characters |

The honest assessment of `varchar(n)`:

- It does **not** save space. Storage is the same.
- It does **not** make queries faster.
- The number is nearly always invented. `varchar(255)` is a MySQL-era
  convention about index prefixes, not a business rule.
- It *does* create a future migration. The day a real name needs 260
  characters, you need `ALTER TABLE`, in production, coordinated with a deploy.

Use `varchar(n)` only when the limit is a genuine external fact — a country code
is two characters, a currency code is three. For everything else use `text`,
and put real validation in the application and a `CHECK` constraint if it
matters:

```sql
name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200)
```

A `CHECK` is easier to change than a type, and expresses an intention rather
than a guess.

### The char(n) padding surprise

```sql
CREATE TEMP TABLE c (code char(5), t text);
INSERT INTO c VALUES ('ab', 'ab');

SELECT length(code) AS char_len,
       length(t)    AS text_len,
       code || '|'  AS shown
FROM c;
```

```text
 char_len | text_len | shown
----------+----------+--------
        2 |        2 | ab   |
```

`length()` reports 2 because trailing spaces are ignored in comparisons — but
concatenation shows `ab   |`, with the padding included. That inconsistency
leaks into string building, hashing, and any client that reads the raw value.
Avoid `char(n)`.

---

> **➡️ Continued in [Part 2](./02-tables-rows-and-data-types-part-2.md)**

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Money in `float` / `double precision` | Binary floats cannot represent 0.10; totals drift | `bigint` minor units, or `numeric(14,2)` |
| `timestamp` for event times | Loses the offset; breaks across zones and DST | `timestamptz`, servers in UTC |
| `varchar(255)` everywhere | An invented limit with no benefit in PostgreSQL | `text` plus a `CHECK` if a real limit exists |
| `char(n)` for codes | Silent space padding leaks into concatenation and hashes | `text` or `varchar(n)` |

---

## Questions to Test Yourself

1. Show, with one SQL expression, why money must not be a `double precision`.
   Then give the two correct alternatives and when you would pick each.
2. What exactly does `timestamptz` store? Name the thing it does *not* store
   that its name implies.
3. Describe the daylight-saving bug that a naive `timestamp` causes in a
   scheduler, in both the spring and autumn direction.
4. In PostgreSQL, what is the real difference between `text` and `varchar(100)`?
   What does the `100` buy you, and what does it cost?
5. Read the `companies` definition line by line and say what each clause
   guarantees — which ones the database enforces and which are only defaults.
6. For each of these, name the type you would declare: a monetary total, an
   event timestamp, a country code, a feature-flag payload, an external UUID.

---

## Related

- [Part 2](./02-tables-rows-and-data-types-part-2.md) — NULL semantics,
  defaults, identity columns, schema change and row storage.
- [What Is a Relational Database](01-what-is-a-relational-database.md) — the
  tables and schema vocabulary this file builds on.
- [SQL Basics: CRUD](03-sql-basics-crud-part-1.md) — putting rows into these tables and
  getting them back.
- [index-types-deep-dive](../query-optimization/index-types-deep-dive.md) —
  which index each type supports, including `jsonb` and arrays.
