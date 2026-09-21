# Error Response Design

A good hospital has one triage form. Whatever walks through the door — a
broken arm, a fever, a car crash — the same sheet is filled in: what happened,
how serious, which department, and a case number. Nobody invents a new form
per patient, because the people downstream read hundreds a day.

Your API's error body is that triage form. Every client you will ever have —
your React app, a mobile app, a partner's integration — must read it. If each
endpoint invents its own shape, every client writes custom parsing for every
endpoint, forever.

> **📌 In one line:** the status code says *what kind* of failure it was, and
> one consistent JSON body says *which* failure, *why*, and *how to talk to
> support about it* — and that body must look identical on every endpoint.

## Table of Contents

1. [Why One Shape Matters](#why-one-shape-matters)
2. [The Error Body, Field by Field](#the-error-body-field-by-field)
3. [`code` Is the Contract, `message` Is Not](#code-is-the-contract-message-is-not)
4. [Field-Level Validation Errors](#field-level-validation-errors)
5. [RFC 7807: `application/problem+json`](#rfc-7807-applicationproblemjson)
6. [Mapping Internal Errors to Status Codes](#mapping-internal-errors-to-status-codes)
7. [What Must Never Appear in an Error](#what-must-never-appear-in-an-error)
8. [BROKEN vs FIXED: the Login That Leaks Accounts](#broken-vs-fixed-the-login-that-leaks-accounts)
9. [Localization: Who Translates?](#localization-who-translates)
10. [Advanced: Retries and Partial Failure](#advanced-retries-and-partial-failure)
11. [Common Mistakes](#common-mistakes)
12. [Questions to Test Yourself](#questions-to-test-yourself)
13. [Related](#related)

---

## Why One Shape Matters

Here is a real API with three endpoints written by three developers over two
years. All three responses mean "the input was wrong".

```json
{ "error": "Title is required" }
{ "success": false, "errors": ["title: required", "dueDate: past"] }
{ "status": "fail", "data": { "title": ["The title field is required."] } }
```

Now write the client. It must check `error`, then `errors`, then `data`, and
handle a string, an array of strings, and an object of arrays — in the mobile
app, in the web app, and in the partner's integration.

| Cost of inconsistency | What it looks like in practice |
|---|---|
| Silent failures | An unhandled shape becomes "Something went wrong" |
| Frozen design | Fixing the shape later breaks every client |

One shape, applied everywhere, reduces every client's error handling to a
single `parseError()` written once.

> **📌 Remember:** consistency beats cleverness. A mediocre shape used by 100%
> of your endpoints is worth far more than a beautiful shape used by 60%.

---

## The Error Body, Field by Field

Here is the shape this track uses. It is small on purpose.

```json
{
  "error": {
    "code": "validation_failed",
    "message": "The request could not be processed. Check the listed fields.",
    "details": [
      { "field": "dueDate",    "code": "date_in_past", "message": "Due date must be today or later." },
      { "field": "assigneeId", "code": "not_a_member", "message": "That user is not a member of this project." }
    ],
    "request_id": "req_01JB6Z9Q7K3M8T1V2W5X4Y6Z7A"
  }
}
```

| Field | Required | Read by | Rule |
|---|---|---|---|
| `error.code` | ✅ always | machines | Stable `snake_case`; the meaning never changes |
| `error.message` | ✅ always | humans | May change any time; never parsed |
| `error.details` | multi-part failures | machines + UI | Array, never an object keyed by field |
| `error.request_id` | ✅ always | support | Matches a log line on the server |

Four deliberate decisions hide in that table.

**The envelope.** Everything sits under one `error` key, so a client writes
`if ('error' in body)` once. Without it you test for the *absence* of a
success field, which is a weaker test.

**`details` is an array, not an object.** An object keyed by field name cannot
hold two problems with the same field, and cannot hold an error with no field
at all — such as "your plan does not allow more than 3 projects".

**`request_id` on every error, including `500`s.** The highest-value field in
the body, and the one most often missing. A user pastes `req_01JB6Z…` into a
support chat; you paste it into log search; you see the exact stack trace.

**No `success: false`.** The status code already said that.

```ts
app.use((req, res, next) => {                      // one ID per request
  req.id = req.header('x-request-id') ?? ulid()
  res.setHeader('X-Request-Id', req.id)
  next()
})
```

Return it in the header *and* in the body: the header helps proxies and dev
tools, the body survives being copy-pasted into an email. If the caller sent
an `X-Request-Id`, reuse it, so a partner can correlate their log line with
yours without asking you.

---

## `code` Is the Contract, `message` Is Not

**`code` is part of your public API.** Once `card_declined` ships, some client
writes `if (code === 'card_declined') showRetryCardScreen()`. Rename it to
`payment_card_declined` and that screen silently stops appearing.

**`message` is documentation, not data.** You must stay free to rewrite it for
clarity, tone or a typo, in any release, without warning.

```ts
// ❌ BROKEN — the client parses English prose.
if (body.error.message.includes('already exists')) showLoginLink()

// ✅ FIXED — the client switches on the stable code.
if (body.error.code === 'email_taken') showLoginLink()
```

The broken version dies when you reword the sentence, when a proxy truncates
the body, and for every non-English locale.

| Rule for codes | Good | Bad | Why |
|---|---|---|---|
| Lowercase `snake_case` | `rate_limited` | `RateLimited` | One casing means no guessing |
| Name the cause, not the fix | `insufficient_funds` | `try_another_card` | The fix changes; the cause does not |
| Not the HTTP number | `project_not_found` | `error_404` | The number is already in the status line |
| Specific enough to act on | `task_locked` | `forbidden` | You cannot build UI from `forbidden` |

A short, closed list beats a long open one — 20–40 codes covers a mid-sized
SaaS. Keep them in one union so nobody invents one by accident:

```ts
export type ErrorCode =
  | 'validation_failed' | 'not_found' | 'conflict' | 'unauthenticated'
  | 'forbidden' | 'rate_limited' | 'internal_error' | 'email_taken'
```

> **⚠️ Warning:** a shipped code is as permanent as a URL. Adding one is easy;
> changing one is a version bump. See [API Versioning](04-api-versioning.md).

---

## Field-Level Validation Errors

Validation is the one case where a single request has many problems at once.
Returning only the first is the most common beginner mistake in API design.

A signup form has eight fields and five are wrong. One error at a time means
the user submits eight times and gives up around attempt three — and each
round trip is a real request: eight times the bandwidth and eight database
hits.

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Some fields need attention.",
    "details": [
      { "field": "email",            "code": "invalid_format", "message": "Enter a valid email address." },
      { "field": "password",         "code": "too_short",      "message": "Use at least 12 characters." },
      { "field": "members[2].email", "code": "invalid_format", "message": "Enter a valid email address." }
    ],
    "request_id": "req_01JB70C2N4PQ"
  }
}
```

- **`field` uses dotted / bracketed paths.** `members[2].email` points at the
  third row of a repeated section, so the UI highlights exactly that input.
- **Each detail has its own `code`**, so the UI can show a password-strength
  hint for `too_short` but not for `required`.
- **Object-level problems carry no `field`** — `{"code":
  "plan_limit_reached"}` is valid, and renders as a form-level banner.

```ts
const toDetails = (err: z.ZodError) =>          // every Zod issue → one detail
  err.issues.map((i) => ({
    field: i.path.join('.').replace(/\.(\d+)/g, '[$1]'),
    code: i.code,                               // 'too_small', 'invalid_string', …
    message: i.message,
  }))
```

> **💡 Tip:** collect *all* issues before returning. Zod's `safeParse` does;
> hand-written `if` chains almost never do — see
> [Schema Validation](../04-validation-and-input/02-schema-validation.md).
> The one exception is stopping early when later checks are meaningless: if
> the body is not valid JSON there are no fields to report, so that is a
> single `400 malformed_request` with no `details`.
---

## RFC 7807: `application/problem+json`

RFC 7807 (updated by RFC 9457) is the IETF standard for exactly this problem.
It defines the media type `application/problem+json` and five fields.

```json
{ "type": "https://docs.example.com/errors/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "Some fields need attention.",
  "instance": "/v1/projects/42/tasks",
  "errors": [{ "field": "dueDate", "code": "date_in_past", "message": "Must be today or later." }] }
```

| RFC 7807 field | Meaning | Equivalent above |
|---|---|---|
| `type` | URI identifying the problem kind — the real identifier | `error.code` |
| `title` | Short human summary of the `type` | — |
| `status` | The HTTP status, repeated in the body | — |
| `detail` | Human explanation of *this* occurrence | `error.message` |
| `instance` | URI of the specific occurrence | `error.request_id` |

Extension members — anything else, like `errors` above — are explicitly
allowed, which is how field-level details fit in.

| Adopt RFC 7807 when | Keep a custom shape when |
|---|---|
| You publish a public API for third parties | Only your own clients call you |
| Your ecosystem uses it (Spring, .NET, much of Go) | Your framework has another convention |

Honest assessment: the *ideas* are correct and worth copying — a stable
machine identifier, a separate human sentence, extensions for details. The
*ergonomics* are mediocre: `type` as a URL is more typing than a short code,
`title` and `detail` are easy to confuse, and repeating `status` in the body
invites it to disagree with the real status line.

> **📌 Remember:** what matters is "one shape everywhere". Whether that shape
> is RFC 7807 or your own is a distant second.

---

## Mapping Internal Errors to Status Codes

Inside your application you throw typed errors. At the edge, exactly one place
turns each type into a status code and a body.

| Internal error | Status | `code` | Notes |
|---|---|---|---|
| Malformed JSON, missing header | `400` | `malformed_request` | Nothing to validate yet |
| Schema / business validation | `422` | `validation_failed` | Parsed fine, values unacceptable |
| No credentials, expired token | `401` | `unauthenticated` | Include `WWW-Authenticate` |
| Authenticated but not permitted | `403` | `forbidden` | Identity known, still refused |
| Record missing, or hidden from caller | `404` | `not_found` | See the warning below |
| Duplicate key, stale version, bad state | `409` | `conflict` | Retrying the same body will not help |
| Rate limit or quota exceeded | `429` | `rate_limited` | Include `Retry-After` |
| Unhandled exception | `500` | `internal_error` | Generic message, real `request_id` |
| Upstream down or slow | `502` / `504` | `upstream_unavailable` | Safe to retry with backoff |
| Deploy, maintenance, overload | `503` | `service_unavailable` | Include `Retry-After` |

The full meaning of each number, including the `401`/`403` and `400`/`422`
confusions, is in [Status Codes](../01-http-foundations/04-status-codes.md).

```ts
const STATUS: Record<ErrorCode, number> = {
  malformed_request: 400, validation_failed: 422, unauthenticated: 401,
  forbidden: 403, not_found: 404, conflict: 409,
  rate_limited: 429, internal_error: 500,
}

export function errorHandler(err: unknown, req: Request, res: Response, _n: NextFunction) {
  const app = toAppError(err)     // unknown → AppError, defaults to internal_error
  const status = STATUS[app.code] ?? 500
  if (status >= 500) logger.error({ err, request_id: req.id })
  else logger.warn({ code: app.code, request_id: req.id })

  res.status(status).json({ error: {
    code: app.code,
    message: status >= 500 ? 'Something went wrong on our side.' : app.message,
    ...(app.details?.length ? { details: app.details } : {}),
    request_id: req.id,
  }})
}
```

> **⚠️ Warning:** returning `404` instead of `403` for a record the caller may
> not see is deliberate — it hides *existence*. Be consistent: if `403` on
> someone else's invoice reveals that invoice 89 exists, you have built an
> enumeration oracle. Pick one policy per resource and document it.

The implementation side — the error class hierarchy and where to catch — is
Part 7, [Error Handling](../07-error-handling/).

---

## What Must Never Appear in an Error

An error response is the most generous thing your API sends to a stranger, and
attackers read them carefully: a detailed error is free reconnaissance.

| Never include | What the attacker learns | Where it belongs |
|---|---|---|
| Stack traces | Your framework, versions, file paths, code layout | Server logs |
| SQL text or driver errors | Table and column names, the injection surface | Server logs |
| Internal hostnames, IPs, ports | Your private network map | Server logs |
| Config or environment values | Secrets, region, feature flags | Nowhere |
| Pass-through vendor payloads | Your provider and account structure | Your own codes |
| "Email not found" vs "Wrong password" | Which addresses have accounts | One generic message |
| "Exists but forbidden" | Valid IDs to enumerate | A uniform `404` policy |

The rule that makes this easy: **for any `5xx`, the body is generic.** One
sentence, one code, one `request_id`. Every useful detail goes to the log
under that same `request_id`, where only your team can read it — which is
exactly what the `status >= 500` branch of the handler above does.

> **💡 Tip:** add one test that hits a route which deliberately throws and
> asserts the body has no `stack`, no `at /app/src` and no `SELECT`.

---

## BROKEN vs FIXED: the Login That Leaks Accounts

**User enumeration** is the attack where someone learns which email addresses
have accounts, without logging in. That list is sold, used for phishing, or
checked against a password-breach dump.

```ts
// ❌ BROKEN
router.post('/auth/login', async (req, res) => {
  const user = await User.findByEmail(req.body.email)
  if (!user) return res.status(404).json({
    error: { code: 'user_not_found', message: 'No account with that email.' } })

  if (!(await verifyPassword(req.body.password, user.passwordHash)))
    return res.status(401).json({
      error: { code: 'wrong_password', message: 'Incorrect password.' } })

  res.json({ token: issueToken(user) })
})
```

A script posts 100,000 addresses with the password `x`. Every
`401 wrong_password` is a confirmed customer; every `404 user_not_found` is
not. The attacker now has your customer list. There is a second leak even
after you fix the wording: **timing**. The "no user" path returns at once; the
"wrong password" path spends ~200 ms in bcrypt, and a stopwatch answers the
same question.

```ts
// ✅ FIXED — identical status, code, message, and similar timing.
const GENERIC = { code: 'invalid_credentials', message: 'Email or password is incorrect.' }

router.post('/auth/login', async (req, res) => {
  const user = await User.findByEmail(req.body.email)

  // Always run a hash comparison, even with no user, so both paths cost the same.
  const ok = await verifyPassword(req.body.password, user?.passwordHash ?? DUMMY_HASH)

  if (!user || !ok) {
    logger.warn({ event: 'login_failed', email: req.body.email, request_id: req.id })
    return res.status(401).json({ error: { ...GENERIC, request_id: req.id } })
  }
  res.json({ token: issueToken(user) })
})
```

The same reasoning applies to three endpoints people forget:

| Endpoint | Naive leak | Correct behaviour |
|---|---|---|
| Password reset | "No account with that email" | Always `202`, same message |
| Signup | "Email already registered" | Neutral response, then an email |
| Invitation | "That user does not exist" | Accept and send an invite either way |

> **⚠️ Warning:** signup is the hard one, because the user genuinely needs to
> know. The usual compromise: accept, return the neutral response, and send an
> email that either confirms the new account or says "someone tried to sign up
> with your address — here is a login link".

---

## Localization: Who Translates?

Tempting idea: read `Accept-Language` and return French to French users. That
is usually the wrong place to do it.

| Why the server should not translate | Detail |
|---|---|
| The client knows the locale better | It has the in-app setting; the header is a browser hint |
| Grammar needs context | Gender, plurals and word order depend on the sentence |
| Deploy coupling | Fixing a Portuguese typo becomes a backend release |
| Caching | Every response then needs `Vary: Accept-Language` |

The better design: the server sends a stable `code` plus any values the
sentence needs, and the client owns the wording.

```json
{ "error": {
  "code": "plan_limit_reached",
  "message": "Your plan allows 3 projects.",
  "params": { "limit": 3, "resource": "projects" },
  "request_id": "req_01JB70" } }
```

The client holds `"plan_limit_reached": "Votre forfait autorise {limit} projets."`
and fills in `params`. The English `message` stays as a fallback for cURL,
logs, and clients with no translation yet.

**When the server *should* translate:** there is no client you control (a
plain HTML form, a webhook receipt page, an email your backend sends), or the
text is legal wording that must match an approved version. Then honour
`Accept-Language`, fall back to English, and set `Content-Language`.
---

## Advanced: Retries and Partial Failure

Some failures are permanent for the same request (`422`, `409`) and some are
temporary (`429`, `503`, `504`). Clients guess badly, so be explicit.

A `429` carries `Retry-After: 30` as a header *and* `"retry_after_seconds":
30` in the body. `Retry-After` is the standard that proxies already
understand; the body field is a convenience for clients that only read JSON.

**Bulk endpoints.** `POST /tasks/bulk` with 50 tasks, 3 invalid — two honest
designs:

| Design | Status | Body | Use when |
|---|---|---|---|
| All-or-nothing | `422` | `validation_failed`, `details` naming `items[7]` | The items are one logical change |
| Per-item results | `207` / `200` | Array of `{index, status, error?}` | The items are independent |

Pick one per endpoint and document it. What you must never do is return `200`
with a body that silently dropped three items.

**Document the codes.** Error codes are API surface: list every one — code,
status, meaning, what the client should do — next to the endpoints. In
OpenAPI, define the error schema once and `$ref` it from every `4xx` and
`5xx` response, so generated clients type the error correctly.
---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| A different shape per endpoint | Every client writes per-endpoint parsing | One envelope, one error handler |
| `200 OK` with `{"success": false}` | Monitoring, proxies and retries see success | Correct status plus the error body |
| Clients parsing `message` | Any wording change silently breaks them | Switch on `code`; treat `message` as prose |
| Renaming an existing `code` | A breaking change with no compile error | Add a new code; keep the old as an alias |
| Returning only the first validation error | Eight round trips, one annoyed user | Collect every issue into `details` |
| `details` keyed by field name | Cannot hold two errors on one field, or a form-level error | An array of `{field, code, message}` |
| No `request_id` | Support cannot link a complaint to a log line | Generate one per request; always return it |
| Leaking stack traces or SQL on `500` | Free reconnaissance for an attacker | Generic body, full detail in the log |
| "No such user" vs "wrong password" | Hands over your customer list | One `invalid_credentials`, constant time |
| Translating on the server by default | Wrong locale, wrong grammar, a deploy for a typo | Send `code` + `params` |

---

## Questions to Test Yourself

1. A client writes `if (body.error.message.includes('expired'))`. Name three
   separate events that would break that line.
2. Why is `details` an array of objects rather than an object keyed by field
   name? Give two things the array can express that the object cannot.
3. Your signup form has eight fields and five are invalid. What does the user
   experience if the server returns one error at a time, and what does your
   server experience?
4. You must choose between `403` and `404` for an invoice that exists but
   belongs to another company. What does each choice tell an attacker?
5. A `500` body contains `duplicate key value violates unique constraint
   "users_email_key"`. List everything an attacker just learned.
6. Explain the timing leak in a login endpoint that returns early when the
   email is unknown, and how to close it.
7. Which of these are safe to change next week: `code`, `message`,
   `details[].code`, `details[].message`? Justify each.
---

## Related

- [Status Codes](../01-http-foundations/04-status-codes.md) — the full meaning
  of every code in the mapping table, and the `401`/`403` and `400`/`422`
  splits.
- [Part 7 — Error Handling](../07-error-handling/) — the implementation side:
  the error class hierarchy, where to catch, and the single handler at the
  edge, starting with
  [error taxonomy](../07-error-handling/01-error-taxonomy.md).
- [Schema Validation](../04-validation-and-input/02-schema-validation.md) —
  producing the `details` array from a validation library.
- [API Versioning](04-api-versioning.md) — why changing an error `code` is a
  breaking change, and what to do instead.
- [rate-limiting](../../system-design/foundational/rate-limiting.md) — where
  `429` and `Retry-After` come from, and
  [circuit-breakers-and-retries](../../system-design/reliability/circuit-breakers-and-retries.md)
  — how a well-behaved client reacts to the codes you return.
