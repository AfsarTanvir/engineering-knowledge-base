# Unit Testing — Part 1

A unit test is the cheapest thing in this whole part. It needs no database, no
server, no container, no fixtures. You import a function, call it, and check the
answer. A thousand of them run in under a second.

That cheapness is the entire argument. When a test costs two minutes to write
and one millisecond to run, you can afford the boundary case, the negative
amount, the empty array, the 29th of February — all the cases you would never
produce by hand.

The catch is that a unit test can only reach code that is *reachable*. A service
that imports the database at the top of the file cannot be unit tested at all,
and no amount of test-writing skill fixes that. So this file is about tests, and
Part 2 is about the design that makes the rest of them possible.

Part 1 covers what a unit is, a full worked example on real business logic, and
the property — purity — that makes some code trivially testable.

> **📌 In one line:** a unit test runs in milliseconds and touches nothing
> outside the process — if yours does not, the code is telling you where the
> design went wrong.

## Table of Contents

1. [The Working Definition](#the-working-definition)
2. [What Counts as a "Unit"](#what-counts-as-a-unit)
3. [Do Not Test Private Methods Directly](#do-not-test-private-methods-directly)
4. [A Real Business Rule, Tested Properly](#a-real-business-rule-tested-properly)
5. [The Happy Path](#the-happy-path)
6. [The Boundaries](#the-boundaries)
7. [The Error Cases](#the-error-cases)
8. [Pure Functions Are Trivially Testable](#pure-functions-are-trivially-testable)
9. [Pushing Logic Toward Purity](#pushing-logic-toward-purity)
10. [Common Mistakes](#common-mistakes)
11. [Questions to Test Yourself](#questions-to-test-yourself)
12. [Related](#related)

---

## The Working Definition

Academic definitions of "unit test" cause arguments. Here is the one that is
actually useful day to day:

> **A unit test runs in milliseconds and touches no network, no database, and no
> filesystem.**

That is a definition by *cost*, not by scope, and it is the right one, because
cost determines how you use the test. Anything that runs in a millisecond can
run on every keystroke; anything that takes 200ms cannot.

| Property | Consequence |
|---|---|
| Runs in milliseconds | You can run the file on save, in watch mode |
| No I/O | No setup, no teardown, no container, no cleanup |
| No shared state | Tests run in any order, and in parallel, safely |
| Deterministic | Same input, same result, any machine, any hour |
| Fails precisely | The stack trace lands on the line that is wrong |

Notice what the definition does *not* say. It does not say "tests exactly one
class". A test that exercises a service plus two in-memory fakes plus a value
object is still a unit test here, because it is fast and isolated. Arguing about
whether that counts is how teams waste afternoons.

> **⚠️ Warning:** the moment a "unit" test opens a database connection it is an
> integration test wearing the wrong label, and it will be slow, order-dependent
> and occasionally flaky. That is fine — but put it in the right suite:
> [03-integration-and-api-testing-part-1.md](03-integration-and-api-testing-part-1.md).

---

## What Counts as a "Unit"

A unit is a **function or a class** — something with a public surface that means
something to a caller. It is not a line, not a branch, not a private helper.

| Candidate unit | Good unit? | Why |
|---|---|---|
| `calculateInvoiceTotal(lines, options)` | Yes | Input in, output out, real branching |
| `InvoicePolicy.canSend(actor, invoice)` | Yes | A decision with rules worth pinning down |
| `InvoiceService.createInvoice(input)` with fakes | Yes | The orchestration is worth testing |
| `formatCurrency(cents)` | Yes if you wrote the rounding; no if it wraps `Intl` | |
| A single `if` inside `createInvoice` | No | Reach it through the public method |
| `#normaliseLines()` (private) | No | It has no meaning to any caller |
| `InvoiceController.store(ctx)` | No | Nothing to assert but delegation |

The practical test: **can you name the behaviour without mentioning the
implementation?** "Calculates the total with discount and tax" is a behaviour.
"Calls `#applyDiscount` then `#applyTax`" is an implementation detail, and a
test pinning it down breaks the next time you reorder those two steps.

---

## Do Not Test Private Methods Directly

The urge is understandable: the private method holds the complicated logic, so
why not test it directly?

```ts
// ❌ BROKEN — reaching in to test a private
// @ts-expect-error touching a private on purpose
expect(service['calculateProration'](start, end)).toBe(3_226)
```

Three costs. You can no longer rename or inline `calculateProration` without
breaking a test that is not about renaming. You are asserting on something no
caller can reach, so a bug in how the public method *uses* it stays invisible.
And the `@ts-expect-error` is the compiler telling you the test reached past the
contract.

There are two legitimate responses, which are the same response viewed twice:

1. **Test it through the public method.** If `createInvoice` handles proration,
   write `charges a half-month of the plan when the subscription starts
   mid-cycle` and assert the total. The private is covered and refactoring is
   still free.
2. **If it is too complex to reach that way, it is not private — it is a missing
   unit.** Extract it into an exported function with its own tests. The
   difficulty was the design telling you it deserved a name.

> **💡 Tip:** the second option is the useful one. "Hard to test privately"
> almost always means "a public concept is hiding in a private method".

---

## A Real Business Rule, Tested Properly

CRUD examples make unit testing look pointless, because CRUD has no logic. So
here is something with real logic: an invoice total involving a discount, a
proration for a mid-cycle start, and tax. Every step is a place where money goes
wrong, which is exactly why it deserves tests.

```ts
// src/billing/calculate-total.ts
export type InvoiceLine = { description: string; amountCents: number }

export type TotalOptions = {
  discountPercent?: number                          // 0–100
  proratedDays?: { used: number; inPeriod: number }
  taxRatePercent?: number                           // 15 means 15%
}

export function calculateInvoiceTotal(
  lines: InvoiceLine[],
  options: TotalOptions = {},
) {
  const { discountPercent = 0, proratedDays, taxRatePercent = 0 } = options

  if (discountPercent < 0 || discountPercent > 100) {
    throw new ValidationError('discountPercent must be between 0 and 100')
  }
  if (lines.some((l) => l.amountCents < 0)) {
    throw new ValidationError('An invoice line cannot be negative')
  }
  if (proratedDays && proratedDays.inPeriod <= 0) {
    throw new ValidationError('inPeriod must be greater than zero')
  }

  const subtotalCents = lines.reduce((sum, l) => sum + l.amountCents, 0)
  const discountCents = Math.round(subtotalCents * (discountPercent / 100))
  const afterDiscount = subtotalCents - discountCents

  const proratedSubtotalCents = proratedDays
    ? Math.round(afterDiscount *
        (Math.min(proratedDays.used, proratedDays.inPeriod) / proratedDays.inPeriod))
    : afterDiscount

  const taxCents = Math.round(proratedSubtotalCents * (taxRatePercent / 100))

  return {
    subtotalCents, discountCents, proratedSubtotalCents, taxCents,
    totalCents: proratedSubtotalCents + taxCents,
  }
}
```

Three deliberate decisions are buried in there, and the tests are about to pin
all three down: everything is integer cents, rounding happens at each step, and
**tax is charged on the prorated, discounted amount** — not on the subtotal.
That last one is a business decision, invisible in the code, and the only place
it will ever be written down is a test name.

---

## The Happy Path

Start with the cases a human would describe out loud.

```ts
// src/billing/calculate-total.test.ts
import { describe, test, expect } from 'vitest'
import { calculateInvoiceTotal } from './calculate-total'

const twoLines = [
  { description: 'Design retainer', amountCents: 100_000 },
  { description: 'Hosting', amountCents: 20_000 },
]

describe('calculateInvoiceTotal', () => {
  test('sums the lines when there is no discount, proration or tax', () => {
    expect(calculateInvoiceTotal(twoLines).totalCents).toBe(120_000)
  })

  test('subtracts a percentage discount from the subtotal', () => {
    const total = calculateInvoiceTotal(twoLines, { discountPercent: 10 })
    expect(total.discountCents).toBe(12_000)
    expect(total.totalCents).toBe(108_000)
  })

  test('charges only the used portion of the period when prorated', () => {
    const total = calculateInvoiceTotal(twoLines, {
      proratedDays: { used: 15, inPeriod: 30 },
    })
    expect(total.totalCents).toBe(60_000)
  })

  test('taxes the discounted and prorated amount, not the subtotal', () => {
    const total = calculateInvoiceTotal(twoLines, {
      discountPercent: 10,                       // 120_000 → 108_000
      proratedDays: { used: 15, inPeriod: 30 },  // 108_000 →  54_000
      taxRatePercent: 15,                        //  54_000 →  +8_100
    })
    expect(total.proratedSubtotalCents).toBe(54_000)
    expect(total.taxCents).toBe(8_100)
    expect(total.totalCents).toBe(62_100)
  })
})
```

The last test is the valuable one. It is the only written record anywhere in
your company of the order in which discount, proration and tax apply. If someone
reorders them, that test fails with a name explaining exactly which rule broke.
No comment, no wiki page and no code review does that reliably.

Note also that every expected value is a hand-computed literal. The comments show
the arithmetic so a reader can check it, but the code under test never computes
its own expectation.

---

## The Boundaries

Boundaries are where the bugs are. These cost thirty seconds each and are the
main reason unit tests pay for themselves.

```ts
test('returns a zero total for an invoice with no lines', () => {
  expect(calculateInvoiceTotal([]).totalCents).toBe(0)
})

test('accepts a 100 percent discount and totals zero', () => {
  expect(calculateInvoiceTotal(twoLines, { discountPercent: 100 }).totalCents)
    .toBe(0)
})

test('does not charge more than the full period when used exceeds it', () => {
  const total = calculateInvoiceTotal(twoLines, {
    proratedDays: { used: 45, inPeriod: 30 },
  })
  expect(total.totalCents).toBe(120_000)   // capped, not 180_000
})

test('rounds half a cent up rather than producing a fraction', () => {
  const total = calculateInvoiceTotal(
    [{ description: 'Odd', amountCents: 333 }], { discountPercent: 50 },
  )
  expect(total.discountCents).toBe(167)             // 166.5 → 167
  expect(Number.isInteger(total.totalCents)).toBe(true)
})
```

The third test matters most. Capping `used` at `inPeriod` is one `Math.min`,
easy to delete in a refactor, and impossible to notice by clicking through — you
would need a subscription whose usage exceeded its own billing period. That is a
test doing something you genuinely cannot do by hand.

The fourth pins down a *decision*: half a cent rounds up. Nothing in the code
says that on purpose; `Math.round` just happens to do it. The test turns an
accident into a specification, and the next person who switches to `Math.floor`
to "fix" something will be told.

---

## The Error Cases

Invalid input deserves the same treatment, and here *what* you assert matters.
Asserting "it threw" is nearly worthless — a `TypeError` from a typo also
throws, and your test would go green on broken code.

```ts
test('rejects a discount above 100 percent', () => {
  expect(() => calculateInvoiceTotal(twoLines, { discountPercent: 120 }))
    .toThrow(ValidationError)
})

test('rejects a negative invoice line', () => {
  expect(() =>
    calculateInvoiceTotal([{ description: 'Refund', amountCents: -500 }]),
  ).toThrow(ValidationError)
})

test('rejects a proration period of zero days rather than dividing by zero', () => {
  expect(() =>
    calculateInvoiceTotal(twoLines, { proratedDays: { used: 5, inPeriod: 0 } }),
  ).toThrow(ValidationError)
})
```

The last one is the kind of bug that reaches production. Without the guard,
`inPeriod: 0` produces `Infinity`, `Math.round(Infinity)` is `Infinity`, and you
send a customer an invoice for `Infinity` cents. No type checks it, no linter
catches it, and no manual click-through produces it.

Asserting the error *type and code* rather than "something threw" gets its own
section in [Part 2](02-unit-testing-part-2.md), with the classes from
[01-error-taxonomy.md](../07-error-handling/01-error-taxonomy.md).

---

## Pure Functions Are Trivially Testable

`calculateInvoiceTotal` was easy to test for one structural reason: it is
**pure**. Same inputs, same output, always; no reads from the outside world, no
writes to it.

| Property of a pure function | What it buys the test |
|---|---|
| Output depends only on arguments | No setup — build the input and call |
| No I/O | Runs in microseconds; no fakes needed |
| No hidden state | Order-independent, parallel-safe |
| No side effects | Nothing to clean up afterwards |
| Deterministic | Never flaky, ever |

Contrast a function impure in exactly one small way:

```ts
// ❌ BROKEN — reads the clock, so the answer changes by the hour
export function isInvoiceOverdue(invoice: Invoice): boolean {
  return invoice.dueAt < new Date() && invoice.status !== 'paid'
}
```

You cannot write a stable test for this. An invoice due "yesterday" works — until
someone tests the *not overdue* case with a due date "tomorrow", and the test
starts failing at 23:00 UTC on a machine in another timezone.

```ts
// ✅ FIXED — the outside world becomes a parameter
export function isInvoiceOverdue(invoice: Invoice, now: Date): boolean {
  return invoice.dueAt < now && invoice.status !== 'paid'
}
```

```ts
const now = new Date('2026-03-15T12:00:00Z')
const yesterday = new Date('2026-03-14T12:00:00Z')

test('an unpaid invoice past its due date is overdue', () => {
  expect(isInvoiceOverdue({ dueAt: yesterday, status: 'sent' }, now)).toBe(true)
})

test('a paid invoice past its due date is not overdue', () => {
  expect(isInvoiceOverdue({ dueAt: yesterday, status: 'paid' }, now)).toBe(false)
})
```

One parameter turned an untestable function into tests that will still pass in
2030. The same trick applied to a whole class is dependency injection.

---

## Pushing Logic Toward Purity

You cannot make everything pure — something has to read the database and send
the email. The goal is to *concentrate* the impurity, so the interesting part
stays testable. The shape to aim for is **impure shell, pure core**: an outer
function that does the I/O, an inner function that does the thinking.

```ts
// ❌ BROKEN — decision and I/O tangled together
async function sendOverdueReminders(companyId: string) {
  const invoices = await db.query('select * from invoices where company_id = $1',
    [companyId])
  for (const invoice of invoices) {
    if (invoice.due_at < new Date() && invoice.status !== 'paid') {
      const daysLate = differenceInDays(new Date(), invoice.due_at)
      if (daysLate === 1 || daysLate === 7 || daysLate === 30) {
        await mailer.send(invoice.customer_email, `Reminder: ${daysLate} days`)
      }
    }
  }
}
```

To test "a reminder goes out on day 7 but not day 8" you would need a database, a
mailer and control of the clock — for a rule that is pure arithmetic.

```ts
// ✅ FIXED — the decision is a pure function
export function remindersDue(invoices: Invoice[], now: Date) {
  return invoices
    .filter((i) => i.status !== 'paid' && i.dueAt < now)
    .map((i) => ({ invoiceId: i.id, daysLate: differenceInDays(now, i.dueAt) }))
    .filter((r) => [1, 7, 30].includes(r.daysLate))
}

// the shell keeps the I/O and nothing else
async function sendOverdueReminders(companyId: string) {
  const invoices = await invoiceRepo.listForCompany(companyId)
  for (const due of remindersDue(invoices, clock.now())) {
    await mailer.sendReminder(due.invoiceId, due.daysLate)
  }
}
```

Now the rule — which days trigger a reminder, and that paid invoices are skipped
— is tested with an array literal and a fixed date. What remains in the shell is
four lines of obvious plumbing, and plumbing is what the integration test is for.

> **📌 Remember:** every `if` you move out of an `async` function is an `if` you
> can test in a microsecond.

That handles functions. It does not handle a service that genuinely needs the
database, the mailer and the clock — and a service that `import`s those directly
cannot be unit tested at all. Part 2 opens with exactly that problem.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| A "unit" test that opens a database | Slow, order-dependent, mislabelled | Move it to the integration suite |
| Testing a private via `service['helper']` | Blocks refactoring, proves nothing about callers | Test through the public method, or extract a real unit |
| Only testing the happy path | The bugs live at the boundaries | Add zero, the limit, one past it, and empty |
| `expect(() => fn()).toThrow()` with no type | A `TypeError` from a typo passes too | Assert the error class or code |
| Unit tests for CRUD controllers | There is no logic to assert | One API test covers that slice |
| `new Date()` inside the code under test | Unstable, timezone-sensitive, unfixable | Pass `now`, or inject a clock |
| Computing the expectation with the same formula | The test cannot disagree with the bug | Hand-compute the literal |
| `import { db } from '../db'` inside a service | Nothing can replace it in a test | Inject through the constructor |
| Floating-point money (`19.99`) | Rounding errors your tests will not agree on | Integer cents everywhere |
| One test asserting six unrelated behaviours | One failure hides the rest | One reason to fail per test |

---

## Questions to Test Yourself

1. State the working definition of a unit test. Why is it a definition about
   *cost* rather than about scope?
2. A colleague tests `service['calculateProration']` directly. Give two concrete
   problems this creates, and the two legitimate fixes.
3. Which `calculateInvoiceTotal` test catches someone applying tax to the
   subtotal instead of the prorated amount, and why is it the most valuable test
   in the file?
4. `Math.min(used, inPeriod)` is deleted in a refactor. Which test fails, and why
   could you not have found that bug by clicking through the app?
5. What does `expect(() => fn()).toThrow()` fail to prove? Give an example of
   broken code that passes it.
6. Define a pure function in one sentence and list three testing properties that
   follow from purity.
7. Describe `sendOverdueReminders` as impure shell / pure core. What is left in
   the shell, and what tests it?
8. A service starts with `import { db } from '../db'`. List everything you would
   have to set up to test one `if` statement inside it. Before reading Part 2,
   guess what change removes all of it.

---

> **➡️ Continued in [Part 2](02-unit-testing-part-2.md)** — the dependency
> problem and the injection that fixes it, controlling time and randomness,
> asserting behaviour instead of implementation, testing error types properly,
> table-driven tests, what TypeScript already proves, test organisation, and
> choosing a runner.

## Related

- [Part 2](02-unit-testing-part-2.md) — dependency injection, time, assertions,
  error paths, table-driven tests, TypeScript, organisation and runners.
- [01-testing-pyramid-part-1.md](01-testing-pyramid-part-1.md) — where unit tests
  sit and how many to have.
- [03-integration-and-api-testing-part-1.md](03-integration-and-api-testing-part-1.md)
  — the tests covering the plumbing this file deliberately left out.
- [04-test-data-and-mocking-part-2.md](04-test-data-and-mocking-part-2.md) — what
  `InMemoryMailer` is, and why a fake beats a mock.
- [02-service-layer-part-1.md](../09-application-architecture/02-service-layer-part-1.md)
  — the plain-input signature rule that makes services unit-testable.
- [05-dependency-injection-in-practice.md](../09-application-architecture/05-dependency-injection-in-practice.md)
  — wiring the injected dependencies up at startup.
- [01-error-taxonomy.md](../07-error-handling/01-error-taxonomy.md) — the
  `ValidationError` and `ConflictError` classes asserted on above.
- [03-repository-layer-part-1.md](../09-application-architecture/03-repository-layer-part-1.md)
  — the interface that makes an in-memory repository possible.
- [01-why-validation-matters.md](../04-validation-and-input/01-why-validation-matters.md)
  — which guards belong at the edge and which belong in the logic.
