# Seeding and Test Data — Part 1: Seeds and Factories

A new developer joins on Monday. They clone the repo, install dependencies,
run the migrations from file 2, and start the app. It boots perfectly.

Then they open it, and there is nothing there. No account to log in with. No
roles, so the permission checks throw. No company, so every page is a redirect
loop. They ask in chat, and someone sends them a SQL dump from six months ago
that no longer matches the schema, along with the phrase *"just ask me for a
password reset link"*.

Meanwhile the test suite passes on their machine and fails in CI, because two
tests both assumed there was exactly one project in the database.

Both problems have the same cause: **the data is not part of the repository**.
Part 1 fixes that for environments and for tests. Part 2 covers keeping tests
isolated from each other, and the one question that carries real legal weight —
what to do when someone suggests copying production to a laptop.

> **📌 In one line:** the schema comes from migrations, the data comes from
> seeds and factories, and both live in the repo — so any environment can be
> rebuilt from scratch by one command, every time, identically.

## Table of Contents

1. [An Empty Database and a Stale Dump](#an-empty-database-and-a-stale-dump)
2. [Seeds vs Factories vs Fixtures](#seeds-vs-factories-vs-fixtures)
3. [Reference Seeds: What Every Environment Needs](#reference-seeds-what-every-environment-needs)
4. [Development Seeds: A Realistic Playground](#development-seeds-a-realistic-playground)
5. [Factories: Only the Fields the Test Cares About](#factories-only-the-fields-the-test-cares-about)
6. [Relationships Without Building the Whole Graph](#relationships-without-building-the-whole-graph)
7. [Determinism: Seeded Randomness and a Frozen Clock](#determinism-seeded-randomness-and-a-frozen-clock)
8. [Common Mistakes](#common-mistakes)
9. [Questions to Test Yourself](#questions-to-test-yourself)
10. [Related](#related)

---

## An Empty Database and a Stale Dump

Two goals, and they are separate enough that people routinely solve one and
forget the other.

**A new developer should be productive in one command.** `npm run db:reset`
should drop the database, run every migration, load the reference data, and
build a realistic demo company they can log into. Not a wiki page with eleven
steps. Not a dump file in a shared drive. One command, in the repo, reviewed
like code, updated by whoever changes the schema.

**A test must not depend on whatever happens to be in the database.** A test
that passes only because someone once created a project called "Acme" is not a
test — it is a coincidence with an assertion attached. Every test must create
exactly the rows it needs and leave nothing behind for the next one.

The stale dump fails both. It drifts from the schema within weeks, it is
invisible to code review, and — this is the part people discover late — if it
came from production, it is a copy of your customers' personal data sitting on
a laptop. Part 2 is about why that sentence matters more than it sounds.

## Seeds vs Factories vs Fixtures

Three words that get used interchangeably and should not be.

| | **Seed** | **Factory** | **Fixture** |
|---|---|---|---|
| What it is | A script that populates a database | A function that builds one object | A static, checked-in blob of data |
| Runs when | On demand: setup, deploy, `db:reset` | Inside a test, hundreds of times | Loaded before a test, or read from disk |
| Scope | The whole environment | One row or one small graph | One known scenario |
| Amount of data | Large — a working playground | Tiny — one record per call | Fixed |
| Varies per call | No | Yes, via overrides | No |
| Good for | Reference data, demo environments | Unit and integration tests | A specific payload: a webhook body, a CSV, a PDF |
| Fails when | Used to set up individual tests | Used to populate a dev environment | Used for anything with relationships |

The practical rule: **seeds set up an environment, factories set up a test,
fixtures represent an external artefact you did not generate.**

The most common mistake is using seeds for tests. It looks efficient — one
setup, many tests — and it produces a suite where tests pass in one order and
fail in another, where nobody can read a test without opening the seed file to
find out what data exists, and where changing one seed row breaks forty tests
that never mentioned it.

> **💡 Tip:** a good fixture is something you genuinely received from outside:
> a real Stripe webhook payload, a customer's malformed CSV upload, a sample
> PDF. If you *invented* the data, it probably wants to be a factory call.

## Reference Seeds: What Every Environment Needs

Some rows are not data — they are part of the application. Roles, permissions,
subscription plans, countries, currencies, task statuses, feature flags,
webhook event types. The code refers to them by name and breaks without them.

These must exist in **every** environment, production included. That makes them
different from everything else in this file, and it imposes one hard
requirement: **running them twice must be safe**. They run on every deploy, on
every developer's reset, in CI, and occasionally twice by accident.

```ts
// ❌ BROKEN — run it twice and you have eight roles
await db('roles').insert(ROLES)

// ❌ ALSO BROKEN — "clear then insert" violates every foreign key pointing
// at these rows, and in production that is every user's role assignment
await db('roles').del()
await db('roles').insert(ROLES)
```

An **upsert** — insert, or update if the row already exists — is the fix. The
conflict target must be a **natural key** (`roles.key`), never the surrogate
`id`, or you tie every environment to the same autoincrement values.

```ts
// database/seeders/reference/01-roles.ts
const ROLES = [
  { key: 'owner',  name: 'Owner',  rank: 100 },
  { key: 'admin',  name: 'Admin',  rank: 80 },
  { key: 'member', name: 'Member', rank: 50 },
  { key: 'viewer', name: 'Viewer', rank: 10 },
] as const

export async function seedRoles(db: Knex) {
  // ✅ Requires a UNIQUE constraint on roles.key — add it in a migration.
  await db('roles')
    .insert(ROLES.map((r) => ({ ...r, updated_at: db.fn.now() })))
    .onConflict('key')
    .merge(['name', 'rank', 'updated_at']) // update these, never touch id
}
```

Run reference seeds as a deploy step, right after migrations, in the same place
and with the same care — see
[02-migrations-part-1.md](02-migrations-part-1.md). They are idempotent, so
rerunning a failed deploy is safe.

> **⚠️ Warning:** removing a row from the `ROLES` array does **not** remove it
> from any database. Reference data is only ever added or updated by a seed.
> *Retiring* a plan or a role is a migration — you have to decide what happens
> to the production rows that still point at it, and a seed file has no way to
> express that decision.

The same shape works for anything keyed naturally. Countries conflict on ISO
code, plans on a slug, permissions on `resource + action`. Keep each reference
seed in its own file, numbered so dependencies run in order (permissions before
the roles that reference them).

## Development Seeds: A Realistic Playground

Reference seeds make the app *work*. Development seeds make it *usable* — a
world you can click around in the moment the server starts.

A good development seed builds one believable company:

- A demo company, `Acme Ltd`, with a known id.
- One user per role, with predictable credentials
  (`owner@acme.test` / `password`) that are written in the README.
- A second company with a different owner, so you notice immediately when a
  query forgets its `company_id` filter.
- Projects in every state: active, archived, empty, one with a long name that
  breaks the sidebar.
- Tasks assigned, unassigned, overdue, completed.
- Invoices paid, unpaid, overdue, refunded — one of each, so every badge colour
  in the UI is visible without anyone constructing it by hand.

```ts
// database/seeders/development/demo-company.ts
export async function seedDemoCompany(db: Knex) {
  // A guard rail worth the three lines. Development seeds create fake users
  // with known passwords; one of them landing in production is an incident.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('refusing to run development seeds in production')
  }
  const company = await createCompany(db, { name: 'Acme Ltd', slug: 'acme' })

  for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
    await createUser(db, {
      company_id: company.id,
      email: `${role}@acme.test`,
      role,
      password_hash: await hash('password'), // documented in the README
    })
  }
  await createProjectsWithTasks(db, company.id, { projects: 400, tasksEach: 50 })
}
```

Those last numbers are the part people skip, and they matter more than the
variety. **A page that looks fine with 5 rows can be unusable with 5,000.**

| Entity | Toy seed | Realistic seed | What only the realistic one reveals |
|---|---|---|---|
| Companies | 1 | 20 | Queries missing a `company_id` filter — a tenant data leak |
| Users per company | 3 | 150 | The assignee dropdown that loads every user, unpaginated |
| Projects | 2 | 400 | The missing index on `projects.company_id` |
| Tasks per project | 5 | 2,000 | N+1 on the assignee, and a 4 MB JSON response |
| Invoices | 0 | 3,000 | The monthly report that takes 40 seconds |

With the toy numbers every one of those bugs ships, and is found by a customer.
With realistic numbers they are found on a laptop, on day one of the feature,
by the person who wrote it. Seeding at volume is the cheapest performance
testing that exists — and the queries it exposes are exactly the ones covered
in [n-plus-one-queries.md](../../databases/query-optimization/n-plus-one-queries.md)
and [pagination-performance.md](../../databases/query-optimization/pagination-performance.md).

> **💡 Tip:** use a reserved TLD for fake email addresses. `@example.test` and
> `@acme.test` can never be routed, so a seed that accidentally triggers your
> mailer cannot email a real person.

## Factories: Only the Fields the Test Cares About

A test should read as a sentence about behaviour. Compare:

```ts
// ❌ BEFORE — which field is this test actually about?
const [user] = await db('users').insert({
  email: 'a@b.com', name: 'A', role: 'admin', company_id: 1,
  password_hash: '$2b$10$...', email_verified_at: new Date(),
  timezone: 'UTC', locale: 'en', status: 'active',
  created_at: new Date(), updated_at: new Date(),
}).returning('*')

// ✅ AFTER — the one field under test is the only field written down
const user = await createUser({ role: 'admin' })
```

The second version is not merely shorter. It is *honest*: it says the test
depends on `role` and on nothing else. When someone later adds a `NOT NULL`
column, the first version breaks in ninety test files and the second breaks in
one factory.

A factory is a function with sensible defaults and an overrides parameter. In
TypeScript, one generic type covers all of them:

```ts
// tests/factories/types.ts
export type Factory<T> = (overrides?: Partial<T>) => T
```

`Partial<T>` is what makes the override object optional field by field, so
`createUser({ role: 'admin' })` type-checks while `createUser({ rol: 'admin' })`
does not. See
[generics](../../typescript-fundamentals/generics/generics.md) for why the
constraint belongs on the factory rather than on each call site.

```ts
// tests/factories/user.ts
import { faker } from '@faker-js/faker'

let seq = 0
const nextSeq = () => ++seq

// build* returns an unsaved object. Pure, synchronous, no database.
export const buildUser: Factory<NewUser> = (overrides = {}) => ({
  email: `user-${nextSeq()}@example.test`, // a counter, so it is always unique
  name: faker.person.fullName(),
  role: 'member',
  status: 'active',
  password_hash: STATIC_BCRYPT_HASH,   // never hash in a factory: 80ms each
  email_verified_at: FIXED_NOW,
  created_at: FIXED_NOW,
  ...overrides,                        // last, so overrides always win
})

// create* persists it. Most tests want this one.
export async function createUser(overrides: Partial<NewUser> = {}) {
  const [row] = await db('users').insert(buildUser(overrides)).returning('*')
  return row as User
}
```

Four details in there are worth copying:

- **`build` and `create` are separate.** Pure unit tests want an object without
  touching the database; integration tests want a row. Splitting them keeps the
  defaults in one place.
- **Uniqueness comes from a counter, not randomness.** `faker.internet.email()`
  will eventually collide with your `UNIQUE` index, and it will do so in CI, on
  a Friday, in one run out of two hundred.
- **The spread goes last.** Put `...overrides` first and the defaults silently
  win — a bug that produces tests which pass while asserting nothing.
- **Expensive work is faked.** A real bcrypt hash costs ~80 ms; a suite
  creating 500 users spends 40 seconds hashing passwords nobody checks.

For repeated variations, add named helpers rather than repeating override
objects: `createAdmin()`, `createOverdueInvoice()`, `createArchivedProject()`.
They are one line each and they name the *scenario*, which is what the test is
really about.

## Relationships Without Building the Whole Graph

A task needs a project, which needs a company, which needs an owner. Written
naively, every test that touches a task builds four rows by hand — and when the
graph gains a fifth level, every test changes.

The fix is **lazy parents**: a factory creates its parent only if one was not
supplied.

```ts
export async function createProject(overrides: Partial<NewProject> = {}) {
  const company_id = overrides.company_id ?? (await createCompany()).id
  const [row] = await db('projects')
    .insert(buildProject({ ...overrides, company_id })).returning('*')
  return row as Project
}

export async function createTask(overrides: Partial<NewTask> = {}) {
  const project_id = overrides.project_id ?? (await createProject()).id
  const [row] = await db('tasks')
    .insert(buildTask({ ...overrides, project_id })).returning('*')
  return row as Task
}
```

Now a test that does not care about the hierarchy writes one line:

```ts
const task = await createTask({ status: 'done' })       // builds 3 rows for you
```

And a test that *does* care is explicit about it, and shares the parent:

```ts
const company = await createCompany()
const project = await createProject({ company_id: company.id })
const [a, b] = await Promise.all([
  createTask({ project_id: project.id, status: 'done' }),
  createTask({ project_id: project.id, status: 'open' }),
])
```

Two rules keep this from getting slow. **Never create more than the assertion
touches** — if a test checks invoice totals, it does not need 200 tasks
attached to the project. And **pass ids down, never whole objects**, so a
factory never has to decide whether the parent it was handed is already saved.

> **⚠️ Warning:** a factory that always creates its parents *and* fills every
> optional relation will build an entire object graph per test. A suite of 600
> tests doing that spends most of its runtime on `INSERT`s nobody asserts on.
> Defaults should be the minimum row the constraints allow.

## Determinism: Seeded Randomness and a Frozen Clock

Random data finds bugs you did not think of. It also produces the worst failure
mode in testing: a test that fails once in fifty runs, on a machine you do not
have, with data you cannot reconstruct.

Both are true at once, and the resolution is to keep the randomness and make it
**reproducible**. Seed the generator from an environment variable, and print
the seed.

```ts
// tests/setup.ts
import { faker } from '@faker-js/faker'

const seed = Number(process.env.TEST_SEED ?? Math.floor(Math.random() * 1e6))
faker.seed(seed)
console.log(`test seed: ${seed}`)   // CI logs this on every run
```

Now a CI failure prints `test seed: 48213`, and `TEST_SEED=48213 npm test`
reproduces it exactly on your laptop. You keep the bug-finding property of
random data and lose the "cannot reproduce" property entirely.

The second source of flakiness is the clock. `new Date()` in a fixture makes
the test's meaning depend on when it runs.

```ts
// ❌ BROKEN — passes all day, fails at 23:59:59, and again on the 31st,
// and again for the teammate whose machine is not on UTC
const invoice = await createInvoice({ due_at: new Date() })
expect(isOverdue(invoice)).toBe(false)
```

Use fixed instants for data, and let the code read "now" from something you can
replace:

```ts
// ✅ FIXED — every timestamp is a constant, and "now" is injected
const NOW = new Date('2026-03-11T12:00:00Z')

const invoice = await createInvoice({ due_at: new Date('2026-03-20T00:00:00Z') })
expect(isOverdue(invoice, { now: () => NOW })).toBe(false)

const late = await createInvoice({ due_at: new Date('2026-03-01T00:00:00Z') })
expect(isOverdue(late, { now: () => NOW })).toBe(true)   // now testable at all
```

A `Clock` dependency is the cleanest version of this — the service takes a
`now()` function, production passes `Date.now`, tests pass a fixed instant.
That is exactly the pattern in
[05-dependency-injection-in-practice.md](../09-application-architecture/05-dependency-injection-in-practice.md).
Fake timers work too, but they are global state: they change behaviour for
every library in the process, including your database driver's timeouts.

> **💡 Tip:** relative offsets are fine as long as the *origin* is fixed:
> `daysFrom(NOW, -3)` is deterministic and readable, `daysAgo(3)` is not.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| A SQL dump shared in chat as "the dev data" | Drifts from the schema, invisible to review, often contains real customer data | Seed scripts in the repo, run by one command |
| Plain `INSERT` in a reference seed | Running it twice duplicates every row | `onConflict(naturalKey).merge()` |
| Upserting on `id` instead of a natural key | Ties every environment to the same autoincrement values | Conflict on `key`, `slug` or `code` |
| `DELETE` then re-insert reference data | Breaks every foreign key pointing at those rows | Upsert in place |
| Removing a row from the seed array to retire it | Nothing is removed from any database | Retire it in a migration, and decide what happens to referencing rows |
| Development seeds with no production guard | Fake users with known passwords in production | Throw if `NODE_ENV === 'production'` |
| Seeding 5 rows per table | Hides N+1s, missing indexes and unpaginated lists until a customer finds them | Seed at realistic volume — hundreds to thousands |
| Using seeds to set up individual tests | Tests pass in one order and fail in another; nobody can read a test alone | Factories, called by the test itself |
| Spreading overrides *before* the defaults | Defaults silently win; the test asserts nothing | `...overrides` last |
| `faker.internet.email()` for a unique column | Collides eventually, and only in CI | A counter: `user-${n}@example.test` |
| Real bcrypt hashing inside a factory | ~80 ms per user; 40 seconds across a suite | One precomputed static hash |
| Unseeded random data | A failure you cannot reproduce | `faker.seed()` from `TEST_SEED`, printed every run |
| `new Date()` in a fixture | Flakes at midnight, month end, and across timezones | Fixed instants plus an injected clock |

## Questions to Test Yourself

1. A new developer runs the app and gets a redirect loop on every page. Name
   the category of seed data that is missing and why the app cannot start
   without it.
2. Explain the difference between a seed, a factory and a fixture in one
   sentence each, then give an example of each from a billing application.
3. Why must reference seeds be idempotent, and why is `onConflict('id')` the
   wrong way to achieve it?
4. Someone deletes the `legacy-pro` plan from the plans seed array and deploys.
   What happens in production? What should they have done?
5. Your team seeds 5 projects per company. List three distinct bugs this
   guarantees will reach production, and say where each would have surfaced
   with 400.
6. Give two concrete reasons a test should call `createUser({ role: 'admin' })`
   instead of writing an insert with twelve columns.
7. What breaks if a factory spreads `...overrides` before its defaults instead
   of after?
8. `createTask()` creates a project and a company when none is given. Describe
   the cost of this when a suite runs 600 tests, and the rule that keeps it
   acceptable.
9. A test fails in CI once every fifty runs and never locally. Describe the
   mechanism that makes this reproducible without removing the randomness.
10. Why is `new Date()` in a fixture a bug even though it looks correct today?
    Name two separate conditions under which it fails.

---

> **➡️ Continued in [Part 2](05-seeding-and-test-data-part-2.md)** — keeping
> tests isolated from each other, transaction rollback and its one limitation,
> running tests in parallel, why production data must never reach a laptop, and
> generating large volumes efficiently.

## Related

- [Part 2](05-seeding-and-test-data-part-2.md) — test isolation, parallel runs,
  and anonymisation.
- [02-migrations-part-1.md](02-migrations-part-1.md) — the schema these seeds
  fill, and the deploy step reference seeds run beside.
- [01-orm-vs-query-builder.md](01-orm-vs-query-builder.md) — the models and
  query builder the factories above are written against.
- [05-dependency-injection-in-practice.md](../09-application-architecture/05-dependency-injection-in-practice.md)
  — injecting a clock so "now" is a value the test controls.
- [generics](../../typescript-fundamentals/generics/generics.md) — the
  `Factory<T>` and `Partial<T>` types that make overrides type-safe.
- [n-plus-one-queries.md](../../databases/query-optimization/n-plus-one-queries.md)
  — the bug that realistic seed volume exposes on day one.
- [04-test-data-and-mocking-part-1.md](../13-testing-and-quality/04-test-data-and-mocking-part-1.md)
  and [Part 2](../13-testing-and-quality/04-test-data-and-mocking-part-2.md) —
  the testing-strategy side: when to use a real database at all, and what to
  mock instead.
