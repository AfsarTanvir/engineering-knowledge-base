# Client-Facing Error Responses — Part 2

> **⬅️ This continues [Part 1](03-client-facing-error-responses-part-1.md)**,
> which covered the three audiences of an error, the body shape, what must
> never leak, environment differences, and `request_id` as the bridge to your
> logs.

Part 1 made the response **safe**. This part makes it **useful**: one table
that maps every error class to a status and a body, validation errors a form
can actually render, messages that tell the user what to do next, retry
guidance, bulk endpoints where only some items failed, and what it means to
treat an error code as a public contract.

> **📌 In one line:** one mapping in one place, every field error at once,
> messages that say what to do next, and codes you never rename.

## Table of Contents

1. [Mapping the Hierarchy in One Place](#mapping-the-hierarchy-in-one-place)
2. [Validation Errors](#validation-errors)
3. [Messages That Help Rather Than Blame](#messages-that-help-rather-than-blame)
4. [Rate Limiting and Retry Guidance](#rate-limiting-and-retry-guidance)
5. [Partial Failures in Bulk Endpoints](#partial-failures-in-bulk-endpoints)
6. [Advanced: Codes as a Public Contract](#advanced-codes-as-a-public-contract)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)
9. [Related](#related)

---

## Mapping the Hierarchy in One Place

The error classes from [01-error-taxonomy.md](01-error-taxonomy.md) already
carry a `status` and a `code`, so most of the mapping is *no code at all* —
the handler reads the fields. What still needs a decision is what each one
puts in the body.

| Error class | Status | `code` | `message` | `details` | Extra header |
|---|---|---|---|---|---|
| `ValidationError` | 422 | `VALIDATION_FAILED` | Generic summary | **One entry per field** | — |
| Malformed JSON | 400 | `MALFORMED_BODY` | "Request body is not valid JSON." | — | — |
| `UnauthorizedError` | 401 | `UNAUTHENTICATED` | One sentence, identical for all causes | — | `WWW-Authenticate` |
| Expired token | 401 | `TOKEN_EXPIRED` | "Your session expired. Sign in again." | — | — |
| `ForbiddenError` | 403 | `FORBIDDEN` | What is not allowed, not why | — | — |
| `NotFoundError` | 404 | `<RESOURCE>_NOT_FOUND` | "Invoice not found." | `{ id }` | — |
| `ConflictError` | 409 | Specific, e.g. `INVOICE_ALREADY_PAID` | What conflicts | The conflicting value | — |
| Payload too large | 413 | `PAYLOAD_TOO_LARGE` | Includes the limit | `{ max_bytes }` | — |
| `RateLimitError` | 429 | `RATE_LIMIT_EXCEEDED` | "Too many requests." | `{ retry_after_seconds }` | **`Retry-After`** |
| `ExternalServiceError` | 502 | `EXTERNAL_SERVICE_ERROR` | "A required service is unavailable." | `{ service }` only if safe | — |
| Any bug / unknown | 500 | `INTERNAL_ERROR` | **Fixed generic sentence** | **never** | — |
| Shutting down | 503 | `SERVICE_UNAVAILABLE` | "Temporarily unavailable." | — | `Retry-After` |

Two rows deserve a note. `TOKEN_EXPIRED` is separated from `UNAUTHENTICATED`
on purpose: a client can act on it automatically by refreshing, whereas a
generic `401` means "show the login screen". That is exactly what a distinct
`code` is *for*. And `ExternalServiceError` should usually say only *that* a
dependency failed — naming `stripe` is fine (your users know you take
payments), naming `internal-pricing-svc-v3` is not.

The corresponding code is a small function, called only by the handler:

```ts
// src/http/error-response.ts
export function toErrorBody(
  error: Error, requestId: string, exposeInternals: boolean,
): { status: number; body: ErrorBody; headers: Record<string, string> } {
  const headers: Record<string, string> = {};

  if (error instanceof AppError) {
    if (error instanceof RateLimitError) {
      headers['Retry-After'] = String(error.retryAfterSeconds);
    }
    return {
      status: error.status,
      headers,
      body: { error: {
        code: error.code,
        message: error.message,          // written to be user-safe by design
        ...(error.details ? { details: error.details } : {}),
        request_id: requestId,
      } },
    };
  }

  // Not one of ours: a bug. One shape, no detail, ever.
  return {
    status: 500, headers,
    body: { error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Please try again.',
      request_id: requestId,
      ...(exposeInternals ? { debug: { message: error.message, stack: error.stack } } : {}),
    } },
  };
}
```

The structure is the point: **one branch for errors you designed, one for
everything else.** There is no third branch, no special case per endpoint,
and no place for a `5xx` to acquire detail.

> **💡 Tip:** a message stored on an error class is a message a reviewer can
> read. `throw new ConflictError('Invoice is already paid')` puts the wording
> in front of whoever reviews the pull request — which is when bad wording is
> cheapest to fix.

## Validation Errors

Validation is the one failure where the client genuinely needs detail, and
the one where most APIs are least helpful.

```json
// ❌ BROKEN — the user fixes one field, submits, and finds another
{ "error": { "code": "VALIDATION_FAILED", "message": "email is invalid" } }
```

A five-field form with three bad fields becomes three round trips and three
moments of annoyance. **Validate everything, then report everything.**

```json
// ✅ FIXED — every problem at once, addressable by field path
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Some fields could not be accepted.",
    "details": [
      { "field": "email",              "code": "INVALID_FORMAT",  "message": "Must be a valid email address." },
      { "field": "due_date",           "code": "IN_THE_PAST",     "message": "Must be today or later." },
      { "field": "items[2].quantity",  "code": "OUT_OF_RANGE",    "message": "Must be between 1 and 999.", "meta": { "min": 1, "max": 999 } },
      { "field": "billing.postal_code","code": "REQUIRED",        "message": "Postal code is required for UK addresses." }
    ],
    "request_id": "req_01HQ4Z8FVX9T2N"
  }
}
```

The **field path format** is what makes this usable, so fix it once and never
vary it:

| Structure | Path format | Example |
|---|---|---|
| Top-level field | `name` | `email` |
| Nested object | dot | `billing.postal_code` |
| Array item | bracket index | `items[2]` |
| Field inside an array item | both | `items[2].quantity` |
| Deeply nested | repeat | `invoice.items[0].tax.rate` |

This is JavaScript property-access syntax, which means a form library can
locate the input with a one-line lookup and no parsing. The alternative
formats — `items.2.quantity`, `/items/2/quantity`, `items[2][quantity]` —
all work, but only if you never mix them.

Most schema validators give you a structure close to this already; you just
normalise it:

```ts
// Zod -> your wire format. Written once, used by every endpoint.
function toFieldErrors(err: ZodError): FieldError[] {
  return err.issues.map((issue) => ({
    field: issue.path.reduce<string>(
      (acc, seg) =>
        typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${seg}` : `${seg}`,
      '',
    ),
    code: issue.code.toUpperCase(),     // 'too_small' -> 'TOO_SMALL'
    message: issue.message,
  }));
}

// In the validation middleware:
const parsed = createInvoiceSchema.safeParse(req.body);
if (!parsed.success) {
  throw new ValidationError('Some fields could not be accepted.',
                            toFieldErrors(parsed.error));
}
```

Three more rules:

- **Each entry needs its own `code`.** `REQUIRED` and `TOO_LONG` are
  different situations; a client may show a different hint for each, and a
  localised app needs the code to pick a translated string.
- **Include machine-usable bounds in `meta`.** `{ min: 1, max: 999 }` lets a
  client render "between 1 and 999" in its own language, or set the input's
  `max` attribute.
- **Do not echo the rejected value.** A validation error on a `password` or
  `card_number` field that includes `"received": "hunter2"` writes the secret
  into every client log.

Schema design, the difference between `400` and `422`, and validating at the
boundary are
[02-schema-validation.md](../04-validation-and-input/02-schema-validation.md).

## Messages That Help Rather Than Blame

A good message answers three questions in one sentence: **what happened, why,
and what to do next.** Most bad messages answer only the first, and many add
a fourth thing nobody asked for — blame.

| ❌ Unhelpful | ✅ Helpful | What changed |
|---|---|---|
| `Invalid input` | `Due date must be today or later. You entered 12 March 2024.` | Names the field, the rule, and the value |
| `Error 500` | `We could not save your invoice. Nothing was charged. Please try again — if it keeps failing, quote reference req_01HQ4Z8FVX9T2N.` | Says what did *not* happen, and gives a next step |
| `You are not authorized` | `Only project admins can delete a project. Ask an admin in Acme Ltd, or change your own role in Settings.` | Names the requirement and the route to resolution |
| `Payment failed` | `Your card was declined by the issuing bank. Try another card, or contact your bank — we never see the reason for a decline.` | Says whose decision it was and what to try |

Patterns worth copying from the right-hand column:

- **Name the actual field and the actual rule.** "Invalid input" is the same
  sentence for a missing title and a malformed date.
- **Say what did *not* happen.** "Nothing was charged" removes the user's
  worst fear and stops the duplicate-submit reflex.
- **Give one concrete next action**, even if it is "try again in a minute".
  A message with no next step forces a support ticket.
- **Include the reference on `5xx`.** It is the only thing that makes support
  possible.
- **Do not blame.** "You entered an invalid date" and "Due date must be today
  or later" carry the same information; only one reads like an accusation.
- **Avoid internal vocabulary.** "Constraint violation", "null value",
  "upstream 502" and "deserialization" mean nothing to a user and are
  mild leaks besides.

> **⚠️ Warning:** helpfulness stops at the security boundary. "Only project
> admins can delete a project" is fine. "Only project admins can delete a
> project — you are a `viewer` on `prj_44` owned by `globex-inc`" leaks
> another tenant's data. Be generous about *rules*, silent about *records*.

Where possible, let the **client** phrase the message from the `code`: a web
app can write friendlier, localised copy than an API can, and it knows the
UI context. Your `message` is the fallback for anyone who has not handled
that code yet — so it must still be good.

## Rate Limiting and Retry Guidance

A `429` or a `503` without retry guidance forces the client to guess, and the
usual guess is "immediately, in a loop". That turns a brief limit into a
self-inflicted denial of service.

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1710162000
Content-Type: application/json

{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Try again in 30 seconds.",
    "details": { "retry_after_seconds": 30, "limit": 100, "window": "1m" },
    "request_id": "req_01HQ4Z8FVX9T2N"
  }
}
```

`Retry-After` accepts either a number of seconds (`30`) or an HTTP date
(`Wed, 11 Mar 2026 15:02:41 GMT`). Seconds is simpler and avoids clock-skew
arguments. Send it in the **header** as well as the body, because generic
HTTP clients and SDK retry layers look for the header and never parse your
JSON.

| Status | When | `Retry-After` | Client should |
|---|---|---|---|
| `429` | Rate limit hit | Seconds until the window resets | Wait, then retry with backoff and jitter |
| `503` | Deploying, draining, dependency down | A short estimate (5–30 s) | Retry a few times, then surface an error |
| `502` / `504` | Upstream failed or timed out | Optional | Retry once or twice; the request may have succeeded |
| `409` | Version conflict | — | Re-read, merge, resubmit — never blind retry |
| `4xx` others | The request is wrong | **never** | Do not retry; fix the request |

The `503` case is the one people forget. During a rolling deploy, an instance
that is shutting down should stop accepting work *gracefully*: fail readiness
first, finish in-flight requests, and answer anything new with
`503` + `Retry-After: 5` rather than dropping the connection. A dropped
connection gives the client no information; a `503` with guidance gets
retried successfully a moment later on a healthy instance.

```ts
// A shutdown flag flipped by SIGTERM; checked by an early middleware.
if (shuttingDown) {
  res.setHeader('Retry-After', '5');
  return res.status(503).json({ error: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'The service is restarting. Please retry in a few seconds.',
    request_id: req.id,
  } });
}
```

Algorithms, window types and where the limit is enforced are
[rate-limiting](../../system-design/foundational/rate-limiting.md); backoff,
jitter and breakers are
[circuit-breakers-and-retries](../../system-design/reliability/circuit-breakers-and-retries.md).

## Partial Failures in Bulk Endpoints

`POST /api/v1/tasks/bulk` with 100 items, of which 97 succeed and 3 fail.
What status code is that?

Neither of the obvious answers works:

- **`200 OK`** hides the failures. A client that checks only the status
  believes all 100 were created, and three tasks vanish silently.
- **`422`** implies nothing was created. A client that retries the whole
  batch creates 97 duplicates.

The problem is structural: **one status code cannot describe 100 outcomes.**
The fix is to make the per-item result the real answer.

```json
// 207 Multi-Status — the batch was processed; read the items
{
  "results": [
    { "index": 0, "status": 201, "data": { "id": "tsk_001" } },
    { "index": 1, "status": 201, "data": { "id": "tsk_002" } },
    { "index": 2, "status": 422, "error": {
        "code": "VALIDATION_FAILED",
        "message": "Some fields could not be accepted.",
        "details": [ { "field": "title", "code": "REQUIRED", "message": "Title is required." } ]
    } },
    { "index": 3, "status": 409, "error": {
        "code": "TASK_ALREADY_EXISTS", "message": "A task with this external id already exists."
    } }
  ],
  "summary": { "total": 100, "succeeded": 97, "failed": 3 },
  "request_id": "req_01HQ4Z8FVX9T2N"
}
```

Five properties make this shape work:

- **`index` ties each result to the submitted item.** Never rely on array
  order alone if any part of the pipeline may reorder.
- **Each failed item carries the *same* error object** as a single-item
  request would. The client reuses one error renderer.
- **`summary` lets a client check success in one comparison** without
  scanning 100 entries.
- **`207` is honest**: "processed, mixed results". `200` is acceptable if
  your clients cannot handle `207`, as long as `summary` is present and
  documented.
- **Retry is per item.** Because each failure is addressable, the client
  resubmits three items, not a hundred.

The decision you must make explicitly, and document, is **atomicity**:

| Mode | Behaviour | Status | Use when |
|---|---|---|---|
| All-or-nothing | One failure rolls back everything | `422` with `details` | The items are one logical change (a ledger entry) |
| Best-effort | Valid items are applied, failures reported | `207` | The items are independent (importing a CSV) |

Pick one per endpoint, state it in the documentation, and never make the
client infer it from behaviour. A client that assumes all-or-nothing against a
best-effort endpoint will duplicate data on its first retry.

> **💡 Tip:** cap the batch size (100–1000) and return `413` with the limit in
> `details` when it is exceeded. An uncapped bulk endpoint is a slow request
> waiting to be a timeout, a memory spike, and a very long transaction.

## Advanced: Codes as a Public Contract

**Stability.** The moment a client writes `if (code === 'EMAIL_TAKEN')`, that
string is part of your API. Renaming it to `DUPLICATE_EMAIL` is a breaking
change even though no field changed shape and no test in your repository
fails. Keep a registry, treat additions as minor and renames as major, and
follow [api-versioning](../02-rest-api-design/04-api-versioning.md).

```ts
// src/errors/codes.ts — one file, reviewed like a schema
export const ERROR_CODES = {
  VALIDATION_FAILED:  { status: 422, since: '2024-01-10' },
  EMAIL_TAKEN:        { status: 409, since: '2024-01-10' },
  INVOICE_ALREADY_PAID:{ status: 409, since: '2025-06-02' },
  RATE_LIMIT_EXCEEDED:{ status: 429, since: '2024-01-10' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
```

Typing `code` as `ErrorCode` means a new code cannot be invented inside a
service without adding it to this file — which puts every new part of your
public contract in front of a reviewer.

**Localisation.** Translate on the client, keyed by `code`. The server sends
English (or nothing) plus the machine-readable parts; the client picks the
string. Server-side `Accept-Language` translation is possible but drags a
translation pipeline into your backend and still cannot match UI context.

```ts
// Client side: the code chooses the string, meta fills the placeholders.
const messages = {
  en: { OUT_OF_RANGE: 'Must be between {min} and {max}.' },
  de: { OUT_OF_RANGE: 'Muss zwischen {min} und {max} liegen.' },
};
```

This only works if every error carries the data the sentence needs. That is
what `details[].meta` is for — a message of "Must be between 1 and 999" is
untranslatable, but `code: OUT_OF_RANGE` with `{ min: 1, max: 999 }` is.

**Machine-readable errors for SDKs.** If your error codes and statuses live
in a machine-readable place — an OpenAPI document, or the `ERROR_CODES` map
above — you can generate typed error classes for every client language, and
autocomplete the codes in an editor:

```ts
// Generated SDK — the consumer cannot misspell a code
try {
  await client.invoices.create(input);
} catch (e) {
  if (e instanceof InvoiceAlreadyPaidError) return showAlreadyPaid();
  if (e instanceof ValidationFailedError) return showFieldErrors(e.details);
  throw e;
}
```

Document every code: the code, the status, what causes it, whether it is
retryable, and what the client should do. That table is, in practice, the
most-read page of an API reference.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Returning the first validation error only | The user fixes one field at a time across several round trips | Validate everything, return every field error |
| Inconsistent field paths across endpoints | Client form libraries cannot locate the input | One format everywhere: `items[2].quantity` |
| Echoing the rejected value | Passwords and card numbers end up in client logs | Report the rule, never the value |
| `message` without a next action | Every failure becomes a support ticket | What happened, why, what to do next |
| Blaming the user in copy | Reads as an accusation for the same information | State the rule, not the mistake |
| Explaining *why* authorization failed in detail | Leaks roles, owners and other tenants' records | Generous about rules, silent about records |
| `429` with no `Retry-After` | Clients retry immediately in a loop | Header *and* body, in seconds |
| Dropping connections during a deploy | The client cannot tell a deploy from an outage | `503` + `Retry-After: 5` while draining |
| `200` for a bulk call with failures | Failed items vanish silently | `207` with per-item results and a `summary` |
| Undocumented bulk atomicity | A retry duplicates 97 records | State all-or-nothing vs best-effort |
| Uncapped batch size | Timeouts, memory spikes, very long transactions | Cap it; `413` with the limit in `details` |
| Renaming an error code | Client branches break with no schema change | Treat it as a breaking change; keep a registry |

## Questions to Test Yourself

1. Why does `TOKEN_EXPIRED` deserve a different code from `UNAUTHENTICATED`
   when both are `401`? What does the client do differently?
2. `toErrorBody` has exactly two branches. Why is a third branch — "known
   third-party errors" — a bad idea?
3. A form has five fields and three are invalid. Describe the user's
   experience with one-error-at-a-time validation versus all-at-once.
4. Write the field path for the `rate` of the tax of the first item of an
   invoice, using the format in this file.
5. Rewrite "Error: constraint violation on users_email_unique" as a helpful
   message, then say which part of your rewrite would leak if the address
   belonged to someone else.
6. Why must `Retry-After` be a header and not only a body field?
7. 97 of 100 bulk items succeed. Explain what breaks with `200`, what breaks
   with `422`, and what `207` gives the client that neither does.
8. Your bulk endpoint is best-effort but undocumented. A client assumes
   all-or-nothing and retries after a partial failure. What happens?
9. You rename `EMAIL_TAKEN` to `DUPLICATE_EMAIL`. Your test suite passes and
   your OpenAPI schema is unchanged. Who breaks, and when do you find out?

## Related

- [Part 1](03-client-facing-error-responses-part-1.md) — the three audiences,
  the body shape, what must never leak, and `request_id`.
- [01-error-taxonomy.md](01-error-taxonomy.md) — the classes and `code`
  values this mapping table consumes.
- [02-centralized-error-handling-part-1.md](02-centralized-error-handling-part-1.md)
  — the handler that calls `toErrorBody` and sets these headers.
- [Error Response Design](../02-rest-api-design/05-error-response-design.md)
  and [api-versioning](../02-rest-api-design/04-api-versioning.md) — the body
  shape's rationale, and what makes a code change breaking.
- [02-schema-validation.md](../04-validation-and-input/02-schema-validation.md)
  — producing the field errors that fill `details`.
- [rate-limiting](../../system-design/foundational/rate-limiting.md) — where
  the `429` and its `Retry-After` value come from.
- [idempotency](../../system-design/reliability/idempotency.md) — what makes
  a client's retry of a bulk request safe.
