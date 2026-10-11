# Unit Testing — Part 2

Part 1 tested a pure function and it was easy, because a pure function has
nothing to hide. Real services are not pure: they read the database, send email,
and ask what time it is. This part is about making that code testable anyway,
and then about the craft — what to assert, how to test error paths, how to cover
twenty cases without writing twenty tests, and how to lay the files out so the
suite stays readable.

> **⬅️ This continues [Part 1](02-unit-testing-part-1.md).**

> **📌 In one line:** anything your code reaches for without being given — the
> database, the mailer, the clock, the random source — is why it is hard to
> test, and passing it in is the whole fix.

## Table of Contents

1. [The Dependency Problem](#the-dependency-problem)
2. [The Design Fix, and the Test It Makes Possible](#the-design-fix-and-the-test-it-makes-possible)
3. [Time: the Most Common Source of Flaky Tests](#time-the-most-common-source-of-flaky-tests)
4. [Randomness](#randomness)
5. [Assert Behaviour, Not Implementation](#assert-behaviour-not-implementation)
6. [Testing Error Paths Deliberately](#testing-error-paths-deliberately)
7. [Table-Driven Tests](#table-driven-tests)
8. [What TypeScript Already Proves](#what-typescript-already-proves)
9. [Organising Test Files, and Choosing a Runner](#organising-test-files-and-choosing-a-runner)
10. [Shared Setup vs Explicit Setup](#shared-setup-vs-explicit-setup)
11. [Common Mistakes](#common-mistakes)
12. [Questions to Test Yourself](#questions-to-test-yourself)
13. [Related](#related)

---

## The Dependency Problem

A service legitimately needs the database, the mailer and the clock. The
question is *how* it gets them, and there are exactly two answers: it can import
them, or be given them. Here is the version that cannot be unit tested:

```ts
// ❌ BROKEN — imports the world
import { db } from '../db'
import { mailer } from '../mailer'
export class SubscriptionService {
  async startTrial(userId: string) {
    const existing = await db.subscriptions.findByUser(userId)
    if (existing) throw new ConflictError('Already subscribed', 'ALREADY_SUBSCRIBED')
    const sub = await db.subscriptions.create({ userId, status: 'trialing',
      startedAt: new Date(),
      trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000) })
    await mailer.send(userId, 'Your trial has started')
    return sub
  }
}
```

Now try to write `refuses a second trial for a user who already has a
subscription`. You must start a database, run migrations, insert a user and a
subscription, and stop a real email going out — thirty seconds of setup for a
rule that is one `if`. No trick fixes it: the `import` is a hard-wired decision
made at module load, before your test gets a say.

| Symptom | Root cause |
|---|---|
| Need a database for a one-line rule, or a test sends a real email | Repository and mailer imported, not injected |
| Cannot test "expires after 14 days" without waiting | `new Date()` called inline |
| Cannot test the "email failed" path | No way to make the mailer fail |
| Tests interfere with each other | Shared module-level singletons |

Some runners offer an escape hatch — intercepting module loading so `../db`
resolves to a fake. It works, and it is the wrong tool: the test now depends on
the *file path* of a module your service happens to import, so moving that file
breaks unrelated tests. Reserve it for third-party packages you cannot inject —
[04-test-data-and-mocking-part-2.md](04-test-data-and-mocking-part-2.md).

---

## The Design Fix, and the Test It Makes Possible

The fix is one line of design: **take dependencies through the constructor.**

```ts
// ✅ FIXED — every dependency is visible and replaceable
export type Clock = { now(): Date }
export class SubscriptionService {
  constructor(
    private subscriptions: SubscriptionRepository,
    private mailer: Mailer,
    private clock: Clock,
  ) {}
  async startTrial(userId: string) {
    const existing = await this.subscriptions.findByUser(userId)
    if (existing) throw new ConflictError('Already subscribed', 'ALREADY_SUBSCRIBED')
    const now = this.clock.now()
    const sub = await this.subscriptions.create({ userId, status: 'trialing',
      startedAt: now, trialEndsAt: addDays(now, 14) })
    await this.mailer.send(userId, 'Your trial has started')
    return sub
  }
}
```

The logic did not change. The constructor now *states* what this class needs —
the best documentation it will ever have — and wiring it at startup is one call
in a composition root
([05-dependency-injection-in-practice.md](../09-application-architecture/05-dependency-injection-in-practice.md)).
The test now needs no infrastructure at all:

```ts
function makeService(existing: Subscription[] = []) {
  const mailer = new InMemoryMailer()
  const subs = new InMemorySubscriptionRepository(existing)
  const clock = { now: () => new Date('2026-03-01T00:00:00Z') }
  return { service: new SubscriptionService(subs, mailer, clock), mailer }
}

test('refuses a second trial for a user who already has a subscription', async () => {
  const { service } = makeService([{ userId: 'u_1', status: 'active' }])
  await expect(service.startTrial('u_1'))
    .rejects.toMatchObject({ code: 'ALREADY_SUBSCRIBED' })
})
test('sends a welcome email to the new trial user', async () => {
  const { service, mailer } = makeService()
  await service.startTrial('u_1')
  expect(mailer.sent.map((m) => m.to)).toEqual(['u_1'])
})
```

Two tests, no container, roughly two milliseconds. `InMemorySubscriptionRepository`
and `InMemoryMailer` are **fakes** — small real implementations of the same
interface, not mocks told what to return
([04-test-data-and-mocking-part-2.md](04-test-data-and-mocking-part-2.md)).

> **⚠️ Warning:** this does not leave the real repository untested. It moves that
> test to where it can happen — against a real database, in an integration test.
> Injection relocates the test, it does not remove it.

---

## Time: the Most Common Source of Flaky Tests

Time produces more untestable code and more flaky suites than anything else.
Take the rule **an invitation expires 7 days after it is sent**:

```ts
// ❌ BROKEN — a test that takes seven days
test('an invitation expires after 7 days', async () => {
  const invite = await service.invite('new@acme.test')
  await sleep(7 * 24 * 60 * 60 * 1000)     // 604,800,000 ms
  expect(await service.isValid(invite.token)).toBe(false)
})
```

Nobody writes exactly that, but people write its two cousins. The first sets
`INVITE_TTL_SECONDS=1` "for testing" and sleeps 1.1 seconds — slow, flaky the
moment CI is loaded, and no longer testing the real rule. The second
monkey-patches global `Date.now`, which every other test in the process shares:
if an assertion throws before the restore line, every later test runs in the
future. There are two good answers, and **injecting a clock** is the default
because it needs no framework support:

```ts
// ✅ FIXED — time is a dependency
function invitedOn(iso: string) {
  const clock = mutableClock(iso)
  return { clock, service: new InviteService(repo, clock) }
}

test.each([
  { name: 'is still valid on day 6',        at: '2026-03-07T00:00:00Z', valid: true },
  { name: 'expires 7 days after it is sent', at: '2026-03-08T00:00:01Z', valid: false },
])('an invitation $name', async ({ at, valid }) => {
  const { clock, service } = invitedOn('2026-03-01T00:00:00Z')
  const invite = await service.invite('new@acme.test')
  clock.set(at)
  expect(await service.isValid(invite.token)).toBe(valid)
})
```

Instant, exact, and testing *both* sides of the boundary — a single "expires"
test checking only the far side would pass even if the TTL were one hour.

**Freeze time with fake timers** when the code is third-party and nothing can be
injected: `vi.useFakeTimers({ now })` in `beforeEach`,
`vi.advanceTimersByTimeAsync(30_000)` to jump a retry backoff without waiting,
and `vi.useRealTimers()` in `afterEach` so the next test is not stranded.

| Technique | Use when | Watch out for |
|---|---|---|
| Injected clock | Your own code | Nothing — this is the default |
| Fake timers | A library calls `setTimeout` or `Date` internally | Must restore in `afterEach` |
| Real `sleep` | Never, without exception | Slow, and flaky under CI load |

> **💡 Tip:** set `TZ=UTC` for the whole run and assert dates as ISO strings.
> Half of "works on my machine" date failures are a developer in UTC+6 and a CI
> runner in UTC.

---

## Randomness

The same argument, shorter: code calling `Math.random()` inline cannot be tested
for anything depending on the value.

```ts
// ❌ BROKEN — unpredictable, so the test cannot assert the outcome
function assignReviewer(candidates: User[]) {
  return candidates[Math.floor(Math.random() * candidates.length)]
}
// ✅ FIXED — the random source is a parameter
type Random = { next(): number }   // [0, 1)
function assignReviewer(candidates: User[], random: Random) {
  return candidates[Math.floor(random.next() * candidates.length)]
}

test('never picks past the end of the list when the draw is almost 1', () => {
  expect(assignReviewer([alice, bob], { next: () => 0.999999 })).toBe(bob)
})
```

That test is the point: with real randomness the off-by-one fails one run in a
million, exactly the bug that surfaces in production and never reproduces. The
same applies to generated ids — inject an `IdGenerator` when a test must assert
one, otherwise assert on the id you were handed, never a literal.

---

## Assert Behaviour, Not Implementation

This is where unit tests most often go wrong, and the reason people end up
believing tests make refactoring harder. They do — if you assert the wrong thing.

```ts
// ❌ BROKEN — asserts how the work was done
test('registerUser', async () => {
  const repo = { create: vi.fn().mockResolvedValue({ id: 'u_1' }), findByEmail: vi.fn() }
  const hasher = { hash: vi.fn().mockResolvedValue('hashed') }
  const service = new UserService(repo, hasher, { send: vi.fn() })
  await service.registerUser({ email: 'a@acme.test', password: 'secret123' })

  expect(hasher.hash).toHaveBeenCalledWith('secret123')
  expect(repo.create).toHaveBeenCalledWith({ email: 'a@acme.test',
    passwordHash: 'hashed', status: 'pending' })
})
```

Every assertion is an implementation detail. Add a `createdAt` field and
`toHaveBeenCalledWith` fails although nothing broke; rename `hash()` to
`hashWithPepper()` and it fails; normalise the email to lowercase — a genuine
improvement — and it fails. Meanwhile it cannot notice whether the hash was ever
stored, because `repo.create` was a mock and no user exists anywhere.

```ts
// ✅ FIXED — asserts the outcome a caller can observe
test('stores the user with a hashed password, never the plain text', async () => {
  const { service, users } = makeUserService()
  await service.registerUser({ email: 'a@acme.test', password: 'secret123' })
  const stored = await users.findByEmail('a@acme.test')
  expect(stored!.passwordHash).not.toContain('secret123')
  expect(await verify('secret123', stored!.passwordHash)).toBe(true)
  expect(stored!.status).toBe('pending')
})
```

The fixed test survives every refactor above and fails for real reasons. It also
reads like a requirement, which is the tell: *stores the user with a hashed
password* is something a product manager could confirm; *`hasher.hash` was called
with `'secret123'`* is not. The one legitimate exception is when **the call
itself is the requirement** — "charges the card exactly once, even if the handler
runs twice" is a statement about an interaction with a system you cannot inspect,
so asserting the call count is correct there.

---

## Testing Error Paths Deliberately

Error paths are the least exercised code in any application, because you never
reach them by hand, and they are where wrong status codes and swallowed
exceptions hide. Assert the *type and code*, not merely that something threw:

```ts
// ❌ BROKEN — passes when a TypeError from a typo is thrown
await expect(service.startTrial('u_1')).rejects.toThrow()
// ❌ BROKEN — passes if the message is reworded, breaks if it is improved
await expect(service.startTrial('u_1')).rejects.toThrow('Already subscribed')
// ✅ FIXED — the class and the stable machine-readable code
await expect(service.startTrial('u_1'))
  .rejects.toMatchObject({ code: 'ALREADY_SUBSCRIBED', status: 409 })
```

The `code` is the stable part of an error's contract — the message is prose that
will be rewritten, and the class may move — so asserting it means asserting what
clients actually branch on
([01-error-taxonomy.md](../07-error-handling/01-error-taxonomy.md)).

Two more habits worth having: test that a *dependency's* failure is handled — a
fake that throws is one line, and the only way to reach that branch — and assert
what did **not** happen, when that is the rule:

```ts
test('does not create a subscription when the user is already subscribed', async () => {
  const { service, subscriptions } = makeService([{ userId: 'u_1', status: 'active' }])
  await expect(service.startTrial('u_1')).rejects.toThrow(ConflictError)
  expect(subscriptions.rows).toHaveLength(1)   // no second row was written
})

test('wraps a mailer outage rather than leaking the provider error', async () => {
  const mailer = { send: async () => { throw new Error('ECONNREFUSED') } }
  await expect(new SubscriptionService(repo, mailer, clock).startTrial('u_1'))
    .rejects.toMatchObject({ code: 'EXTERNAL_SERVICE_ERROR', service: 'mailer' })
})
```

> **⚠️ Warning:** `expect(fn()).rejects` without `await` in front of `expect`
> silently passes. Turn on the lint rule for floating promises — this is the most
> common silently-broken async test there is.

---

## Table-Driven Tests

When cases are similar, writing a `test()` block each is boring enough that you
stop after three. A table makes each case cost one line, which is what makes
thorough edge-case testing affordable.

```ts
describe('calculateInvoiceTotal — discount, proration and tax matrix', () => {
  const cases = [
    { name: '100% discount',         options: { discountPercent: 100 },                      expected: 0 },
    { name: 'tax after discount',    options: { discountPercent: 10, taxRatePercent: 15 },   expected: 10_350 },
    { name: 'half period',           options: { proratedDays: { used: 15, inPeriod: 30 } },  expected: 5_000 },
    { name: 'over-used period caps', options: { proratedDays: { used: 40, inPeriod: 30 } },  expected: 10_000 },
    { name: 'zero days used',        options: { proratedDays: { used: 0,  inPeriod: 30 } },  expected: 0 },
  ]

  test.each(cases)('$name → $expected cents', ({ options, expected }) => {
    const lines = [{ description: 'Retainer', amountCents: 10_000 }]
    expect(calculateInvoiceTotal(lines, options).totalCents).toBe(expected)
  })
})
```

Five cases, one assertion, each reporting under its own name: a failure says
`over-used period caps → 10000 cents`, not `test 4`. Adding the sixth costs one
line, which is the whole point.

| Table-driven tests are right when | They are wrong when |
|---|---|
| Cases differ only in input and expected output, and adding one costs a line | Each case needs different setup, asserts something different, or grows special-case fields |

> **💡 Tip:** the moment a row needs an `if` in the test body or a `skip` flag,
> pull that case into its own named `test()` — a table with branches is worse
> than the tests it replaced.

---

## What TypeScript Already Proves

TypeScript removes a whole category of test, and writing those anyway is pure
cost. But the guarantee stops at the process boundary, and knowing exactly where
keeps you from testing the wrong half.

| TypeScript already guarantees | So do not test |
|---|---|
| `amountCents` is a `number` at every compiled call site, and a literal has all required fields | "throws when passed a string"; "throws when `email` is missing", for internal callers |
| A `switch` over a union is exhaustive (with a `never` check), and arity and `readonly` hold in your own code | "handles an unknown status"; argument-count and immutability tests |

| TypeScript does **not** guarantee | So you must test |
|---|---|
| JSON from an HTTP request matches its declared type | Validation at the edge — [02-schema-validation.md](../04-validation-and-input/02-schema-validation.md) |
| A database row matches your model after a migration | An integration test against the real schema |

| A third-party library's types match its runtime, or that `as` casts and `any` are true | A thin boundary test on your wrapper, and everything downstream of a cast |

The rule: **where data crosses into your process from outside, the type system
is an assumption, and only a runtime check makes it a fact.** `await
request.json() as CreateInvoiceInput` compiles, nothing checked it, and it is a
lie waiting to happen —
[unknown-any.md](../../typescript-fundamentals/unknown-any/unknown-any.md) seen
from the test side.

---

## Organising Test Files, and Choosing a Runner

Two layouts work; pick one and be consistent.

| Layout | Looks like | Good for |
|---|---|---|
| **Co-located** | `src/billing/calculate-total.ts` + `calculate-total.test.ts` | Unit tests — visible when you open the folder, and moving the module moves its test |
| **Separate tree** | `tests/integration/billing.spec.ts` | Integration and e2e suites, which need their own setup and command |

A good default: unit tests co-located as `*.test.ts`, integration tests under
`tests/integration/*.spec.ts`, so `npm run test:unit` is instant and can stay in
watch mode. Inside a file, `describe` names the subject and nests at most one
level — at three you can no longer see the setup that applies to the test you
are reading, and the file wants splitting.

Any runner is fine, and this is not worth a day of anyone's time — everything in
these two files works in all four with the import lines changed.

| Runner | Use it when | Notes |
|---|---|---|
| **Vitest** | New TypeScript projects, anything on Vite | Fastest feedback, ESM and TS out of the box, Jest-compatible API |
| **Jest** | A project already using it | Huge ecosystem; TS and ESM setup takes more configuration |
| **`node:test`** | You want zero dependencies | Built in since Node 18; fewer matchers, thinner watch mode |
| **Japa** | AdonisJS applications | Ships with the framework, knows its HTTP and database helpers |

---

## Shared Setup vs Explicit Setup

`beforeEach` is genuinely useful and genuinely dangerous: the cost is that a
reader of one test cannot see the data it depends on.

```ts
// ❌ BROKEN — why does this pass?
beforeEach(async () => {
  service = new SubscriptionService(
    new InMemorySubscriptionRepository([{ userId: 'u_1', status: 'cancelled' }]),
    new InMemoryMailer(), { now: () => new Date('2026-03-01T00:00:00Z') })
})

test('allows a new trial', async () => {
  await expect(service.startTrial('u_1')).resolves.toBeTruthy()
})
```

It passes because the existing subscription is `cancelled` — a fact buried in
setup every other test also uses, so changing it for one test breaks five.

```ts
// ✅ FIXED — a builder in setup, the relevant fact in the test
test('allows a new trial when the previous subscription was cancelled', async () => {
  const service = makeService([{ userId: 'u_1', status: 'cancelled' }])
  await expect(service.startTrial('u_1')).resolves.toBeTruthy()
})
```

The rule: **put construction in shared setup, put the data the test is about in
the test.** If the name says "cancelled", the word must be visible in the body —
developed further in
[04-test-data-and-mocking-part-1.md](04-test-data-and-mocking-part-1.md).

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| `import { db }` inside a service, or module-level mocking of your own code | Nothing can replace it in a test; and mocking a module couples tests to file paths | Inject through the constructor; reserve module mocking for third-party packages |
| `await sleep(...)`, or monkey-patching global `Date` without restoring | Slow and flaky under CI load; and a frozen clock leaks into every later test | An injected clock, or fake timers with `afterEach(() => vi.useRealTimers())` |
| Only asserting the far side of an expiry, or `Math.random()` inline | A one-hour TTL would pass; and you cannot aim at the 1-in-a-million case | Test day 6 valid and day 8 invalid; inject a random source |
| `toHaveBeenCalledWith(...)` for everything | Breaks on harmless refactors | Assert the observable outcome |
| `rejects.toThrow()` with no type, `expect(...).rejects` without `await`, or testing that a `number` parameter rejects a string | A `TypeError` from a typo passes; a floating rejection always passes; and TypeScript already proved the third | `await expect(...).rejects.toMatchObject({ code })`, and test the runtime boundary instead |
| `beforeEach` holding the fact the test is about | Unreadable and fragile | Construction in setup, distinguishing data in the test |

---

## Questions to Test Yourself

1. A service imports `db` and `mailer`. List everything you must set up to test
   one `if` statement, say what constructor injection removes, and explain why
   module-level mocking of the repository is a worse fix than injecting it.
2. Write the two cases that properly pin down "an invitation expires after 7
   days". Why is one not enough, and give two ways global `Date`
   monkey-patching breaks a test that is not the one doing the patching.
3. `expect(hasher.hash).toHaveBeenCalledWith('secret123')` passes. Name two
   harmless refactors that break it, one real bug it cannot catch, and the one
   situation where asserting a call *is* correct.
4. What does `rejects.toThrow()` fail to prove, and why assert the `code`
   rather than the message? When is a table-driven test the wrong tool?
5. Name three things TypeScript proves so you need no test, three places its
   guarantee stops at runtime, and the rule broken by a test named `allows a
   new trial` that passes because of a `cancelled` status set in `beforeEach`.

---

> **⬅️ This continues [Part 1](02-unit-testing-part-1.md)** — the working
> definition, choosing a unit, a worked example on invoice totals, and pushing
> logic toward purity.

## Related

- [Part 1](02-unit-testing-part-1.md) — what a unit test is, with a worked
  example on real business logic.
- [05-dependency-injection-in-practice.md](../09-application-architecture/05-dependency-injection-in-practice.md)
  — composing injected dependencies at startup, and injecting the clock.
- [04-test-data-and-mocking-part-2.md](04-test-data-and-mocking-part-2.md) and
  [Part 1](04-test-data-and-mocking-part-1.md) — fakes versus mocks, when module
  mocking is defensible, and keeping the relevant data visible in the test.
- [03-integration-and-api-testing-part-1.md](03-integration-and-api-testing-part-1.md)
  — where the real repository and the real SQL get tested.
- [01-error-taxonomy.md](../07-error-handling/01-error-taxonomy.md) — the error
  classes and stable `code` values worth asserting on.
- [unknown-any.md](../../typescript-fundamentals/unknown-any/unknown-any.md) and
  [02-schema-validation.md](../04-validation-and-input/02-schema-validation.md)
  — turning an assumed type into a checked fact at the boundary.
- [01-testing-pyramid-part-2.md](01-testing-pyramid-part-2.md) — flaky tests and
  their causes, including every one in this file.
