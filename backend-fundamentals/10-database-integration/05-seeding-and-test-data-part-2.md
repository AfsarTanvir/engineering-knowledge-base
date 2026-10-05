# Seeding and Test Data — Part 2: Isolation and Real Data

Part 1 gave you data you can create. This part is about getting rid of it
again — and about the one request that should always make you stop: *"can you
just pull a copy of production down so I can debug this?"*

> **⬅️ This continues [Part 1](05-seeding-and-test-data-part-1.md).**

> **📌 In one line:** every test starts from the same known state and leaves
> nothing behind, tests run in parallel by owning separate databases, and real
> customer data never reaches a laptop — because partial anonymisation is not
> anonymisation.

## Table of Contents

1. [Test Isolation: Three Strategies](#test-isolation-three-strategies)
2. [Transaction per Test, and Its One Limitation](#transaction-per-test-and-its-one-limitation)
3. [Running Tests in Parallel](#running-tests-in-parallel)
4. [Production Data in Development](#production-data-in-development)
5. [What Anonymisation Must Cover](#what-anonymisation-must-cover)
6. [Why Partial Anonymisation Still Identifies People](#why-partial-anonymisation-still-identifies-people)
7. [What to Do Instead](#what-to-do-instead)
8. [Advanced: Schema Drift, Service Layer, and Volume](#advanced-schema-drift-service-layer-and-volume)
9. [Common Mistakes](#common-mistakes)
10. [Questions to Test Yourself](#questions-to-test-yourself)
11. [Related](#related)

---

## Test Isolation: Three Strategies

Two tests share a database. The first creates a project and asserts
`projects.length === 1`. The second creates a project. Now the first fails —
but only when they run in that order, which depends on filenames, which
changes when someone renames a file.

Isolation means: **every test begins from the same known state**, regardless of
what ran before it. There are three real ways to get there.

| Strategy | Mechanism | Cost per test | Reference data | Breaks when |
|---|---|---|---|---|
| **Transaction + rollback** | `BEGIN` before, `ROLLBACK` after | ~1 ms | Seeded once per run, survives | The code opens its own transactions, or runs in another process |
| **Truncation** | `TRUNCATE ... RESTART IDENTITY CASCADE` | ~10–50 ms | Must be re-seeded, or excluded from the truncate list | Rarely — this is the reliable fallback |
| **Recreate the schema** | Drop, migrate, seed | Seconds | Rebuilt every time | Any suite over about twenty tests |

Transaction rollback is the right default. It is one to two orders of magnitude
faster than the alternatives, and the difference compounds: a 600-test suite at
40 ms of cleanup per test spends 24 seconds doing nothing but deleting rows.

Truncation is the correct second choice, and the one you fall back to for the
tests rollback cannot handle.

```sql
-- One statement, all tables, in any order. Far faster than DELETE, and
-- RESTART IDENTITY keeps sequences predictable between runs.
TRUNCATE TABLE tasks, projects, memberships, users, companies
  RESTART IDENTITY CASCADE;
```

Keep reference tables (`roles`, `plans`, `countries`) out of that list and seed
them once when the suite starts. They never change during a test, and
re-seeding them 600 times is pure waste.

Recreating the schema per test is only defensible for a handful of tests that
change the schema themselves — a migration test, for instance.

> **⚠️ Warning:** the fourth approach — `DELETE FROM` each table in
> foreign-key order — looks like truncation but rots. Someone adds a table,
> forgets the list, and a week later a test fails for reasons nobody can trace
> back to the missing line. If you are deleting, truncate everything instead.

## Transaction per Test, and Its One Limitation

The mechanism is simple: open a transaction before the test, hand it to the
code as "the database", and roll it back afterwards. Nothing the test wrote was
ever committed, so cleanup is a single statement no matter how many rows were
inserted.

```ts
// tests/db.ts
import { beforeEach, afterEach } from 'vitest'

beforeEach(async (ctx) => {
  ctx.trx = await db.transaction()
  setCurrentConnection(ctx.trx)   // every repository resolves the connection
})                                // from here, not from a module import

afterEach(async (ctx) => {
  await ctx.trx.rollback()        // every row the test wrote disappears
  setCurrentConnection(db)
})
```

That `setCurrentConnection` line is the part that makes or breaks the approach.
If your repositories `import { db }` directly, there is no way to swap the
connection and the whole strategy is unavailable. If they receive it — through
a container, a request context, or `AsyncLocalStorage` — it is three lines. See
[05-dependency-injection-in-practice.md](../09-application-architecture/05-dependency-injection-in-practice.md)
and [03-repository-layer-part-1.md](../09-application-architecture/03-repository-layer-part-1.md).

Two properties worth knowing. Sequences are **not** transactional: a rolled-back
insert still advances the id counter, so ids climb across your suite and you
must never assert on a literal id. And because nothing commits, anything that
runs `AFTER COMMIT` — a trigger, a listener, an outbox flush — never fires.

**The limitation: code that manages its own transactions.** If the service
under test calls `db.transaction()` itself, it opens a *second*, independent
transaction from a different connection in the pool. That transaction cannot
see the outer one's uncommitted rows, so the service finds no data and the test
fails in a way that looks like a bug in the code. Worse, if both transactions
touch the same rows, they block each other until one times out.

There are two honest resolutions.

```ts
// ✅ The service receives a connection, so its "own" transaction nests
// as a SAVEPOINT inside the test's transaction — which rollback undoes.
async function transferOwnership(conn: Knex, from: string, to: string) {
  await conn.transaction(async (trx) => {     // trx is a SAVEPOINT in tests
    await trx('projects').where({ owner_id: from }).update({ owner_id: to })
    await trx('audit_events').insert({ kind: 'ownership.transferred' })
  })
}
```

Every mainstream query builder turns a nested `transaction()` into a savepoint
automatically — but only if it is given the outer transaction. That is the same
injection requirement as before, which is why the two sections reinforce each
other.

The second resolution: when the test genuinely cares about commit behaviour —
an `AFTER COMMIT` hook, a `LISTEN/NOTIFY` consumer, a real retry-on-deadlock
path, anything spanning two processes — rollback isolation is the wrong tool.
Run those few tests with truncation instead. Most suites end up with 95% of
tests on rollback and a small, explicitly marked group on truncation. For what
those transactions are actually doing, see
[03-transactions-part-1.md](03-transactions-part-1.md).

> **⚠️ Warning:** rollback isolation also fails when the test drives a real HTTP
> server in a separate process. That server has its own pool and cannot see
> your uncommitted transaction. In-process request testing (supertest calling
> the app object directly) is fine.

## Running Tests in Parallel

Parallelism is the largest single speedup available to an integration suite,
and it is unusable if every worker shares one database — worker 1 truncates the
tables while worker 3 is mid-assertion.

The fix is that **each worker owns its own database or schema**. Test runners
expose the worker index, so the connection string is derived, not configured.

```ts
// tests/database-url.ts — Vitest exposes VITEST_WORKER_ID, Jest JEST_WORKER_ID
const worker = process.env.VITEST_WORKER_ID ?? '1'
export const DATABASE_URL =
  `postgres://localhost:5432/app_test_${worker}`
```

| Approach | Setup cost | Isolation | Notes |
|---|---|---|---|
| **Database per worker** | Highest — one migration run each | Complete | Use a **template database**: `CREATE DATABASE app_test_3 TEMPLATE app_test_tpl` copies a fully migrated database in ~100 ms instead of re-running every migration |
| **Schema per worker** | Low — `CREATE SCHEMA`, then `SET search_path` | Complete within one database | Cheaper, and one `max_connections` budget instead of many |
| **Shared database, table prefixes** | Low | Fragile | Every query must know the prefix. Avoid |

Whichever you pick, do the connection arithmetic. Eight workers × a pool of ten
is eighty connections, and PostgreSQL's default `max_connections` is 100 —
which your local app is also using. Set the test pool to 1–2 connections per
worker; a test process is doing one thing at a time anyway. This is the same
calculation as
[04-connection-pooling.md](04-connection-pooling.md).

> **💡 Tip:** build the template database once in CI — migrate it, seed the
> reference data, then clone it per worker. Migration time stops scaling with
> worker count, and a suite that took four minutes to set up takes seconds.

## Production Data in Development

Someone will suggest it, usually under time pressure: *"just restore last
night's production backup locally and you'll see the bug."*

It is the fastest path to the answer, and it is the section of this file that
carries actual legal consequences.

A production database is a file containing every customer's personal data.
Copying it to a laptop means:

- **You have moved personal data outside every control you built.** Production
  has access logs, encryption, network restrictions, and a defined retention
  period. `~/Downloads/prod-dump.sql` has none of those.
- **The copy is permanent and untracked.** Laptops get lost and stolen, sync to
  personal cloud backups, get sold, and get handed to the next employee. Nobody
  will remember that dump in eighteen months, and no inventory lists it.
- **Deletion requests silently fail.** A customer exercises their right to
  erasure. You delete them from production. They still exist on four laptops
  and in a Slack DM, and you have no way to find them. You are now
  non-compliant and cannot prove otherwise.
- **A stolen laptop is a reportable breach.** Under GDPR that is a 72-hour
  notification obligation to a regulator, and often to every affected customer.
  The laptop being encrypted helps; it does not make the question go away.
- **It is usually a contract violation.** Enterprise agreements and SOC 2 / ISO
  27001 controls routinely prohibit production data in non-production
  environments outright. This is not only a legal-team concern; it is a
  standard question on the security review that gates your next big deal.

> **⚠️ Warning:** the risk does not scale with your intentions. A careful
> engineer debugging a real bug creates exactly the same exposure as a careless
> one, because the exposure comes from the *copy existing*, not from what
> anyone does with it.

## What Anonymisation Must Cover

If a dataset is going to leave production, every field that identifies a person
has to be replaced. The list is longer than people expect, and the items at the
bottom are the ones that get missed.

| Category | Examples | Why it is missed |
|---|---|---|
| **Direct identifiers** | Names, emails, usernames, phone numbers | Nobody misses these |
| **Location** | Postal addresses, postcodes, IP addresses, device geo | Postcode is often thought of as harmless |
| **Dates** | Date of birth, precise signup and login timestamps | They look like plumbing, not personal data |
| **Credentials** | Password hashes, API keys, session ids, OAuth refresh tokens, reset tokens | A dump with live tokens is an account-takeover kit |
| **Payment references** | Stripe customer and charge ids, PayPal ids, bank identifiers, card last-4 | These are *live handles* into a real payment account, not just strings |
| **Free text** | Support messages, task descriptions, comments, notes, uploaded file names | Impossible to pattern-match. "Hi, it's Sarah from Acme, call me on…" |
| **Semi-structured** | JSON/JSONB columns, custom fields, webhook payload archives, audit logs | Schemaless, so no column list catches them |
| **Binaries** | Avatars, uploaded PDFs and CSVs, email attachments | Usually in object storage, so the database dump "looks clean" |

Audit logs and webhook archives deserve a specific mention: they are designed
to record exactly who did what, which makes them the densest personal data in
the system and the table nobody remembers to include.

For fields you must keep *consistent* — so joins still work and duplicates
still look like duplicates — use a deterministic pseudonym rather than random
replacement:

```ts
// The same input always maps to the same output, so relationships survive.
const pseudo = (value: string) =>
  createHmac('sha256', SECRET_SALT).update(value).digest('hex').slice(0, 12)
```

> **⚠️ Warning:** that is **pseudonymisation, not anonymisation**. Under GDPR,
> pseudonymised data is still personal data with the full set of obligations
> attached. And it is reversible in practice: the value space of email domains
> or phone numbers is small enough to brute-force, and anyone who obtains the
> salt reverses everything at once.

## Why Partial Anonymisation Still Identifies People

This is the part that surprises people, and it is why "we scrubbed the names
and emails" is not a defence.

Identification does not require a name. It requires a **combination of
attributes that is unique**, and real datasets are full of those.

- **Quasi-identifiers combine.** Company name, job title, and signup week
  identify exactly one person at most B2B customers. The classic result on
  US census data found that postcode, date of birth and gender alone uniquely
  identify a large majority of the population — none of which is a name.
- **Structure survives scrubbing.** The tenant with 400 projects, 150 users and
  an annual invoice on the 3rd of April is recognisably your largest customer
  whatever you rename them to. In a B2B product, "the top account by revenue"
  is uniquely identifying *by construction*.
- **Free text betrays everything.** You renamed the `users.name` column. The
  support thread still says "this is Sarah from Acme, my mobile is 07…", the
  task description still contains a home address, and the uploaded file is
  still called `invoice-acme-ltd-march.pdf`.
- **Foreign keys leak too.** Anonymising the `users` table while leaving
  `audit_events.actor_email` intact accomplishes nothing at all.
- **External data re-links it.** Your anonymised set has company sizes and
  industries; LinkedIn has the rest. Re-identification is a join, and the other
  table is public.

> **📌 Remember:** anonymisation is a property of the *whole dataset*, not of
> individual columns. The only reliable test is adversarial: hand it to someone
> and ask them to name one real customer. They usually can, in minutes.

## What to Do Instead

Three options, in order of preference.

**1. Synthetic data at production scale.** Generate the data with the factories
and seeds from Part 1, but match production's *shape* rather than its values:
a few enormous tenants, a long tail of tiny ones, realistic text lengths,
realistic null rates, realistic skew. This is almost always the right answer,
because most bugs that "need production data" actually need production
*distribution* — the account with 40,000 tasks, the row with a 60 KB
description, the tenant whose name contains an emoji. None of that requires a
real person. Keep a `db:seed:large` command that builds it.

**2. An anonymised subset, generated by an automated, reviewed process.** When
you genuinely need production structure, the pipeline that produces it is
*code in the repository*: it selects a small consistent slice (a handful of
tenants and everything that hangs off them), applies the transformation rules
above, runs in a locked-down environment with audit logging, and is
code-reviewed like any other change. Never a script someone runs by hand,
never ad hoc, never "I'll just scrub it in psql". Add an automated check that
fails the pipeline if any recognisable pattern — an `@` outside
`@example.test`, an E.164 phone number, a `cus_` Stripe id — survives.

**3. Read-only production access, with audit, for looking rather than
copying.** Sometimes you need to see one real row. Looking at it through an
audited, time-limited, approval-gated session is a completely different act
from taking a copy: it leaves a record, it expires, and it creates no artefact.

> **💡 Tip:** the real fix is organisational. "Can I get a copy of prod?"
> should hit a documented process with a named owner, not one engineer's
> judgement at 6 PM on a Friday. Write it down before you need it.

## Advanced: Schema Drift, Service Layer, and Volume

**Keeping seeds working as the schema evolves.** Migrations are frozen at the
moment they were written; seeds are not. A seed always runs against the
*current* schema, so a migration adding a `NOT NULL` column breaks every seed
that does not set it. The only thing that stops this rot is CI: run the full
`db:reset` — migrate, reference-seed, development-seed — on every pull request.
It takes a minute and it catches the breakage in the PR that caused it, rather
than on a new joiner's first morning three weeks later.

**Seeding through the service layer vs direct inserts.**

| | Through the service layer | Direct inserts |
|---|---|---|
| Validity | Business rules, defaults, derived fields and events all applied | You can write rows the application could never produce |
| Speed | Slow: validation, hashing, events, one entity at a time | Fast: one bulk statement |
| Coupling | Follows refactors automatically | Silently drifts from the real write path |
| Hazard | May send email, charge a card, or enqueue jobs | May violate an invariant the code assumes holds |
| Use for | Development seeds, where realism is the point | Test factories and large volumes, where speed is |

A useful middle ground: factories insert directly, and *one* integration test
creates the same entity through the real service and asserts the two rows have
the same shape. That single test catches the drift that would otherwise make
your entire suite green against data the application cannot create.

**Generating large volumes efficiently.** A loop of single inserts is a round
trip per row; 100,000 of them takes minutes.

```ts
// ❌ BROKEN — 100,000 round trips, each with its own implicit transaction
for (const t of tasks) await db('tasks').insert(t)

// ✅ FIXED — multi-row inserts, batched, in one transaction
await db.transaction(async (trx) => {
  for (const batch of chunk(tasks, 2_000)) await trx('tasks').insert(batch)
})
```

Batch size 1,000–5,000 is the usual sweet spot; beyond that the statement gets
large enough to hurt. For the largest seeds, `COPY` beats multi-row `INSERT`
substantially, and building indexes *after* the load rather than before is
worth real minutes. All of that is covered properly in
[bulk-write-performance.md](../../databases/query-patterns/bulk-write-performance.md).

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Tests sharing state through the database | They pass in one order and fail in another | Transaction rollback, or truncation |
| `DELETE FROM` each table in FK order | Someone adds a table and forgets the list | `TRUNCATE ... RESTART IDENTITY CASCADE` |
| Recreating the schema per test | Seconds each; a suite becomes unrunnable | Roll back a transaction instead |
| Repositories that `import { db }` | The connection cannot be swapped, so rollback isolation is impossible | Inject the connection |
| Asserting on a literal row id | Sequences are not transactional and keep climbing | Assert on the returned object |
| Expecting `AFTER COMMIT` work inside a rolled-back test | Nothing commits, so nothing fires | Run those few tests with truncation |
| Parallel workers sharing one database | One worker truncates while another asserts | A database or schema per worker |
| Ignoring `max_connections` when parallelising | Workers × pool size exhausts the server | 1–2 connections per test worker |
| Copying production to a laptop | Untracked permanent personal data outside every control; a stolen laptop is a reportable breach | Synthetic data, or a reviewed anonymisation pipeline |
| Scrubbing names and emails and calling it anonymous | Quasi-identifiers, free text and structure re-identify people | Treat the whole dataset, and test adversarially |
| Leaving tokens or Stripe ids in a "sanitised" dump | Those are live handles into real accounts | Replace every credential and payment reference |
| A hand-run anonymisation script | Unreviewed, unrepeatable, and it will miss a column | An automated pipeline in the repo, with a leak check |
| Seeds only run locally | They break silently and are discovered by a new joiner | Run `db:reset` in CI on every PR |

## Questions to Test Yourself

1. Test A asserts `projects.length === 1` and passes alone but fails in the
   suite. Name the property that is missing and two mechanisms that restore it.
2. Why is transaction rollback one to two orders of magnitude faster than
   truncation? Compute the difference over a 600-test suite at 40 ms each.
3. Explain precisely why rollback isolation fails when the code under test
   calls `db.transaction()` itself, and describe both valid fixes.
4. What does a nested `transaction()` become inside an open transaction, and
   what must be true of your code for that to happen?
5. Your test asserts that a row has `id === 1` and fails on the second run.
   Explain the mechanism.
6. Name two kinds of test for which rollback isolation is the wrong tool, and
   say what you use instead.
7. Eight parallel workers each open a pool of ten connections. What goes wrong,
   and what are the two ways to fix it?
8. What is a PostgreSQL template database and why does it change the cost
   calculation for database-per-worker?
9. A colleague says "I anonymised the dump — I replaced all the names and
   emails". Give three distinct ways a real customer can still be identified.
10. Why is a deterministic HMAC pseudonym still personal data under GDPR, and
    what makes it reversible in practice?
11. A customer exercises their right to erasure. Explain why laptop copies of
    production make that request impossible to satisfy honestly.
12. Give two reasons factories insert directly rather than going through the
    service layer, and the one test that protects you from that choice.

## Related

- [Part 1](05-seeding-and-test-data-part-1.md) — seeds, factories, fixtures,
  idempotent reference data and determinism.
- [03-transactions-part-1.md](03-transactions-part-1.md) — what the rollback
  strategy is actually doing, and what savepoints are.
- [04-connection-pooling.md](04-connection-pooling.md) — the connection
  arithmetic that parallel test workers have to respect.
- [05-dependency-injection-in-practice.md](../09-application-architecture/05-dependency-injection-in-practice.md)
  — injecting the connection, which is what makes rollback isolation possible.
- [03-repository-layer-part-1.md](../09-application-architecture/03-repository-layer-part-1.md)
  — the layer that must receive its connection rather than import it.
- [bulk-write-performance.md](../../databases/query-patterns/bulk-write-performance.md)
  — batching, `COPY`, and index timing for large seeds.
- [04-test-data-and-mocking-part-2.md](../13-testing-and-quality/04-test-data-and-mocking-part-2.md)
  — the testing-strategy side: when a real database is worth it at all, and why
  mocking your own is not a shortcut.
