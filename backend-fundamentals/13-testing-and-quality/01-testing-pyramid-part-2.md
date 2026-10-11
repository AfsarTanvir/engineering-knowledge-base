# The Testing Pyramid — Part 2

Part 1 argued that tests are worth writing and gave you the levels. This part is
about judgement, which is where most suites go wrong. Plenty of teams have 2,000
tests, 94% coverage, a nine-minute suite, three tests everyone re-runs until
they pass — and production incidents every week. They did not fail to write
tests. They failed to write tests that would *notice*.

> **⬅️ This continues [Part 1](01-testing-pyramid-part-1.md).**

> **📌 In one line:** a test is worth its maintenance cost only if there is a
> realistic future change that would make it fail.

## Table of Contents

1. [What Is Worth Testing, and What Is Not](#what-is-worth-testing-and-what-is-not)
2. [Coverage Measures Lines, Not Correctness](#coverage-measures-lines-not-correctness)
3. [How to Use Coverage Honestly](#how-to-use-coverage-honestly)
4. [The Shape of a Good Test: Arrange, Act, Assert](#the-shape-of-a-good-test-arrange-act-assert)
5. [Naming: Describe the Behaviour, Not the Method](#naming-describe-the-behaviour-not-the-method)
6. [Before and After](#before-and-after)
7. [Tests as Documentation](#tests-as-documentation)
8. [Hard to Test Is a Design Signal](#hard-to-test-is-a-design-signal)
9. [Flaky Tests: the Fastest Way to Kill a Suite](#flaky-tests-the-fastest-way-to-kill-a-suite)
10. [Where Tests Run: Your Machine and the CI Gate](#where-tests-run-your-machine-and-the-ci-gate)
11. [Starting From Zero: a Plan You Can Actually Follow](#starting-from-zero-a-plan-you-can-actually-follow)
12. [Common Mistakes](#common-mistakes)
13. [Questions to Test Yourself](#questions-to-test-yourself)
14. [Related](#related)

---

## What Is Worth Testing, and What Is Not

The single biggest lever on whether testing feels worth it is *what you choose
to test*. Test the wrong things and you get a slow suite that breaks constantly
and never catches anything, which is exactly the outcome sceptics predict.

| Worth testing | Why |
|---|---|
| **Business rules** | "A free plan allows 5 open invoices" is the reason the software exists, and it is the thing a refactor silently breaks |
| **Authorization** | A cross-tenant leak is a company-ending bug and is invisible when you click through as one user |
| **Edge cases and boundaries** | Zero items, exactly the limit, one over, empty string, the last day of the month, a negative amount |
| **Error paths** | You never exercise these by hand, so they are where dead code and wrong status codes hide |
| **Money and dates** | Rounding, currency, timezone, DST — wrong constantly and expensively |
| **Any bug you have already had** | Proven to be reachable; the test stops it returning |
| **State machines and complex conditionals** | Draft → sent → paid → refunded; illegal transitions must be refused, and more than two branches means you will get one wrong |
| **Anything with concurrency** | Double-booking and double-charging cannot be found by hand |
| **Public API response shapes** | Other people's code depends on those exact field names |

| Not worth testing | Why |
|---|---|
| **Trivial getters and setters** | `get total() { return this._total }` — the test restates the line |
| **Framework behaviour** | Whether your router routes, whether the ORM saves. That is the framework's own test suite |
| **Third-party libraries** | Do not test that `zod` validates or that `luxon` adds days. Test *your* use of them at a boundary |
| **Type-level guarantees** | If TypeScript proves the argument is a `string`, a runtime test for it is noise. See [unknown-any.md](../../typescript-fundamentals/unknown-any/unknown-any.md) |
| **Generated code** | Migrations, ORM models, protobuf stubs |
| **Pass-through controllers** | A controller that parses input and calls one service has nothing of its own to assert — cover it with an API test instead |
| **Private helpers, directly** | Test them through the public behaviour that uses them |
| **Log lines, metric names, UI copy** | They change weekly and break nothing when they do |

> **💡 Tip:** a useful filter before writing any test — *name a plausible change
> that would break this.* If you cannot, the test is decoration. If the answer is
> "renaming a private method", the test is worse than decoration.

---

## Coverage Measures Lines, Not Correctness

Coverage tooling runs your suite, records which lines and branches executed, and
gives you a percentage. **What it measures:** which lines *ran*. **What it does
not measure:** whether anything *checked the result*.

The distinction is not theoretical. This test produces 100% coverage of
`createInvoice` and cannot fail:

```ts
// ❌ BROKEN — full coverage, zero value
test('createInvoice', async () => {
  await service.createInvoice({ projectId: 'p_1', companyId: 'c_1', lines: [] })
})
```

Every line executed. Nothing was asserted. Delete the entire body of
`createInvoice` and replace it with `return null` and this test still passes.
The coverage report will show green, and green is what people look at.

It gets worse with assertions that cannot fail — `expect(invoice).toBeDefined()`
is true for `{}`, and `expect(invoice.lines.length).toBeGreaterThanOrEqual(0)`
is true always. Both count as assertions in every report you will ever read.

So a coverage number tells you the *upper bound* of what your suite could
possibly have caught. It never tells you what it did catch.

| Coverage says | What is actually true |
|---|---|
| 0% on a file | Nothing in that file is tested. This is real information |
| 40% overall | At least 60% of your code has no test that even touches it |
| 95% overall | Somewhere between "excellent" and "worthless" — the number cannot tell you which |
| 100% on `payment.ts` | Every line ran. It says nothing about whether the amount was right |

---

## How to Use Coverage Honestly

**100% coverage is a bad goal.** Three reasons, none of them laziness:

1. The last 10% is almost always defensive branches that cannot occur, and
   people reach it by writing assertion-free tests or deleting error handling.
2. It makes coverage a target, so it stops being a measurement — teams write
   tests *for the report*, which are exactly the tests that catch nothing.
3. It spends a limited budget uniformly when the value is wildly non-uniform. A
   test on the refund calculation is worth a hundred on the settings page.

**What to do instead:**

- Read the report as a **map of what is untested**, not as a score — sort by
  file and look at names, not numbers.
- Ask the only question that matters: *is anything critical at 0%?* An
  uncovered `permissions.ts` or `billing.ts` is an emergency regardless of the
  overall figure. An uncovered `date-format-helpers.ts` is a shrug.
- Use **diff coverage** — "were the lines in this pull request tested?" —
  rather than a global gate.
- If you must have a CI threshold, set it below where you already are, so it
  catches a collapse rather than blocking every PR.

> **📌 Remember:** 70% coverage where the covered part is your billing and
> permission code beats 95% where those two files are the uncovered 5%.

A stronger technique exists if you want it: **mutation testing** changes your
source (flips a `>` to `>=`, deletes a line) and re-runs the suite. If nothing
fails, the mutation "survived" — proof that the code is executed but unchecked.
It is slow, so run it occasionally on your most important module, not in CI.

---

## The Shape of a Good Test: Arrange, Act, Assert

Almost every good test has three visible phases, in this order.

```ts
test('applies the annual discount to a yearly plan', () => {
  // Arrange — set up the world this test needs
  const plan = { interval: 'yearly', priceCents: 120_000 }

  // Act — do exactly one thing
  const total = calculateTotal(plan, { discountPercent: 20 })

  // Assert — state what must be true
  expect(total).toBe(96_000)
})
```

Keep the phases visually separate even without the comments. When you cannot
tell where "arrange" ends, the test is doing too much.

**One behaviour per test.** Not one assertion — several assertions about the
*same* behaviour are fine (status code, body and the resulting row all describe
one outcome). The rule is one *reason to fail*. When `createInvoice works`
fails you learn nothing; when `rejects an invoice when the project is archived`
fails you already know the bug.

**No logic in tests.** No `if`, no `for` building expectations, and never the
implementation's own function to compute the expected value:

```ts
// ❌ BROKEN — the test cannot disagree with the code
expect(applyDiscount(10_000, 10)).toBe(Math.round(10_000 * 0.9))

// ✅ FIXED — a human decided the answer
expect(applyDiscount(10_000, 10)).toBe(9_000)
```

Hard-coded expected values feel primitive. That is the point: a literal `9_000`
is a second, independent opinion. A computed expectation just re-runs the bug.

---

## Naming: Describe the Behaviour, Not the Method

A test name is read far more often in a failure log than in the file. Make it a
sentence about behaviour that a non-author can understand without opening
anything.

| ❌ Name | ✅ Name |
|---|---|
| `test createInvoice 2` | `rejects an invoice when the project is archived` |
| `should work` | `returns 404 when the project belongs to another company` |
| `test user service` | `sends a verification email when the email address changes` |
| `discount test` | `caps the discount at the subtotal so the total is never negative` |
| `edge case` | `treats an invoice with zero lines as not sendable` |
| `test error` | `throws PROJECT_ARCHIVED rather than a generic error` |

Three habits produce good names automatically. **Start with a third-person
verb** — *returns*, *rejects*, *sends*, *refuses*, *rounds*, *retries*.
**Include the condition** — *when the project is archived*, *for a user without
the billing role*, *on the last day of the month*. **Never name a method**:
`createInvoice` ties the test to a symbol that will be renamed, and the
behaviour will not be.

> **💡 Tip:** read the test names out loud with the `describe` block. "Invoice
> creation — rejects an invoice when the project is archived" should sound like
> a requirements document, because it is one.

---

## Before and After

Here is a real test that is technically correct and practically useless, then
the same coverage rewritten.

```ts
// ❌ BROKEN — one name, four behaviours, unreadable setup
test('invoice service', async () => {
  const repo = new InMemoryInvoiceRepository()
  const projects = new InMemoryProjectRepository([
    { id: 'p_1', companyId: 'c_1', status: 'active' },
    { id: 'p_2', companyId: 'c_1', status: 'archived' },
  ])
  const service = new InvoiceService(projects, repo)

  const ok = await service.createInvoice({
    projectId: 'p_1', companyId: 'c_1', lines: [{ amountCents: 5_000 }],
  })
  expect(ok).toBeDefined()

  try {
    await service.createInvoice({
      projectId: 'p_2', companyId: 'c_1', lines: [{ amountCents: 5_000 }],
    })
  } catch (e) { expect(e).toBeDefined() }

  const empty = await service.createInvoice({
    projectId: 'p_1', companyId: 'c_1', lines: [],
  })
  expect(empty.totalCents).toBe(0)
})
```

Everything wrong here matters. When it fails, the report says `invoice service`
and nothing else. The `try/catch` passes even if nothing throws — a test that
can never fail. `toBeDefined()` would accept a wrong invoice. And `p_1` versus
`p_2` hides the only fact that matters: one of them is archived.

```ts
// ✅ FIXED — three named behaviours, explicit data, real assertions
describe('InvoiceService.createInvoice', () => {
  const activeProject = { id: 'p_1', companyId: 'c_1', status: 'active' }
  const archivedProject = { id: 'p_2', companyId: 'c_1', status: 'archived' }

  function serviceWith(...projects: Project[]) {
    return new InvoiceService(
      new InMemoryProjectRepository(projects),
      new InMemoryInvoiceRepository(),
    )
  }

  test('creates a draft invoice for an active project', async () => {
    const invoice = await serviceWith(activeProject).createInvoice({
      projectId: 'p_1', companyId: 'c_1', lines: [{ amountCents: 5_000 }],
    })
    expect(invoice.status).toBe('draft')
    expect(invoice.totalCents).toBe(5_000)
  })

  test('rejects an invoice when the project is archived', async () => {
    await expect(
      serviceWith(archivedProject).createInvoice({
        projectId: 'p_2', companyId: 'c_1', lines: [{ amountCents: 5_000 }],
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' })
  })

  test('allows an invoice with no lines but totals it at zero', async () => {
    const invoice = await serviceWith(activeProject).createInvoice({
      projectId: 'p_1', companyId: 'c_1', lines: [],
    })
    expect(invoice.totalCents).toBe(0)
  })
})
```

The word **archived** now appears in the test that is about archiving. That is
not cosmetic — it is the difference between a test you can read in five seconds
and one you have to reverse-engineer.

---

## Tests as Documentation

Open a codebase you have never seen and ask what `SubscriptionService` does.
The implementation tells you *how*. The test file tells you *what*, as a list of
sentences:

```
SubscriptionService.cancel
  ✓ marks the subscription as cancelled at the end of the current period
  ✓ keeps access until the period end rather than revoking immediately
  ✓ refuses to cancel a subscription that is already cancelled
  ✓ does not charge again after cancellation
  ✓ emits subscription.cancelled exactly once
```

That is the specification, and unlike a wiki page it cannot go out of date
without the build failing. It also changes code review: a pull request that adds
the test `✓ refuses a refund after 90 days` is self-explaining, because the
reviewer reads the intent before the implementation.

---

## Hard to Test Is a Design Signal

This is the idea that converts sceptics, so it deserves stating plainly.

**When a test is painful to write, the pain is almost never about testing.** It
is the design telling you something, and the message is usually specific:

| The pain | What the design is telling you |
|---|---|
| I must boot the whole framework to test one rule | The rule is trapped inside a controller — move it to a service |
| I need to mock six things | The class does six things |
| I have to insert eleven rows to reach the line I care about | The function needs data it should not need |
| I cannot test it without waiting or without the real date | Time is hard-coded instead of injected |
| The test breaks when I rename a private method | The test is asserting structure, not behaviour |
| I cannot test the error path because the mailer always succeeds | The mailer is imported rather than injected |
| Two tests interfere with each other | Module-level mutable state |

Every row has the same fix: **make the dependency explicit**. That is exactly
what the service layer and dependency injection were for —
[02-service-layer-part-1.md](../09-application-architecture/02-service-layer-part-1.md)
and
[05-dependency-injection-in-practice.md](../09-application-architecture/05-dependency-injection-in-practice.md).
Read backwards it is a design tool: *if I had to test this, what would I need?*
Asking that before you write the code produces better code either way.

---

## Flaky Tests: the Fastest Way to Kill a Suite

A flaky test passes and fails on the same code. It is worse than no test,
because it teaches the team that red does not mean broken. Once people re-run
CI until it goes green, a genuine failure will be re-run too, and the suite has
stopped working while still costing nine minutes per push.

Treat a flaky test as a production incident: quarantine it the same day, fix it
or delete it within the week.

| Cause | What it looks like | The fix, in one line |
|---|---|---|
| **Real time** | Passes all day, fails at 23:59 or across a DST change | Inject a clock and freeze it |
| **Timezone** | Passes on your laptop, fails in CI (UTC) | Pin `TZ=UTC` and assert in UTC |
| **Randomness** | Fails one run in fifty | Seed the generator or inject the random source |
| **Shared state** | Fails only when the whole file runs | Give each test its own data; no module-level mutation |
| **Test ordering** | Passes alone, fails in a suite, or vice versa | Isolate with a transaction rollback per test |
| **Real network** | Fails when the Wi-Fi blips or the API rate-limits | Fake the boundary; keep real calls in a separate suite |
| **Fixed sleeps** | `await sleep(200)` passes until CI is loaded | Wait for the condition, not the clock |
| **Unawaited promises** | The assertion runs before the write lands | Await everything; enable the floating-promise lint rule |
| **Parallelism on one database** | Two workers truncate each other's rows | One schema or one transaction per worker |
| **Autoincrement assumptions** | `expect(invoice.id).toBe(1)` | Assert on what you inserted, never on generated ids |
| **Ordering without `ORDER BY`** | Rows come back in a different order under load | Assert as a set, or sort explicitly |

> **⚠️ Warning:** the most common "fix" is adding a retry to the test. That is
> not a fix. It hides a race that your users will eventually hit, because
> production does not retry.

---

## Where Tests Run: Your Machine and the CI Gate

Tests have two homes and both are necessary.

**Locally**, they run while you work — the one file you are editing, in watch
mode, with feedback in under a second. A suite you run once a day tells you
about a bug a day late.

**In CI**, they run on every push and pull request, on a clean machine with a
clean database and no leftover state from your laptop. This is where the suite
becomes a *gate*: no merge while it is red, no deploy from a commit that did
not pass. A workable order for a small backend is type check (`tsc --noEmit`),
lint, unit tests, integration tests against a containerised database, and — only
on the main branch — end-to-end tests.

Two rules keep this honest. **CI must be able to fail the build**; a pipeline
that merges anyway is theatre. And **CI must not be the first place a test
runs**; if the suite only passes on CI, nobody will debug it.

Full detail, including the database service container and caching:
[overview.md](../../cloud-devops/ci-cd/overview.md) and
[github-actions.md](../../cloud-devops/ci-cd/github-actions.md).

---

## Starting From Zero: a Plan You Can Actually Follow

You have no tests today. Do not plan a "testing sprint" — they never survive
contact with a deadline. Do this instead, in order.

**Week 1 — one integration test on your most critical endpoint.** Pick the one
whose failure would cost the most: the one that takes money, or creates the core
record. Write exactly one test — authenticate, send a valid request, assert the
status code, the response body, and the row in the database. Most of the week
goes on plumbing (a disposable test database, a way to make an authenticated
request), and that plumbing is the real deliverable: every future test costs
minutes because you paid this once.

**Week 2 — the negative cases on that same endpoint.** Three more tests now
that the setup exists: invalid input returns 422 with field errors; an
unauthenticated request returns 401; **a user from another company gets 404**.
That third one is the highest-value test in the file, and probably the first
real bug you will find.

**Week 3 onward — the bug-driven loop.** The habit that matters, and it costs
almost nothing:

> Every time you fix a bug, write the failing test **first**. Watch it fail.
> Then fix the bug. Watch it pass.

Writing it first is not ceremony — it is the only way to know the test actually
detects the bug. A test written after the fix often passes for the wrong reason,
and you never find out.

**Ongoing — add a unit test whenever you write real logic.** Not for CRUD, but
for any function with branches: pricing, quotas, proration, permissions.

**What good looks like after three months:** 15–30 integration tests on your
important endpoints, 30–60 unit tests around logic that has bitten you, a suite
under a minute, and a CI gate. No e2e tests yet. The first time it catches a bug
before a customer does, the argument is over.

> **📌 Remember:** the first test is expensive and every test after it is cheap.
> Most teams who "tried testing and it was not worth it" quit during the first
> one.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Chasing a coverage percentage | Produces assertion-free tests that cover everything and catch nothing | Look for critical files at 0%; use diff coverage |
| `expect(result).toBeDefined()` as the assertion | Passes for almost any value, including wrong ones | Assert the actual value or shape |
| `try { ... } catch (e) { expect(e).toBeDefined() }` | Passes when nothing throws | `await expect(fn()).rejects.toMatchObject({ code })` |
| Computing the expected value with the code under test | The test can never disagree with the bug | Hard-code the literal you decided by hand |
| Test names like `test createInvoice 2` | A failure log that teaches you nothing | Name the behaviour and the condition |
| Several behaviours in one test | One failure hides the others; the name cannot be accurate | One reason to fail per test |
| Re-running CI until it goes green | Trains the team to ignore red | Fix or quarantine the flaky test that day |
| Adding a retry or a `sleep` to a flaky test | Hides a race your users will hit | Find the cause in the flakiness table |
| Planning a "testing sprint" | Gets cut when a deadline appears | One endpoint, then the bug-driven loop |
| Writing the regression test after the fix | It may pass for the wrong reason | Write it first and watch it fail |

---

## Questions to Test Yourself

1. A test executes every line of `refund.ts` and asserts nothing. What does the
   coverage report say, and what have you actually proved?
2. Give two concrete reasons 100% coverage is a bad target, neither of which is
   "it takes too long".
3. Your suite is at 92% coverage and you had three production incidents last
   month. What would you look at first, and why is it not the percentage?
4. Rewrite `test('user service')` covering registration, duplicate email and a
   weak password into three named tests. Say what each one's failure would tell
   you.
5. Why is `expect(applyDiscount(10_000, 10)).toBe(Math.round(10_000 * 0.9))`
   worse than hard-coding `9_000`?
6. A test passes locally and fails in CI. List five candidate causes from the
   flakiness table and the one-line check for each.
7. A colleague says "this class is impossible to test". What are you now going
   to ask them about the class itself?
8. You have zero tests and one week. Say exactly which test you write first and
   what you assert in it.
9. Why must the regression test for a bug be written *before* the fix?

---

> **⬅️ This continues [Part 1](01-testing-pyramid-part-1.md)** — the case for
> testing, the four levels applied to one feature, and the pyramid versus the
> trophy.

## Related

- [Part 1](01-testing-pyramid-part-1.md) — why tests exist, what a test is, and
  the shape of a suite.
- [02-unit-testing-part-1.md](02-unit-testing-part-1.md) — writing the cheap,
  fast tests this file kept referring to.
- [03-integration-and-api-testing-part-1.md](03-integration-and-api-testing-part-1.md)
  — the "week 1" test, in full detail.
- [04-test-data-and-mocking-part-1.md](04-test-data-and-mocking-part-1.md) —
  making the arrange phase readable with factories.
- [02-service-layer-part-1.md](../09-application-architecture/02-service-layer-part-1.md)
  — the design that makes business rules testable at all.
- [05-dependency-injection-in-practice.md](../09-application-architecture/05-dependency-injection-in-practice.md)
  — injecting the clock, the mailer and the random source.
- [overview.md](../../cloud-devops/ci-cd/overview.md) and
  [github-actions.md](../../cloud-devops/ci-cd/github-actions.md) — the suite as
  a merge gate, with a database service container.
- [unknown-any.md](../../typescript-fundamentals/unknown-any/unknown-any.md) —
  what the type system proves, so you do not test it.
- [01-error-taxonomy.md](../07-error-handling/01-error-taxonomy.md) — the error
  codes worth asserting on instead of "something threw".
