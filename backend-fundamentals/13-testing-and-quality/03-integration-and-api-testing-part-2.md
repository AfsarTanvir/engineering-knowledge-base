# Integration & API Testing — Part 2

Part 1 built the machinery: a disposable database, isolation, and one endpoint
tested end to end. This part is the return on it — once the setup exists each
new test costs a few minutes, so the only question left is *which* tests to
spend them on. The answer is not "one per endpoint". It is a small, specific set that catches
the bugs a CRUD backend actually ships: a tenant reading another tenant's row, a
validation rule that silently passes, a password hash in a JSON response, a list
endpoint that loses a record between pages, and two simultaneous requests that
both succeed when only one should. Then the other half — what to fake, how to
fake it without lying to yourself, and how to keep the suite fast.

> **⬅️ This continues [Part 1](03-integration-and-api-testing-part-1.md).**

> **📌 In one line:** write the authorization test for every resource, assert
> the response body rather than glancing at it, and fake only what you do not
> own — keeping a few real calls to prove your fakes still resemble it.

## Table of Contents

1. [The Authorization Test Every Resource Needs](#the-authorization-test-every-resource-needs)
2. [Validation and Response Shape](#validation-and-response-shape)
3. [Pagination Boundaries and Empty Results](#pagination-boundaries-and-empty-results)
4. [Concurrency: Two Requests That Must Not Both Win](#concurrency-two-requests-that-must-not-both-win)
5. [Authentication in Tests](#authentication-in-tests)
6. [What Should Still Be Faked](#what-should-still-be-faked)
7. [Fake Drift, and Contract Testing](#fake-drift-and-contract-testing)
8. [End-to-End Tests, and Keeping the Suite Fast](#end-to-end-tests-and-keeping-the-suite-fast)
9. [Testing What Is Not HTTP](#testing-what-is-not-http)
10. [Common Mistakes](#common-mistakes)
11. [Questions to Test Yourself](#questions-to-test-yourself)
12. [Related](#related)

---

## The Authorization Test Every Resource Needs

**Every resource endpoint in a multi-tenant product should have a test that a
user from company A cannot reach company B's record.** Not most of them — every
one, including the ones you wrote this morning. The leak is invisible from the
inside: you develop as one user, in one company, and every screen works. The bug
is a missing `AND company_id = $2` in a query written while thinking about
something else, and it gets discovered by a customer pasting a URL outside their
company.

```ts
const theirProject = async () => createProject({
  companyId: (await createCompany()).id, name: 'Secret roadmap',
})

test('returns 404 for a project belonging to another company', async () => {
  const theirs = await theirProject()
  const { token } = await signedInUser()            // a different company

  const res = await api.get(`/projects/${theirs.id}`)
    .set('Authorization', `Bearer ${token}`)

  expect(res.status).toBe(404)
  expect(JSON.stringify(res.body)).not.toContain('Secret roadmap')
})

test('cannot rename another company project', async () => {
  const theirs = await theirProject()
  const { token } = await signedInUser()

  const res = await api.patch(`/projects/${theirs.id}`)
    .set('Authorization', `Bearer ${token}`).send({ name: 'Renamed' })

  expect(res.status).toBe(404)
  const row = await db('projects').where({ id: theirs.id }).first()
  expect(row.name).not.toBe('Renamed')              // nothing was written
})
```

Three details do real work. **404, not 403** — a `403` confirms the record
exists, which leaks that company B has a project with this id and lets someone
enumerate. Return `404` for "not yours" on anything id-addressable, and reserve
`403` for a resource the caller may legitimately know about but not act on, such
as a member of your own company without the `admin` role
([01-authn-vs-authz.md](../06-authorization/01-authn-vs-authz.md),
[02-rbac.md](../06-authorization/02-rbac.md)). **The body is searched for the
leaked value**, since a handler can return `404` and still include the record in
an error payload. **The write test asserts the row is unchanged**, because a
`404` from a handler that already wrote is a failure only the row can see.

Write these as a loop rather than by hand: a table of `[method, path, factory]`
and one `test.each` covers twenty endpoints in thirty lines, and the day someone
adds an endpoint without one the gap is visible —
[03-ownership-abac-and-multi-tenancy-part-1.md](../06-authorization/03-ownership-abac-and-multi-tenancy-part-1.md).

> **⚠️ Warning:** the role test is a separate test. "A viewer cannot delete a
> project *in their own company*" and "a user cannot touch another company's
> project" are different bugs with different causes, and one passing tells you
> nothing about the other.

---

## Validation and Response Shape

Two tests per endpoint, guarding opposite directions: what you accept, and what
you emit.

**Validation** is worth asserting because the common failure is not a rejected
request — it is an *accepted* one. A schema with `z.coerce.number()` and no
`.int().positive()` happily accepts `-4`; a missing `.max()` lets someone store
a 2 MB name. And when the rejection does happen, the *shape* of the error is
what the frontend renders.

```ts
test('rejects a negative budget with a field-level error', async () => {
  const { token } = await signedInUser()

  const res = await api.post('/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Redesign', budgetCents: -5_000 })

  expect(res.status).toBe(422)                       // not 400, not 500
  expect(res.body.error.code).toBe('VALIDATION_FAILED')
  expect(res.body.error.fields.budgetCents).toEqual(expect.any(String))
  expect(await db('projects').count()).toEqual([{ count: '0' }])
})
```

Assert the **status code**, the **stable error code**, **which field failed**
and that **nothing was stored**. Do not assert the human message; it will be
reworded, and rewording it should not break a test. See
[02-schema-validation.md](../04-validation-and-input/02-schema-validation.md) and
[03-client-facing-error-responses-part-1.md](../07-error-handling/03-client-facing-error-responses-part-1.md).

**Response shape** is the other direction, and the leak here is worse than a
wrong field name. The most common serious bug in a young API is returning the
database row.

```ts
test('never exposes the password hash or internal columns', async () => {
  const { user, token } = await signedInUser()

  const res = await api.get('/me').set('Authorization', `Bearer ${token}`)

  expect(res.status).toBe(200)
  expect(res.body).toEqual({                    // toEqual, not toMatchObject
    id: user.id, email: user.email, name: user.name, role: user.role,
  })
})
```

`toEqual` is deliberate, and this is the one place you want it: it fails on
*any* extra key, so the day someone adds `password_hash`, `deleted_at` or
`stripe_customer_id` to the serializer the test goes red instead of the field
going to production — `toMatchObject` would pass happily. Write it for every
endpoint returning a user, and for any resource with columns a customer should
not read. The serializer that makes it achievable is
[04-dtos-and-serialization-part-1.md](../09-application-architecture/04-dtos-and-serialization-part-1.md).

---

## Pagination Boundaries and Empty Results

Pagination is arithmetic, and arithmetic written at 6 PM is wrong at the edges.
The failure is quiet: a record that appears on both page 1 and page 2, or on
neither.

```ts
test('paginates without losing or repeating a record', async () => {
  const { company, token } = await signedInUser()
  for (let i = 1; i <= 25; i++) {
    await createProject({ companyId: company.id, name: `P${i}` })
  }
  const get = (page: number) => api.get(`/projects?page=${page}&perPage=10`)
    .set('Authorization', `Bearer ${token}`)

  const [p1, p2, p3] = await Promise.all([get(1), get(2), get(3)])

  expect(p1.body.data).toHaveLength(10)
  expect(p3.body.data).toHaveLength(5)             // the remainder, not 10
  expect(p1.body.meta).toMatchObject({ total: 25, page: 1, perPage: 10 })

  const all = [...p1.body.data, ...p2.body.data, ...p3.body.data].map(p => p.name)
  expect(new Set(all).size).toBe(25)               // none repeated, none lost
})

test('returns an empty array and a total of zero, not 404', async () => {
  const { token } = await signedInUser()           // a company with no projects
  const res = await api.get('/projects').set('Authorization', `Bearer ${token}`)

  expect(res.status).toBe(200)
  expect(res.body.data).toEqual([])
  expect(res.body.meta.total).toBe(0)
})
```

The set assertion earns its place. Three separate length checks can all pass
while page 2 repeats a row from page 1 — which happens whenever the query has no
deterministic `ORDER BY` and the planner changes its mind under load. Counting
distinct values catches exactly that, and it is the bug behind "the export is
missing customers". The empty case matters because the natural mistake is `404`:
an empty collection is a successful request with nothing in it, and a `404`
forces every client to special-case a normal state. Add a third test that an
absurd `?perPage=100000` is clamped rather than honoured — without it, one query
string is a free way to make your server serialize the entire table.

---

## Concurrency: Two Requests That Must Not Both Win

Some rules are only true under simultaneity: the last seat on a flight, the last
unit in stock, a wallet with £10 and two £8 withdrawals. You cannot produce that
by hand, and it is the class of bug that costs money directly. The test is
simpler than expected — fire both requests without awaiting the first, then
assert on the *pair* of outcomes and on the database.

```ts
test('two simultaneous bookings of the last slot: exactly one wins', async () => {
  const { company, token: a } = await signedInUser()
  const { token: b } = await signedInUser({ companyId: company.id })
  const slot = await createSlot({ companyId: company.id, capacity: 1 })

  const book = (t: string) => api.post(`/slots/${slot.id}/bookings`)
    .set('Authorization', `Bearer ${t}`).send({})

  // No await on the first — both are in flight before either resolves.
  const [one, two] = await Promise.all([book(a), book(b)])

  expect([one.status, two.status].sort()).toEqual([201, 409])
  const rows = await db('bookings').where({ slot_id: slot.id })
  expect(rows).toHaveLength(1)                    // the assertion that matters
})
```

Three things make this a real test rather than theatre. **Do not assert which
one wins** — either ordering is correct, so expecting the first request to get
the `201` makes the test flaky by design; sorting the statuses states the actual
requirement. **Assert the row count**, because the response pair can look right
while both rows were written, for instance if the handler catches a unique
violation and returns `409` after a partial write. And **it must not run under
rollback isolation**: two concurrent requests need to see each other's committed
writes, which inside one uncommitted transaction they cannot, so mark these for
truncation.

If the test fails with two `201`s, the fix is not in the test. It is a database
guarantee: a `UNIQUE` index, a `CHECK`, a `SELECT ... FOR UPDATE`, or an atomic
`UPDATE ... WHERE remaining > 0`. An application-level "check then insert" has a
gap between the two statements however careful the code looks —
[03-transactions-part-2.md](../10-database-integration/03-transactions-part-2.md).

> **💡 Tip:** fire ten, not two, and assert nine `409`s. A race that shows up
> sometimes shows up more often at ten.

---

## Authentication in Tests

Going through the full login flow in every test is slow (a real password hash is
~80 ms) and makes every test partly a test of login. Build a helper that
produces an authenticated request directly.

```ts
// tests/support/auth.ts
export async function signedInUser(overrides: Partial<NewUser> = {}) {
  const company = overrides.companyId
    ? { id: overrides.companyId } : await createCompany()
  const user = await createUser({ companyId: company.id, ...overrides })
  const token = await tokenService.issue({ sub: user.id, cid: company.id })
  return { company, user, token }        // the real signer, never a literal JWT
}
```

Use the **real token service**, not a hardcoded JWT: a hand-written token stops
matching the moment you rename a claim or rotate the algorithm, and the tests
then fail for a reason unrelated to the feature.

**The login flow still needs its own tests**, precisely because nothing else
exercises it any more. A correct email and password returns a token, and the
test proves it is usable by calling a real endpoint with it. A wrong password
returns `401` with the *same* message and roughly the same timing as an unknown
email, so the endpoint is not a user-enumeration oracle. A disabled account
cannot log in even with the right password. The rate limiter refuses the sixth
attempt in a minute. And a logout, or a password change, invalidates an existing
token. Those five are the security perimeter of the whole application, and the
helper above deliberately routes around them —
[01-owasp-top-10-for-apis.md](../11-api-security/01-owasp-top-10-for-apis.md).

---

## What Should Still Be Faked

The rule from Part 1: real if you own it and can run it in a container, faked
otherwise. In practice that is a short list.

| Boundary | Why it is faked | How |
|---|---|---|
| Payment provider (Stripe, Adyen) | Real charges cost real money; sandboxes rate-limit and flake | A fake implementing your `PaymentGateway` interface |
| Email and SMS (Postmark, Twilio); object storage (S3, R2) | Sends to real addresses and costs per message; slow, needs credentials, leaves artefacts | An in-memory mailer with a `sent` array; a temp directory or a `Map` |
| Any third-party HTTP API, and the clock | Their downtime becomes your red build; time-dependent rules flake at midnight | HTTP interception; an injected clock |

**A fake implementation of your own interface** is the better default. You
already have a `PaymentGateway` or `Mailer` port because the service takes it
through the constructor, so the test passes a different implementation: plain
code, type-checked against the same interface, holding state you assert on.

```ts
const mailer = new InMemoryMailer()
app.container.set('mailer', mailer)

test('sends exactly one welcome email on signup', async () => {
  await api.post('/signup').send({ email: 'new@acme.test', password: 'hunter22' })

  expect(mailer.sent).toHaveLength(1)
  expect(mailer.sent[0]).toMatchObject({ to: 'new@acme.test', template: 'welcome' })
})
```

**HTTP interception** is for libraries you cannot inject — a vendor SDK that
builds its own client deep inside. `msw` or `nock` registers handlers at the
network layer and answers the SDK's requests with a recorded payload. Use a real
captured response body, not one you invented, and make unmatched requests
**fail** rather than reach the network:

```ts
server.use(http.post('https://api.stripe.com/v1/payment_intents', () =>
  HttpResponse.json(STRIPE_PAYMENT_INTENT_FIXTURE, { status: 200 })))
server.listen({ onUnhandledRequest: 'error' })   // a forgotten handler is a bug
```

Fake the **failures** too, generously. A declined card, a `429`, a timeout, a
malformed body and a `500` cost one line of setup each, and they are the only way
to reach error-handling code you would otherwise first execute during an incident
— [02-centralized-error-handling-part-1.md](../07-error-handling/02-centralized-error-handling-part-1.md).

---

## Fake Drift, and Contract Testing

The honest warning that belongs with every fake: **it encodes your beliefs about
the provider's API on the day you wrote it.** The provider then renames a field,
deprecates a status value, adds a required parameter, or starts returning
`amount` as a string. Your suite stays green — it is testing your fake, and your
fake still agrees with itself — while production has been broken since Tuesday.
The better your fakes are, the more confidently wrong the suite becomes.

**A small, separate suite that makes real calls** is the defence you want
immediately. Five to ten tests against the provider's sandbox, hitting the calls
you depend on and asserting the response shape. They are slow and depend on
someone else's uptime, so they run nightly rather than on every push and are
**allowed to fail loudly**. A red nightly build saying `payment_intents.create
response no longer has 'charges'` is worth a great deal at 9 AM on a Wednesday.
Tag them so nobody puts them in the merge gate.

**Contract testing** is the principled version of the same idea, and the right
answer when the other side is a team rather than a vendor. The consumer records
its expectations as a machine-readable *pact* — "`GET /invoices/:id` returns
`total_cents` as a number" — generated from its own tests against a stubbed
provider, publishes it to a broker, and the **provider's CI verifies it against
the real implementation**. A breaking change then fails the provider's build
before it ships, rather than the consumer's afterwards.

| | Fake + nightly real calls | Contract testing |
|---|---|---|
| Works when | The other side is a vendor you cannot run | Both sides are yours, or a partner cooperates |
| Detects a break | Nightly, after they ship it | In the provider's CI, *before* they ship it |
| Setup cost, and when it is worth it | Minutes; always | A broker, a pact file, both CIs wired; two deployables or another team's client |

With one API and one frontend in one repository, the response-shape tests above
already give most of the value. Add the tooling when a second deployable
appears.

---

## End-to-End Tests, and Keeping the Suite Fast

An end-to-end test drives a real browser against a running stack, and it adds
one thing nothing else can: proof that the **frontend and backend agree** and
that the deployed system is wired together at all — session cookies, CORS, the
reverse proxy, environment variables. It also costs more than anything else you
will write: runtimes in tens of seconds, failures that say "timed out waiting
for a selector" without naming a cause, and a standing flakiness tax. So keep
**three to six**, covering only journeys whose failure means you have no
business — sign up, log in, the flow that takes money — run them after deploying
to staging rather than on every push, and when one fails resist adding a retry,
because an e2e flake is often a genuine race that users also hit.

A suite people do not run is worth nothing, and the threshold is roughly a
minute locally. **Parallelism** is the largest single win, and it requires each
worker to own a database or schema, or one truncates while another asserts
([05-seeding-and-test-data-part-2.md](../10-database-integration/05-seeding-and-test-data-part-2.md)).
**Never a real sleep**: `await sleep(200)` is 200 ms you pay on every run *and*
it fails anyway on a loaded CI runner, so wait for the condition — poll for the
row, await the promise, advance a fake timer, or expose a way to drain the queue
synchronously. **Create only what you assert on**, because the usual cause of a
slow suite is factories building object graphs nobody looks at. And **move the
slow things out of the inner loop**: a cheap bcrypt cost factor in tests, e2e
and real-provider suites behind separate commands, the default `npm test` kept
fast, and the slow ones on a schedule —
[github-actions.md](../../cloud-devops/ci-cd/github-actions.md).

---

## Testing What Is Not HTTP

A modern backend does plenty that no request triggers. The principle is
unchanged — drive the real entry point, assert on real state — but that entry
point is not a URL.

**Background jobs.** Call the handler directly with a job payload and assert the
state it produced. Test the three properties that actually break: it does the
work, it is **idempotent** (queues redeliver), and a failure leaves the system
consistent rather than half-written.

```ts
test('the invoice reminder job is idempotent', async () => {
  const invoice = await createInvoice({ status: 'overdue' })

  await sendReminderJob.handle({ invoiceId: invoice.id })
  await sendReminderJob.handle({ invoiceId: invoice.id })   // a redelivery

  expect(mailer.sent).toHaveLength(1)
  expect(await db('reminders').where({ invoice_id: invoice.id })).toHaveLength(1)
})
```

**Webhook handlers.** These are HTTP, so they get ordinary API tests — but with
a specific list. Post a **real captured payload**, not one you invented, and
assert that a bad or missing signature returns `401` and changes nothing, that a
replayed event is processed once, that an unknown event type is acknowledged
with `200` rather than erroring, and that a slow downstream still returns
quickly so the provider does not retry. All of those are in
[03-webhooks-part-1.md](../12-files-and-integrations/03-webhooks-part-1.md).

**Scheduled tasks.** The schedule is configuration — assert the cron expression
parses to what you meant — and the *work* is a plain function tested with an
injected clock. Two easily forgotten cases: the task is safe to run twice in the
same period, and it behaves when two app instances fire it simultaneously, which
is what happens the day you add a second server.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| No cross-tenant test, or `403` for another tenant's record | The leak is invisible while developing as one user; and `403` confirms the record exists, enabling enumeration | One authorization test per resource from a table, returning `404` for "not yours" and `403` only for a role failure inside your own tenant |
| Asserting the human error message, or `toMatchObject` on a user response | Messages get reworded; and an extra `password_hash` key passes happily | Assert status, stable `code` and the failing field; `toEqual` on the allowed keys |
| Only asserting page lengths, or `404` for an empty collection | Page 2 can repeat page 1 with every length correct; empty is a normal state | Count distinct ids across pages; `200` with `[]` and `total: 0` |
| Asserting *which* concurrent request wins, or running it under rollback | Either ordering is correct; and the requests cannot see each other's writes | Sort the statuses, assert the row count, mark it for truncation |
| A hardcoded JWT in the helper, or skipping login tests because it exists | It breaks when a claim changes, and the helper routes around your security perimeter | Mint with the real token service; test login, lockout and enumeration separately |
| Letting unmatched requests reach the network, faking only a provider's success path, or trusting fakes with no real calls | A forgotten handler becomes a real call from CI; error handling is first run during an incident; and the suite tests your beliefs, not the provider | `onUnhandledRequest: 'error'`, fake the decline, `429`, timeout and `500`, and add a nightly sandbox suite outside the merge gate |
| Dozens of end-to-end tests, or `await sleep(200)` anywhere | Slow and flaky, naming no cause when they fail; and a sleep costs 200 ms per run and fails under load anyway | Three to six critical journeys; wait for the condition or drain the queue |

---

## Questions to Test Yourself

1. Why should the cross-tenant test exist for *every* resource, why is `404`
   the right status rather than `403`, and why does the update version assert
   on the database row as well?
2. Why is `toEqual` the right matcher for a user response when `toMatchObject`
   is right almost everywhere else?
3. Three length assertions on three pages all pass. Name the pagination bug
   that survives, and the one assertion that catches it.
4. Write the shape of a test proving two simultaneous bookings cannot both
   succeed. Why must you not assert which one wins, why can it not run under
   rollback isolation, and why is a two-`201` failure not fixed in an `if`?
5. Why mint the test token with the real token service rather than hardcoding
   one? Name three login behaviours the helper leaves untested.
6. Define fake drift. Describe the smallest thing you can do about it, why that
   suite must not run in the merge gate, and what contract testing adds.
7. Write the two-line test that proves a background job survives redelivery,
   then name four things a webhook test should cover beyond the happy path.

---

> **⬅️ This continues [Part 1](03-integration-and-api-testing-part-1.md)** — why
> the database must be real, getting one cheaply, test isolation, and your first
> API test end to end.

## Related

- [Part 1](03-integration-and-api-testing-part-1.md) — the real-database
  argument and the setup every test here assumes; and
  [04-test-data-and-mocking-part-2.md](04-test-data-and-mocking-part-2.md) for
  the test doubles, and why a fake beats a mock.
- [03-ownership-abac-and-multi-tenancy-part-1.md](../06-authorization/03-ownership-abac-and-multi-tenancy-part-1.md)
  and [02-rbac.md](../06-authorization/02-rbac.md) — the rules the
  authorization tests enforce, and `404` versus `403`.
- [04-dtos-and-serialization-part-1.md](../09-application-architecture/04-dtos-and-serialization-part-1.md)
  — the layer that keeps `password_hash` out of a response.
- [02-schema-validation.md](../04-validation-and-input/02-schema-validation.md)
  and
  [03-client-facing-error-responses-part-1.md](../07-error-handling/03-client-facing-error-responses-part-1.md)
  — the schemas and error bodies asserted on.

- [03-transactions-part-2.md](../10-database-integration/03-transactions-part-2.md)
  and
  [05-seeding-and-test-data-part-2.md](../10-database-integration/05-seeding-and-test-data-part-2.md)
  — the locking the concurrency test needs, and the isolation it needs.
- [03-webhooks-part-1.md](../12-files-and-integrations/03-webhooks-part-1.md),
  [01-owasp-top-10-for-apis.md](../11-api-security/01-owasp-top-10-for-apis.md)
  and [github-actions.md](../../cloud-devops/ci-cd/github-actions.md) —
  signature verification and replay, the login failures these tests prevent,
  and the fast gate on every push with the slow suites on a schedule.
