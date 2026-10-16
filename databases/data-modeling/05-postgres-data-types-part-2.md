# PostgreSQL Data Types That Change Your Design — Part 2

Part 1 covered time and money. This part covers the types that change the
*shape* of a schema rather than the precision of one column.

> **⬅️ This continues [Part 1](./05-postgres-data-types-part-1.md).**

> **📌 In one line:** `jsonb`, arrays and ranges let one column hold what would
> otherwise be a whole table — sometimes exactly right, and the rest of the
> time a way of not deciding the schema.

## Table of Contents

1. [jsonb](#jsonb)
2. [Arrays](#arrays)
3. [uuid](#uuid)
4. [Range Types](#range-types)
5. [Enum Types](#enum-types)
6. [Text and Collation](#text-and-collation)
7. [Network Types and Binary Data](#network-types-and-binary-data)
8. [Advanced: Domains, Composite Types, Extensions](#advanced-domains-composite-types-extensions)
9. [Common Mistakes](#common-mistakes)
10. [Questions to Test Yourself](#questions-to-test-yourself)
11. [Related](#related)

---

## jsonb

### `json` vs `jsonb`

| | `json` | `jsonb` |
|---|---|---|
| Stored as | The original text, verbatim | A parsed binary tree |
| Preserves key order and whitespace | Yes | No |
| Duplicate keys | Kept | Last one wins |
| Write cost | Cheaper — just validate | Parse and normalise |
| Read / operator cost | Reparse every access | Direct |
| Indexable | Barely | Yes — GIN |

**Use `jsonb` unless you are storing a document you must return byte-identical**
(a signed webhook body you have to verify later). Everything else: `jsonb`.

### Operators worth knowing

```sql
ALTER TABLE notifications ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb;

-- -> returns jsonb, ->> returns text
SELECT payload -> 'task',           -- {"id": 42, "title": "Fix login"}
       payload -> 'task' ->> 'title' -- Fix login
FROM   notifications WHERE id = 1;

-- #> and #>> take a path
SELECT payload #>> '{task,title}' FROM notifications WHERE id = 1;

-- @> containment: does the left contain the right?
SELECT * FROM notifications WHERE payload @> '{"task": {"id": 42}}';

-- ? key existence
SELECT * FROM notifications WHERE payload ? 'invoice';
```

Containment (`@>`) is the important one, because it is what the default GIN
index accelerates.

### GIN indexing

```sql
-- Default: supports @>, ?, ?&, ?|
CREATE INDEX notifications_payload_gin ON notifications USING gin (payload);

-- jsonb_path_ops: smaller and faster, but ONLY supports @>
CREATE INDEX notifications_payload_gin ON notifications
    USING gin (payload jsonb_path_ops);
```

A GIN index does **not** help `payload ->> 'status' = 'pending'`. For a single
key you query often, an expression B-tree index is much better:

```sql
CREATE INDEX notifications_payload_status_idx
    ON notifications ((payload ->> 'status'));
```

But notice what you have done: you have promoted a JSON key to a first-class
indexed field. At that point, ask honestly why it is not a column.

### When `jsonb` is right, and when it is avoidance

| Situation | `jsonb`? | Why |
|---|---|---|
| Third-party webhook payload you must keep | **Yes** | You do not control its shape and it changes without notice |
| Analytics event properties, one row per event type | **Yes** | Genuinely open-ended, never joined |
| User-defined custom fields in a form builder | **Yes** | The schema is your users' data, not yours |
| A settings blob read and written whole | **Yes** | No querying, no constraints needed |
| "We are not sure what fields we need yet" | **No** | You will know in two weeks and never migrate |
| Status, amount, due date — things you filter on | **No** | These want indexes, constraints and types |
| A foreign key to another table | **No** | There is no such thing as a JSON foreign key |
| Anything you will `ORDER BY` | **No** | Casting on every row, no usable statistics |

### The honest costs

- **No constraints.** `NOT NULL`, `CHECK`, `UNIQUE` and foreign keys do not
  apply to keys inside a document. You can bolt on
  `CHECK (payload ? 'task_id')`, but there is no type enforcement and no
  referential integrity — a `task_id` pointing at a deleted task stays forever.
- **No statistics, so bad plans.** The planner has no idea how many rows have
  `payload->>'status' = 'pending'`. It guesses, and a wrong guess produces a
  nested loop over a million rows.
- **Whole-value rewrite on update.** Changing one key rewrites the entire
  document and the whole row version. A large document updated frequently
  produces a lot of dead data for `VACUUM`.
- **TOAST.** A `jsonb` value over roughly 2 kB is compressed and moved to an
  out-of-line TOAST table, so reading it is an extra fetch. Large documents in
  a hot table are a quiet source of I/O.
- **Awkward queries.** Every access needs casting, and `NULL` versus JSON
  `null` versus missing key are three different things.

> **⚠️ Warning:** The `jsonb` column that starts as "just some extra metadata"
> becomes the column the whole product depends on. Then someone needs to report
> on it, and there are three spellings of the same key because nothing ever
> validated it.

If you use `jsonb`, validate its shape in the application on write (see
[../../backend-fundamentals/04-validation-and-input/02-schema-validation.md](../../backend-fundamentals/04-validation-and-input/02-schema-validation.md))
and promote any key you filter on to a real column as soon as you know you need
it.

---

## Arrays

Any PostgreSQL type can be an array.

```sql
ALTER TABLE projects ADD COLUMN tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX projects_tags_gin ON projects USING gin (tags);

SELECT id, name FROM projects WHERE tags @> ARRAY['urgent'];     -- contains
SELECT id, name FROM projects WHERE tags && ARRAY['urgent','q3']; -- overlaps
```

| | `text[]` array | Join table |
|---|---|---|
| Read with the parent row | Free | A join |
| Foreign key per element | **Impossible** | Yes |
| Attributes per element (`added_at`, `added_by`) | No | Yes |
| Add one element | Rewrites the whole array and row | One `INSERT` |
| Count usage across all rows | `unnest` + aggregate | `GROUP BY` |
| Enforce a vocabulary | `CHECK` with `<@` | Foreign key to a lookup table |
| Good for | Short, closed lists of scalars | Everything else |

The limitation that decides it: **you cannot put a foreign key on an array
element.** `member_ids bigint[]` will happily contain the id of a user deleted
two years ago, and nothing in the database will ever object. If the elements
identify rows in another table, use a join table.

You can still enforce a vocabulary:

```sql
ALTER TABLE projects
    ADD CONSTRAINT projects_tags_known
    CHECK (tags <@ ARRAY['urgent','q3','internal','customer','blocked']);
```

---

## uuid

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- if gen_random_uuid() is unavailable

ALTER TABLE users
    ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE users
    ADD CONSTRAINT users_public_id_unique UNIQUE (public_id);
```

The `uuid` type is 16 bytes, stored in binary — not the 36-character text form.
Storing a UUID in a `text` column costs 37 bytes and makes comparisons string
comparisons. Always use the `uuid` type.

`gen_random_uuid()` produces a **random** v4 UUID, with the index-locality
problem described in
[01-keys-and-relationships-part-1.md](01-keys-and-relationships-part-1.md#choosing-the-surrogate-key-type-bigint-vs-uuid-vs-ulid).
Recent PostgreSQL versions add a time-ordered v7 generator; check whether yours
has it before assuming. Where it is absent, generate UUIDv7 or ULID in the
application.

The key-choice discussion — when a UUID is the right primary key at all — is in
file 01 and is not repeated here.

---

## Range Types

A range is a single value holding a lower bound, an upper bound, and whether
each is inclusive.

```sql
SELECT tstzrange('2026-01-01', '2026-07-01', '[)') AS period;
```

Built-in ranges include `int4range`, `numrange`, `daterange`, `tsrange` and
`tstzrange`. The operators that matter: `@>` (contains), `&&` (overlaps), `-|-`
(adjacent).

```sql
CREATE TABLE subscriptions (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint    NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
    plan       text      NOT NULL,
    period     tstzrange NOT NULL
);

-- Which plan was company 7 on last Christmas?
SELECT plan FROM subscriptions
WHERE  company_id = 7
AND    period @> timestamptz '2025-12-25 00:00+00';
```

That query replaces the awkward `starts_at <= $1 AND (ends_at IS NULL OR
ends_at > $1)` that every billing system ends up with, and it handles the open-
ended case natively (`tstzrange('2026-01-01', NULL)` has no upper bound).

The real payoff is pairing a range with an `EXCLUDE` constraint so overlapping
periods are structurally impossible:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_no_overlap
    EXCLUDE USING gist (company_id WITH =, period WITH &&);
```

Full treatment in
[02-constraints-and-data-integrity-part-2.md](02-constraints-and-data-integrity-part-2.md#exclude-preventing-overlaps).

> **💡 Tip:** Use `'[)'` bounds for time — inclusive start, exclusive end. It is
> what makes a period ending at 10:00 not overlap one starting at 10:00, and it
> makes adjacent periods join cleanly with no one-microsecond gap.

---

## Enum Types

```sql
CREATE TYPE invoice_status AS ENUM ('draft', 'issued', 'paid', 'void');
```

Four bytes per row, sorted in declaration order, and type-checked. The
operational costs — cannot remove a value, cannot reorder without recreating
the type, `ALTER TYPE ... ADD VALUE` having transaction restrictions that vary
by version — plus the full comparison against `CHECK` constraints and lookup
tables, are in
[02-constraints-and-data-integrity-part-2.md](02-constraints-and-data-integrity-part-2.md#enum-values-three-ways).

The short version: prefer a `text` column with a `CHECK` constraint, or a
lookup table when the values need attributes. Reach for an `enum` type only for
a genuinely closed set on a very large table.

---

## Text and Collation

### `text` vs `varchar(n)` vs `char(n)`

In PostgreSQL, `text` and `varchar` are **the same implementation**. `varchar(n)`
adds a length check and nothing else — no storage saving, no speed difference.
`char(n)` pads with spaces and is a compatibility relic.

**Use `text`,** and enforce length with a `CHECK` if you need one:

```sql
ALTER TABLE projects
    ADD CONSTRAINT projects_name_length CHECK (char_length(name) BETWEEN 1 AND 200);
```

Why `CHECK` rather than `varchar(200)`? Changing a `CHECK` is
`ADD ... NOT VALID` then `VALIDATE`, which does not block writes. Historically,
shrinking a `varchar(n)` required a full table rewrite under an exclusive lock.
(Growing it is cheap in recent versions; shrinking still is not.)

MySQL differs here: `VARCHAR(n)` and `TEXT` are genuinely different types with
different storage and indexing rules, so this advice does not carry across.

### Case-insensitive comparison

Three options, in order of preference:

```sql
-- 1. Functional index on LOWER() — explicit, standard, works everywhere
CREATE UNIQUE INDEX users_email_lower_unique ON users (LOWER(email));
SELECT * FROM users WHERE LOWER(email) = LOWER($1);

-- 2. citext extension — the column itself compares case-insensitively
CREATE EXTENSION IF NOT EXISTS citext;
ALTER TABLE users ALTER COLUMN email TYPE citext;

-- 3. A non-deterministic ICU collation — most flexible, most surprising
CREATE COLLATION case_insensitive (
    provider = icu, locale = 'und-u-ks-level2', deterministic = false
);
```

Option 1 is recommended: the behaviour is visible in the query and in the
index, not hidden in the column's type. Option 3 is powerful but
non-deterministic collations disable some optimisations and interact badly with
pattern matching — know what you are doing before choosing it.

### Why collation breaks `LIKE 'prefix%'`

This one catches people badly.

A B-tree index stores values in **collation order**. `LIKE 'acme%'` can use an
index only if the planner can rewrite it into a range scan — `email >= 'acme'
AND email < 'acmf'`. That rewrite is only valid when the collation sorts
strings byte-by-byte, which is true for `C` and `POSIX` but **not** for locale
collations like `en_US.UTF-8`, where `'a'` and `'A'` and accented letters
interleave.

So on a database created with a locale collation, a plain index does not serve
`LIKE 'prefix%'`:

```text
Seq Scan on users  (cost=0.00..4821.00 rows=12 width=48)
                   (actual time=0.09..38.7 rows=12 loops=1)
  Filter: (email ~~ 'acme%'::text)
  Rows Removed by Filter: 199988
```

The fix is a **text pattern operator class**, which indexes for exactly this:

```sql
CREATE INDEX users_email_pattern_idx ON users (email text_pattern_ops);
```

```text
Index Scan using users_email_pattern_idx on users
  (cost=0.42..8.61 rows=12 width=48) (actual time=0.02..0.03 rows=12 loops=1)
  Index Cond: ((email ~>=~ 'acme'::text) AND (email ~<~ 'acmf'::text))
```

`text_pattern_ops` compares byte-by-byte regardless of the database collation,
which is exactly what prefix matching needs. The trade-off is that this index
serves `LIKE 'x%'` but not `ORDER BY email` in collation order — so you may
want both indexes.

More on operator classes and index types in
[../query-optimization/index-types-deep-dive.md](../query-optimization/index-types-deep-dive.md).

> **📌 Remember:** `LIKE '%suffix'` and `LIKE '%middle%'` cannot use a B-tree
> at all, in any collation. Those need a trigram (`pg_trgm`) GIN index or full-
> text search.

---

## Network Types and Binary Data

### Network types

```sql
ALTER TABLE users ADD COLUMN last_login_ip inet;

SELECT * FROM users WHERE last_login_ip << inet '10.0.0.0/8';
```

`inet` holds an IPv4 or IPv6 address (optionally with a netmask), `cidr` holds
a network, and `macaddr` a hardware address. They validate on input, store
compactly, and support subnet operators like `<<` (is contained within). A
`text` column does none of that, and sorts `10.0.0.9` after `10.0.0.100`.

### `bytea` vs object storage

`bytea` stores arbitrary bytes. You *can* put a PDF in it. You should not.

| | `bytea` in PostgreSQL | Object storage (S3 and similar) |
|---|---|---|
| Backup size and time | Grows with every file, forever | Database backups stay small |
| Replication traffic | Every byte crosses to every replica | None |
| Memory pressure | Competes with your working set in shared buffers | None |
| Serving to a browser | Through your app, using a connection per download | A signed URL, direct |
| Cost per GB | Expensive (fast provisioned storage) | Cheap |
| Transactional with the row | **Yes** — the one real advantage | No |

**Recommendation: store files in object storage and keep only the key in the
database.**

```sql
CREATE TABLE attachments (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_id      bigint      NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    storage_key  text        NOT NULL,          -- 'attachments/2026/05/ab12....pdf'
    file_name    text        NOT NULL,
    content_type text        NOT NULL,
    size_bytes   bigint      NOT NULL CHECK (size_bytes > 0),
    checksum     bytea,                          -- small, and genuinely useful here
    uploaded_by  bigint      REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT attachments_storage_key_unique UNIQUE (storage_key)
);
CREATE INDEX attachments_task_idx ON attachments (task_id);
```

`bytea` is right for genuinely small binary values: a checksum, an encryption
nonce, a small thumbnail under a few kilobytes.

Upload flows, signed URLs, and the orphaned-object problem that this design
creates are covered in
[../../backend-fundamentals/12-files-and-integrations/01-file-uploads-part-1.md](../../backend-fundamentals/12-files-and-integrations/01-file-uploads-part-1.md).

---

## Advanced: Domains, Composite Types, Extensions

### Domains — a reusable constrained type

```sql
CREATE DOMAIN email_address AS text
    CHECK (VALUE ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

CREATE DOMAIN cents AS bigint CHECK (VALUE >= 0);

ALTER TABLE users    ALTER COLUMN email        TYPE email_address;
ALTER TABLE invoices ALTER COLUMN amount_cents TYPE cents;
```

The rule is written once and applies everywhere the domain is used, including
in tables written next year by someone who never read this file. The catch is
that changing a domain's constraint validates every table using it, so keep
domain rules loose and structural — do not encode business policy in them.

### Composite types

```sql
CREATE TYPE money_amount AS (cents bigint, currency text);
```

Useful as a function return type or for structuring PL/pgSQL. As a **column**
type they are usually a mistake: you cannot index a field of a composite
directly in a natural way, and most drivers surface them poorly. Two plain
columns are almost always better.

### Extension types

- **`citext`** — case-insensitive text (see above).
- **`pg_trgm`** — trigram similarity, and the GIN index that makes
  `LIKE '%middle%'` and fuzzy matching usable.
- **`hstore`** — flat key-value. Predates `jsonb` and is superseded by it.
- **`ltree`** — hierarchical labels, a built-in path-enumeration tree with
  proper indexing.
- **PostGIS** — geographic types (`geometry`, `geography`) with spatial
  indexing. Large, excellent, and a whole subject of its own.

Extensions must be installed on the server, which matters on managed hosting —
check what your provider allows before designing around one.

---

## Common Mistakes

1. **`jsonb` as a way of not deciding the schema.** No constraints, no
   statistics, bad plans.
2. **An array of ids that should be a join table.** No foreign key, ever.
3. **`varchar(255)` out of habit**, then needing to shrink it under an
   exclusive lock.
4. **Expecting a plain index to serve `LIKE 'prefix%'`** on a locale-collated
   database.
5. **Files in `bytea`.** Backups, replication and memory all pay for it.

---

## Questions to Test Yourself

1. Name four concrete costs of putting a queryable field inside a `jsonb`
   column instead of making it a real column.
2. What single limitation decides between an array column and a join table?
3. Why does `LIKE 'acme%'` not use a plain B-tree index on a locale-collated
   database, and what fixes it?
4. Give four reasons to keep files in object storage rather than `bytea`, and
   one case where `bytea` is right.

---

## Related

- [README](README.md) — the rest of this folder.
- [Part 1](05-postgres-data-types-part-1.md) — time and money.
- [Normalization](03-normalization-part-2.md) — variant data in `jsonb` or in
  tables.
- [Denormalization and read models](04-denormalization-and-read-models-part-1.md)
  — arrays and `jsonb` as deliberate denormalization.
- [Constraints and data integrity](02-constraints-and-data-integrity-part-2.md)
  — `EXCLUDE` with range types, and the enum comparison.
- [Index types deep dive](../query-optimization/index-types-deep-dive.md) — GIN,
  GiST, and the operator classes these types need.
