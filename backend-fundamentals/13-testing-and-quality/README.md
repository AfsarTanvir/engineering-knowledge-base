# Part 13 — Testing & Quality

You have built the feature. It works — you clicked through it. Now you change
one line in the invoice service, and you have no idea what else you just broke.
So you click through it again. And again. Every deploy, forever.

That is the problem this part solves. Tests are not paperwork you write to
please a senior developer. They are the thing that lets you **change code
without fear**. A test suite is a machine that clicks through every feature in
your app in twenty seconds, every time you save a file.

This part is written for someone who has never written a test and is not yet
convinced they are worth the time. So it leads with value. It shows the tests
that actually catch bugs in a CRUD-heavy SaaS product — authorization leaks
between companies, validation that silently passes, a migration that does not
match your model, a password hash in a JSON response — and it skips the tests
that catch nothing.

> **📌 The whole part in one line:** write a small number of tests that exercise
> real code against a real database, name them after the behaviour they protect,
> and fake only the things you do not own.

## Files

1. [The Testing Pyramid — Part 1](01-testing-pyramid-part-1.md) — why tests
   exist at all, what a test actually is, the four test types applied to one
   feature, and the pyramid vs the trophy.
2. [The Testing Pyramid — Part 2](01-testing-pyramid-part-2.md) — what is worth
   testing, why coverage percentage lies, the shape and naming of a good test,
   flaky tests, and a starting plan for someone with zero tests today.
3. [Unit Testing — Part 1](02-unit-testing-part-1.md) — testing one piece of
   business logic in milliseconds: what counts as a unit, a worked example on
   real business rules, and pushing logic toward purity.
4. [Unit Testing — Part 2](02-unit-testing-part-2.md) — dependency injection,
   controlling time and randomness, asserting behaviour instead of
   implementation, table-driven tests, and what TypeScript already proves for
   you.
5. [Integration & API Testing — Part 1](03-integration-and-api-testing-part-1.md)
   — the tests that find the most bugs per hour: a real HTTP request through
   real routing, validation, services and a **real database**. Why mocking the
   database hides the bugs you most need to find, how to isolate tests, and
   your first API test end to end.
6. [Integration & API Testing — Part 2](03-integration-and-api-testing-part-2.md)
   — the test cases every endpoint deserves: authorization, validation,
   response shape, pagination and concurrency; plus what to fake, contract
   testing, and keeping the suite fast.
7. [Test Data & Mocking — Part 1](04-test-data-and-mocking-part-1.md) —
   factories instead of fixtures, making the relevant data explicit, the giant
   shared fixture, and why test-order dependence is a bug.
8. [Test Data & Mocking — Part 2](04-test-data-and-mocking-part-2.md) — the
   five kinds of test double explained precisely, state verification vs
   behaviour verification, when mocking is right and when it quietly destroys
   your suite, in-memory fakes, and a final checklist.

## Read in this order

Read 1 → 8 in order, one file per sitting. Files 1–2 make the case and give you
vocabulary. Files 3–4 are the cheapest test to write. Files 5–6 are the tests
that find the most real bugs — if you only ever act on one topic in this part,
act on that one. Files 7–8 are the maintenance manual that keeps the suite from
rotting.

## What you should be able to do after this part

- Explain to a teammate why a 92% coverage number can still mean the critical
  path is untested.
- Write an integration test that hits a real endpoint with a real database and
  asserts both the HTTP response and the resulting row.
- Say precisely why mocking your own database is a bad idea, and name three
  bugs a mocked test cannot catch.
- Take a service that is impossible to test — it imports the database, the
  mailer and `new Date()` directly — and make it testable by injecting those.
- Choose between a stub, a fake and a mock for any dependency, and justify it.
- Diagnose a flaky test and name its cause: time, randomness, shared state,
  ordering, or a real network call.

## Where this connects

- **Testability is an architecture property.** Everything in Part 9 —
  [Application Architecture](../09-application-architecture/) — exists partly so
  that this part is possible. Hard-to-test code is usually badly layered code.
- **The database side** of test setup — migrations, seeding, transactions —
  lives in Part 10 — [Database Integration](../10-database-integration/).
- **Tests as a deploy gate** belong to CI:
  [ci-cd/overview.md](../../cloud-devops/ci-cd/overview.md). A disposable test
  database comes from [docker/overview.md](../../cloud-devops/docker/overview.md).
- The specific things worth asserting come from earlier parts: status codes
  (Part 1), validation errors (Part 4), authorization rules (Part 6), and error
  shapes (Part 7).

## Next

This is the last part of the track. After it, the loop closes: you can design a
backend feature, build it, and prove it works without opening a browser.
