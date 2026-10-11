# Test Data & Mocking — Part 1

Two things turn a useful test suite into a liability, and neither is a missing
test.

The first is **unclear data setup**. You open a failing test, and the twenty
lines before the assertion tell you nothing about why it should pass. You
cannot see which field matters, so you cannot tell whether the failure is a
real bug or a fixture someone changed for a different test.

The second is **too much mocking**. Every dependency is replaced by something
you told what to return, the suite is green, and production is broken — because
what you tested was your own script of how the world behaves.

This part fixes the first. Part 2 fixes the second. They are the same disease
seen twice: a test that describes a world you imagined rather than one the
software will meet.

> **📌 In one line:** every fact a test depends on must be visible in the test,
> and every test must be able to run alone, in any order, without anything left
> behind by another.

## Table of Contents

1. [The Setup Nobody Can Read](#the-setup-nobody-can-read)
2. [Factories: One Line per Fact That Matters](#factories-one-line-per-fact-that-matters)
3. [Named Scenarios Beat Override Objects](#named-scenarios-beat-override-objects)
4. [Make the Relevant Data Explicit](#make-the-relevant-data-explicit)
5. [The Giant Shared Fixture](#the-giant-shared-fixture)
6. [Shared Mutable State](#shared-mutable-state)
7. [Test-Order Dependence Is a Bug](#test-order-dependence-is-a-bug)
8. [Common Mistakes](#common-mistakes)
9. [Questions to Test Yourself](#questions-to-test-yourself)
10. [Related](#related)

---

## The Setup Nobody Can Read

Here is a test that works. It is also unreadable, and unreadable setup is what
makes people say the suite is more trouble than the features.

```ts
// ❌ BROKEN — 22 lines of setup, and you still cannot say what is being tested
test('invoice total', async () => {
  const [company] = await db('companies').insert({
    name: 'Acme', slug: 'acme', plan: 'pro', status: 'active',
    created_at: new Date(), updated_at: new Date(),
  }).returning('*')
  const [user] = await db('users').insert({
    company_id: company.id, email: 'a@b.com', name: 'A',
    password_hash: '$2b$10$...', role: 'admin', status: 'active',
    timezone: 'UTC', locale: 'en', email_verified_at: new Date(),
    created_at: new Date(), updated_at: new Date(),
  }).returning('*')
  const [project] = await db('projects').insert({
    company_id: company.id, owner_id: user.id, name: 'Redesign',
    status: 'active', currency: 'GBP', created_at: new Date(),
  }).returning('*')
  const [invoice] = await db('invoices').insert({
    project_id: project.id, company_id: company.id, status: 'draft',
    currency: 'GBP', due_at: new Date(), created_at: new Date(),
  }).returning('*')

  expect(await totalFor(invoice.id)).toBe(0)
})
```

Ask the three questions you ask of any test and none of them has an answer.
*Which of those 40 fields does the result depend on?* You would have to read
`totalFor` to find out. *What happens when someone adds a `NOT NULL` column?*
This file breaks, along with the eighty others written the same way. *What is
the test actually asserting?* That a new invoice with no lines totals zero —
one fact, buried under four inserts.

The cost is not the typing. It is that **the setup stopped being a description
of a scenario and became a description of your schema**, and schemas change far
more often than scenarios do.

---

## Factories: One Line per Fact That Matters

A factory is a function with sensible defaults and an overrides parameter, so a
test names only the fields it depends on and inherits the rest.

```ts
// ✅ FIXED — the same test, saying only what it means
test('a new invoice with no lines totals zero', async () => {
  const invoice = await createInvoice({ status: 'draft' })

  expect(await totalFor(invoice.id)).toBe(0)
})
```

The company, the user and the project still exist — `createInvoice` created
them lazily because it needed a parent. They are simply no longer in the test,
because the test does not depend on them. The `NOT NULL` column that broke
eighty files now breaks one factory.

The **mechanics** of writing them — `build` versus `create`, lazy parents,
unique values from a counter rather than `faker`, why `...overrides` must go
last, and why you never hash a real password inside a factory — are in
[05-seeding-and-test-data-part-1.md](../10-database-integration/05-seeding-and-test-data-part-1.md),
and they are not repeated here. What matters *for testing strategy* is the
three properties the pattern buys you.

| Property | What it means in a test | What you lose without it |
|---|---|---|
| **Defaults are valid** | Any factory call produces a row the application could really have written | Tests that pass against data the app can never produce |
| **Overrides are the subject** | Whatever you pass is, by convention, the thing the test is about | A reader guessing which of 40 fields matters |
| **Parents are implicit** | A four-level graph costs one line when the hierarchy is irrelevant | Every test rewritten when a fifth level appears |

The second property is the one people underuse. Once the team agrees that
*anything you override is load-bearing*, the override object becomes
documentation: `createInvoice({ status: 'overdue', dueAt: THIRTY_DAYS_AGO })`
tells a reader exactly what scenario is being tested, and the absence of
anything else tells them nothing else matters.

> **⚠️ Warning:** the property only holds if you keep it. The moment somebody
> passes `{ status: 'draft' }` to a factory whose default is already `'draft'`,
> the convention weakens — a reader now has to check the factory to know
> whether an override is significant.

---

## Named Scenarios Beat Override Objects

When the same override object appears in five tests, it has stopped being an
override and become a *scenario*. Give it a name.

```ts
// Repeated in five files — noise, and one edit away from being inconsistent
const invoice = await createInvoice({
  status: 'sent', dueAt: daysFrom(NOW, -40), paidAt: null,
})

// A scenario with a name, defined once
export const createOverdueInvoice = (o: Partial<NewInvoice> = {}) =>
  createInvoice({ status: 'sent', dueAt: daysFrom(NOW, -40), paidAt: null, ...o })
```

`createOverdueInvoice()` reads better than the object, but the real gain is
that "overdue" now has exactly one definition. When the business decides
overdue means 45 days, you change one line rather than grepping for `-40`.

This is the good version of shared setup, and it is worth being precise about
why it does not break the rule in the next section. `createOverdueInvoice` is
**named after the fact it establishes**, so a test calling it still says
"overdue" out loud. A shared fixture called `setupTestData()` does not.

---

## Make the Relevant Data Explicit

Here is the rule that does the most work in this whole file:

> **If a test asserts behaviour for an archived project, the word "archived"
> must appear in the body of that test.**

Not in a fixture file. Not in a `beforeEach` three screens up. Not implied by a
factory named `createProjectB`. In the test, where the person debugging it at
4 PM on a Friday will see it.

```ts
// ❌ BROKEN — why does this pass? Nothing here says why.
beforeEach(async () => {
  project = await createProject(FIXTURE_PROJECT)
})

test('refuses to create an invoice', async () => {
  await expect(service.createInvoice({ projectId: project.id, lines: [] }))
    .rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' })
})
```

Read that test alone and it is nonsense: it refuses to create an invoice, for
no stated reason. The reason lives in `FIXTURE_PROJECT`, in another file, where
`status: 'archived'` sits between fifteen other fields. The name does not say
it either — `refuses to create an invoice` omits the only condition that makes
the behaviour correct.

```ts
// ✅ FIXED — the condition is in the name and in the body
test('refuses to create an invoice for an archived project', async () => {
  const project = await createProject({ status: 'archived' })

  await expect(service.createInvoice({ projectId: project.id, lines: [] }))
    .rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' })
})
```

Three lines, and every question is answered in place. There is one more payoff
that only shows up later: the fixed version is **safe to change**. Somebody who
wants to test a *draft* project writes `createProject({ status: 'draft' })` and
affects nobody. In the broken version they would edit `FIXTURE_PROJECT`, and
the failure would surface in a different file with a name that mentions
neither projects nor status.

The practical test is this: **cover everything above the test and read it.**
If you cannot say what it is asserting and why that should be true, the setup
is hiding something the test is about.

---

## The Giant Shared Fixture

The anti-pattern has a predictable life cycle, and recognising it early is the
whole point of this section.

Someone writes `seedTestData()` to avoid repetition. It creates a company, four
users, three projects and a handful of invoices. It is genuinely convenient.
Every new test uses it, because it is there and everything already exists.

Six months later:

```ts
// tests/fixtures.ts — 300 lines, and every test secretly depends on it
export async function seedTestData() {
  const acme = await createCompany({ name: 'Acme', plan: 'pro' })
  const owner = await createUser({ companyId: acme.id, role: 'owner' })
  const viewer = await createUser({ companyId: acme.id, role: 'viewer' })
  const p1 = await createProject({ companyId: acme.id, status: 'active' })
  const p2 = await createProject({ companyId: acme.id, status: 'archived' })
  const i1 = await createInvoice({ projectId: p1.id, status: 'draft' })
  const i2 = await createInvoice({ projectId: p1.id, status: 'paid' })
  // ...and forty more rows nobody dares delete
  return { acme, owner, viewer, p1, p2, i1, i2 /* ... */ }
}
```

Now count the damage.

| Symptom | Why it happens |
|---|---|
| `p2` cannot be renamed or removed | Forty tests reference it and none of them says what it is for |
| Changing `i2.status` breaks six unrelated files | They depended on it silently and never said so |
| Every test is slow | Fifty rows are inserted to run an assertion that needed two |
| Tests pass for the wrong reason | An assertion about "the only draft invoice" holds by accident of the fixture |
| Nobody can add data | Adding a third project might break something, so people add a *second* fixture |
| Reading a test requires two files | And the second file explains nothing, because it serves everyone |

The deepest problem is the fourth row. A fixture creates *coincidences* —
"there happens to be exactly one archived project" — and tests quietly start
asserting on them. Those assertions are true, they pass, and they are not
testing anything the software guarantees.

**The fix is not to delete it on a Friday.** It is to stop growing it, and to
migrate outwards: every new test builds its own data with factories, and every
time you touch an old test you convert that one. The fixture shrinks as tests
stop referring to its rows, and the last few can be deleted when nothing does.

The one thing that legitimately belongs in shared setup is **reference data** —
roles, plans, countries, permissions. The application cannot start without
them, they are identical for every test, and no test is *about* them. Seed
those once when the suite starts:
[05-seeding-and-test-data-part-1.md](../10-database-integration/05-seeding-and-test-data-part-1.md).

> **💡 Tip:** a shared helper that takes arguments and returns a named scenario
> is fine — `signedInUser({ role: 'viewer' })`. A shared helper that takes
> nothing and returns a world is the anti-pattern. The difference is whether
> the test can say what it got.

---

## Shared Mutable State

Fixtures are the visible version of the problem. The invisible version is state
that lives at module scope and survives between tests.

```ts
// ❌ BROKEN — one object, mutated by whichever test ran first
const testUser = { id: 'u_1', role: 'member', seats: 3 }

test('promoting a member makes them an admin', () => {
  promote(testUser)
  expect(testUser.role).toBe('admin')
})

test('a member cannot delete a project', () => {
  expect(canDelete(testUser, project)).toBe(false)   // passes alone, fails in suite
})
```

The second test is correct, the code is correct, and the suite is red — because
the first test permanently turned `testUser` into an admin. Run the second file
alone and it passes, which is the most expensive kind of failure: an hour spent
debugging code that was never broken.

```ts
// ✅ FIXED — a function, so every test gets its own
const makeUser = (o: Partial<User> = {}) => ({
  id: 'u_1', role: 'member', seats: 3, ...o,
})

test('promoting a member makes them an admin', () => {
  const user = makeUser()
  promote(user)
  expect(user.role).toBe('admin')
})
```

The same failure has several disguises, and they are worth recognising by
sight.

| Shape | Why it leaks | The fix |
|---|---|---|
| `const fixture = { ... }` at module scope | One object, shared by reference, mutated in place | A function returning a fresh object |
| A module-level cache or registry | Survives every test in the process | Clear it in `afterEach`, or inject it |
| A singleton service holding state | Same instance for the whole file | Construct one per test |
| `process.env.X = ...` inside a test | Every later test in that process sees it | Set and restore, or inject configuration |
| Rows left in the database | The next test counts them | Rollback or truncate per test |
| A frozen clock never restored | Every later test runs in the past | `afterEach(() => vi.useRealTimers())` |

Two of those rows are database-shaped, and they are the ones with a mechanical
fix rather than a discipline fix: wrap each test in a transaction and roll it
back, or truncate. That is
[05-seeding-and-test-data-part-2.md](../10-database-integration/05-seeding-and-test-data-part-2.md),
and it is worth doing on day one, because it removes the entire category.

---

## Test-Order Dependence Is a Bug

It is tempting to treat order dependence as an inconvenience — "just run them
in the same order and it is fine". It is not fine, and stating why plainly is
worth doing, because the alternative is a suite that slowly stops meaning
anything.

**You do not control the order.** Runners order files by directory listing,
which changes when someone renames a file. They shard across CI machines. They
run in parallel. Any of those reorders your tests without anyone deciding to.

**An order-dependent pass is not a pass.** If test B only succeeds because test
A ran first, then B has never actually verified the behaviour it claims to —
the setup it needs was provided by accident. The assertion is real; the
premise is not.

**It blocks the two cheapest speedups you have.** You cannot parallelise an
ordered suite, and you cannot run one file while you work on it. Both are
things you will want within a month.

**It destroys trust.** A suite that fails intermittently teaches the team that
red does not mean broken, and from then on every failure — including the real
ones — gets re-run until it goes green.

The diagnosis is mechanical. Run the suspect file alone; if it passes alone and
fails in the suite, something before it is leaving state behind. Run the suite
with a randomised order (`--sequence.shuffle` in Vitest, `--randomize` in Jest)
and the problem surfaces on demand rather than on a Tuesday. Leaving shuffling
switched on permanently is the strongest version: it makes order dependence
impossible to introduce without noticing.

> **📌 Remember:** a test you cannot run on its own is not a test you can
> trust, because you can never be sure what actually made it pass.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Inserting every column by hand in each test | A schema change breaks every file; the meaningful field is invisible | A factory with valid defaults |
| Overriding a field the factory already defaults to | Weakens the convention that overrides are load-bearing | Override only what the test is about |
| Repeating the same override object in five tests | One edit away from being inconsistent | A named scenario, `createOverdueInvoice()` |
| The condition in a fixture instead of the test | The test cannot be read or safely changed alone | `createProject({ status: 'archived' })` in the body |
| A test name that omits the condition | The failure log does not say what broke | Name the behaviour *and* the condition |
| `seedTestData()` returning a whole world | Every test depends on rows it never mentions | Each test builds what it asserts on |
| Asserting on a coincidence of the fixture | "The only draft invoice" is true by accident, not by design | Create the data the assertion needs |
| Deleting the giant fixture in one go | Hundreds of failures at once and no way to review it | Stop growing it, convert tests as you touch them |
| A module-scope object mutated by a test | Passes alone, fails in the suite, or the reverse | A function returning a fresh object |
| `process.env.X = ...` with no restore | Leaks into every later test in the process | Set and restore, or inject configuration |
| Accepting order dependence "because the order is stable" | It is not: renames, sharding and parallelism reorder it | Isolate, and shuffle the order deliberately |
| Debugging an order-dependent failure as a code bug | The code was never broken | Run the file alone first — it takes ten seconds |

---

## Questions to Test Yourself

1. Given a test with twenty lines of inserts, name three specific questions a
   reader cannot answer, and say what a factory changes about each.
2. Why does "anything you override is load-bearing" only work if the team keeps
   to it? Give the habit that quietly breaks it.
3. When does an override object deserve to become a named scenario, and what do
   you gain besides fewer characters?
4. State the explicit-data rule in one sentence. Apply it to a test asserting
   behaviour for a user whose trial has expired.
5. `refuses to create an invoice` passes because of a fixture. Rewrite the test
   and its name, and name two problems the rewrite fixes.
6. List four distinct kinds of damage a 300-line shared fixture does. Which is
   the most dangerous, and why is it the hardest to notice?
7. Why is "delete the shared fixture" the wrong migration plan? What is the
   right one?
8. What legitimately belongs in shared setup, and what is the test for whether
   something qualifies?
9. A test passes alone and fails in the suite. Give the six candidate causes
   from the shared-state table and the check for each.
10. Give three independent reasons test-order dependence is a bug rather than
    an inconvenience. What single setting makes it impossible to introduce
    silently?

---

> **➡️ Continued in [Part 2](04-test-data-and-mocking-part-2.md)** — the five
> kinds of test double defined precisely, state versus behaviour verification,
> when mocking is right and when it quietly destroys a suite, a decision
> flowchart, in-memory fakes, keeping them honest, snapshot testing, and a
> final checklist for any test.

## Related

- [Part 2](04-test-data-and-mocking-part-2.md) — test doubles, over-mocking,
  in-memory fakes and the closing checklist.
- [05-seeding-and-test-data-part-1.md](../10-database-integration/05-seeding-and-test-data-part-1.md)
  — the factory mechanics this file deliberately does not repeat: `build` vs
  `create`, lazy parents, deterministic uniqueness.
- [05-seeding-and-test-data-part-2.md](../10-database-integration/05-seeding-and-test-data-part-2.md)
  — rollback and truncation, the mechanical cure for leftover state.
- [01-testing-pyramid-part-2.md](01-testing-pyramid-part-2.md) — test naming,
  arrange-act-assert, and the flakiness table order dependence belongs to.
- [02-unit-testing-part-2.md](02-unit-testing-part-2.md) — the shared-setup rule
  seen from the unit-test side, and injecting a clock.
- [03-integration-and-api-testing-part-1.md](03-integration-and-api-testing-part-1.md)
  — where `createProject` and `signedInUser` are used in anger.
- [generics](../../typescript-fundamentals/generics/generics.md) — the
  `Factory<T>` and `Partial<T>` types that make overrides type-safe.
