# Structured Logging

A handwritten note in a filing cabinet and a row in a spreadsheet can hold
exactly the same facts. Only one of them can answer "how many of these
happened last Tuesday, for customers in Germany, sorted by amount?"

That is the entire difference between a log line and a *structured* log line.
File 1 made your logs exist, levelled and safe. This file makes them
**queryable**, which is what turns 40,000 lines from a burden into a tool.

> **📌 In one line:** log an object with consistently named fields, not an
> English sentence, because a machine can filter, group and count fields but
> cannot reliably parse prose.

## Table of Contents

1. [Log an Object, Not a Sentence](#log-an-object-not-a-sentence)
2. [Side by Side](#side-by-side)
3. [A Standard Field Schema](#a-standard-field-schema)
4. [Child Loggers and Bound Context](#child-loggers-and-bound-context)
5. [Logging Errors Properly](#logging-errors-properly)
6. [Log Events as a Product](#log-events-as-a-product)
7. [Pretty in Development, JSON in Production](#pretty-in-development-json-in-production)
8. [Sampling and Cardinality](#sampling-and-cardinality)
9. [Advanced: Conventions and Shipping](#advanced-conventions-and-shipping)
10. [Common Mistakes](#common-mistakes)
11. [Questions to Test Yourself](#questions-to-test-yourself)
12. [Related](#related)

---

## Log an Object, Not a Sentence

A log line has two jobs, and they pull in opposite directions. A human reading
one line wants a sentence. A machine reading a million lines wants columns.

Structured logging resolves this by writing **one JSON object per line**: the
human-readable sentence stays, as a `msg` field, and everything a machine
might filter on becomes its own key.

```ts
// ❌ BROKEN — the facts are welded into a sentence
logger.info(`User ${user.id} failed login from ${req.ip} (attempt ${n})`)

// ✅ FIXED — the same facts, each addressable
logger.info({
  event: 'user.login.failed',
  user_id: user.id,
  ip: req.ip,
  attempt: n,
  reason: 'bad_password',
}, 'login failed')
```

The second version is barely longer to write and is a different class of
artefact. You can count it, group it, alert on it, and join it to other
lines — none of which is reliably possible with the first.

> **📌 Remember:** the test is not "can I read this line?" It is "could I
> answer a question about ten thousand of these without writing a parser?"

## Side by Side

Take one real event — a login failure — and write it both ways.

```text
2026-03-11T15:02:41.118Z INFO User usr_8812 failed login from 203.0.113.9 (attempt 3)
```

```json
{"level":"info","time":"2026-03-11T15:02:41.118Z","event":"user.login.failed",
 "request_id":"req_01HQ4Z8FVX9T2N","user_id":"usr_8812","tenant_id":"acme-ltd",
 "ip":"203.0.113.9","attempt":3,"reason":"bad_password","msg":"login failed"}
```

Now try to answer four ordinary questions with each.

| Question | With the string | With the object |
|---|---|---|
| How many login failures in the last hour? | `grep -c "failed login"` — breaks when someone rewords the message | `count where event="user.login.failed"` |
| Which users failed most? | A regex to pull `usr_\w+`, then `sort \| uniq -c` | `group by user_id, count, sort desc` |
| Only company `acme-ltd`? | **Impossible** — the tenant is not in the line | `where tenant_id="acme-ltd"` |
| Everything else in that same request | **Impossible** — no request id | `where request_id="req_01HQ4Z8FVX9T2N"` |

Two of the four cannot be answered at all, and not because of the format —
because nobody thought to put `tenant_id` and `request_id` in a sentence. A
structure invites you to fill the fields; prose lets you forget them.

The third row is the one that matters most in a multi-tenant SaaS. "Is this
one customer or everyone?" is the first question of every incident, and it is
free with a field and impossible without one.

> **💡 Tip:** JSON is unreadable in a terminal, which is why people resist it.
> That is a *display* problem, solved by pretty-printing locally — see the
> section below. Do not trade away queryability to make your terminal nicer.

## A Standard Field Schema

Structure alone is not enough. Fields must be named **identically everywhere**
or aggregation silently breaks.

```json
{"userId":"usr_8812"}     ← auth module
{"user_id":"usr_8812"}    ← billing module
{"uid":"usr_8812"}        ← a service written by the team that left
{"user":{"id":"usr_8812"}} ← the newest module
```

Now count how many requests user `usr_8812` made. You cannot — not with one
query. You will find one quarter of them, conclude the user was idle, and be
wrong. Worse, you will not *know* you are wrong, because the query returns
results.

Agree on one schema, write it down, and enforce it with types:

| Field | Type | Example | Notes |
|---|---|---|---|
| `timestamp` | ISO 8601 UTC | `2026-03-11T15:02:41.118Z` | Always UTC; local time is unjoinable |
| `level` | string | `warn` | See file 1 |
| `message` / `msg` | string | `login failed` | The human sentence, nothing else |
| `event` | dotted string | `user.login.failed` | The countable identity of the line |
| `request_id` | string | `req_01HQ4Z8FVX9T2N` | Joins every line of one request |
| `user_id` | string | `usr_8812` | Never the email or the name |
| `tenant_id` | string | `acme-ltd` | "One customer or everyone?" |
| `route` | string | `/api/v1/projects/:id/tasks` | The **pattern**, never the resolved path |
| `method` | string | `POST` | |
| `status` | number | `201` | A number, so you can filter `>= 500` |
| `duration_ms` | number | `142` | A number, so you can average and percentile it |
| `error.code` | string | `INVOICE_ALREADY_PAID` | Your stable code, not the message |
| `error.stack` | string | `at InvoiceService.create ...` | Only in logs, never in a response |

Conventions worth adopting wholesale, because the choice matters less than
the consistency:

- **`snake_case` everywhere.** Most log stores and query languages are
  happier with it, and it sidesteps "is it `userId` or `userid`?".
- **Numbers as numbers.** `"duration_ms": "142"` cannot be averaged. Every
  store treats a quoted number as a string, and a percentile over strings is
  nonsense.
- **Suffix the unit.** `duration_ms`, `size_bytes`, `retry_after_seconds`.
  A field called `timeout` will be read as seconds by someone eventually.
- **Reserve a `_id` suffix for identifiers** so `user_id` is never sometimes
  an object and sometimes a string.

Enforce it in TypeScript so the schema is not a wiki page nobody reads:

```ts
// app/logging/fields.ts
export interface LogFields {
  event: string
  request_id?: string
  user_id?: string
  tenant_id?: string
  route?: string
  method?: string
  status?: number
  duration_ms?: number
  [extra: string]: unknown        // escape hatch, deliberately last
}

export function logInfo(fields: LogFields, msg: string) {
  logger.info(fields, msg)
}
```

A typed wrapper makes `userId` a compile error the first time someone writes
it, which is far cheaper than discovering it during an incident.

## Child Loggers and Bound Context

Every line in a request should carry `request_id`, `user_id` and `tenant_id`.
Passing them by hand is both tedious and unreliable:

```ts
// ❌ BROKEN — context threaded by hand, so it gets dropped
async function createInvoice(input: Input, requestId: string, userId: string) {
  logger.info({ request_id: requestId, user_id: userId }, 'creating invoice')
  const invoice = await repo.insert(input)
  logger.info({ request_id: requestId }, 'invoice created')   // lost user_id
  await pricing.apply(invoice)     // this function has no ids at all
}
```

Every logger worth using supports a **child logger**: a logger that carries a
bound set of fields and merges them into every line it writes.

```ts
// ✅ FIXED — bind once at the edge; every later line inherits the context
// app/http/middleware/request-context.ts
export function requestContext(req: Request, res: Response, next: NextFunction) {
  req.id = req.id ?? randomUUID()
  req.log = logger.child({
    request_id: req.id,
    user_id: req.user?.id,
    tenant_id: req.user?.companyId,
    route: req.route?.path,
    method: req.method,
  })
  next()
}

// Anywhere downstream:
req.log.info({ event: 'invoice.created', invoice_id: invoice.id }, 'invoice created')
// -> includes request_id, user_id, tenant_id, route and method automatically
```

Children nest, which is how a job or a sub-operation adds its own context
without losing the request's:

```ts
const jobLog = req.log.child({ job: 'invoice-pdf', invoice_id: invoice.id })
jobLog.info({ event: 'pdf.render.started' })
// -> request_id + user_id + tenant_id + job + invoice_id
```

Two practical notes. **Bind the user after authentication**, not before, or
`user_id` is always undefined — put the auth middleware first and enrich the
child logger there. And **binding is cheap**: `pino` pre-serialises the bound
fields once, so a child logger costs less per line than spreading the same
object into every call.

Passing `req.log` through five layers is still awkward. The real answer is
`AsyncLocalStorage`, which makes the current request's logger reachable from
anywhere without an argument — that is
[03-correlation-ids-and-tracing-part-1.md](03-correlation-ids-and-tracing.md).

## Logging Errors Properly

This is the most common structured-logging bug, and it is invisible until you
need the line.

```ts
// ❌ BROKEN — every one of these throws away the information you need
logger.error('something failed')                    // which thing? why?
logger.error({ error: error.message })              // no stack, no code, no cause
logger.error({ error: JSON.stringify(error) })      // prints {}
console.error(error)                                // unstructured, unsearchable
```

The third line deserves an explanation because it surprises everyone:

```ts
const err = new Error('boom')
JSON.stringify(err)          // '{}'
Object.keys(err)             // []
```

`JSON.stringify` serialises **own enumerable properties**. On an `Error`,
`message`, `stack` and `name` are non-enumerable (and `name` lives on the
prototype), so `stringify` finds nothing and returns an empty object. Spread
has the same problem: `{ ...error }` is also `{}`. Your custom fields like
`code` *do* survive, which makes the bug worse — the line looks partly
populated, so nobody notices the stack is missing.

```ts
// ✅ FIXED — a serialiser that keeps everything, including the cause chain
export function serialiseError(error: unknown, depth = 0): Record<string, unknown> {
  if (depth > 5) return { message: '[cause chain too deep]' }
  if (!(error instanceof Error)) return { message: String(error), type: typeof error }

  return {
    type: error.name,                                    // 'ConflictError'
    message: error.message,
    stack: error.stack,
    ...(error instanceof AppError
      ? { code: error.code, status: error.status, is_operational: error.isOperational }
      : {}),
    ...(error.cause ? { cause: serialiseError(error.cause, depth + 1) } : {}),
  }
}

logger.error({ event: 'invoice.charge.failed', err: serialiseError(error) },
             'could not charge invoice')
```

With `pino` you do not write this by hand — register it once as a serialiser
and pass the error as `err`:

```ts
const logger = pino({
  serializers: { err: pino.stdSerializers.err },   // handles cause chains
})
logger.error({ err: error, event: 'invoice.charge.failed' }, 'could not charge')
```

The **cause chain** is the part worth insisting on. A wrapped error without
it says "Payment provider unavailable" and nothing else; with it, the log
holds the original `ECONNRESET` from Stripe's socket, three levels down:

```json
{"level":"error","event":"invoice.charge.failed","err":{
  "type":"ExternalServiceError","message":"Payment provider unavailable",
  "code":"EXTERNAL_SERVICE_ERROR","stack":"at chargeInvoice (...)",
  "cause":{"type":"StripeConnectionError","message":"Request aborted",
           "cause":{"type":"Error","message":"ECONNRESET"}}}}
```

`Error.cause` mechanics and how to build these chains are
[error-handling/advanced.md](../../typescript-fundamentals/error-handling/advanced.md).

> **⚠️ Warning:** a stack trace is for logs only. Putting one in an HTTP
> response leaks your file layout and dependency versions — see
> [03-client-facing-error-responses-part-1.md](../07-error-handling/03-client-facing-error-responses-part-1.md).

## Log Events as a Product

Treat the `event` field as a small, deliberate vocabulary rather than free
text. A named event is countable; a sentence is not.

Use `noun.verb` or `domain.noun.verb`, past tense, lower case, dots:

```text
user.login.succeeded        invoice.payment.succeeded
user.login.failed           invoice.payment.failed
user.password.reset         invoice.pdf.render.failed
project.created             webhook.stripe.received
project.member.removed      job.email.retry.exhausted
```

| Rule | Why |
|---|---|
| Past tense | A log records what happened, not an intention |
| Same prefix for a family | `invoice.payment.*` lets one query cover all payment events |
| Failure as a separate event | `*.failed` counted next to `*.succeeded` gives a rate for free |
| Never interpolate a value | `invoice.9124.paid` creates one event name per invoice |
| Stable once shipped | Dashboards and alerts are built on these strings |

That fourth rule is the one that gets broken. `event: \`user.${id}.login\``
looks convenient and destroys the field: you cannot count a name that is
unique per occurrence, and your log store's index grows without limit.

A well-named event log is **halfway to a metric**. Once every payment failure
is `invoice.payment.failed`, you can count it per minute and alert on the
rate — no new instrumentation:

```text
rate( count(event="invoice.payment.failed") )
  / rate( count(event="invoice.payment.*") )   > 0.05   for 5m
```

That is a genuine SLO alert built purely from log events. The step from here
to a real counter is small, and file 4 explains when to take it: metrics are
cheaper at high volume, logs keep the per-event detail. See
[04-metrics-and-health-checks-part-1.md](04-metrics-and-health-checks-part-1.md).

> **💡 Tip:** keep the event names in one TypeScript union
> (`type LogEvent = 'user.login.failed' | ...`). Autocomplete stops typos,
> and the list becomes a readable catalogue of what your system does.

## Pretty in Development, JSON in Production

Nobody wants to read raw JSON in a terminal, and no log store wants colours.
Both come from the same call — only the *transport* changes.

```ts
// app/logger.ts
import pino from 'pino'

const isProd = process.env.NODE_ENV === 'production'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  base: { service: 'billing-api', env: process.env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: { err: pino.stdSerializers.err },
  redact: { paths: ['*.password', '*.token', 'req.headers.authorization'] },
  transport: isProd
    ? undefined                                   // raw JSON to stdout
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
})
```

```text
# development
15:02:41 INFO  login failed  event=user.login.failed user_id=usr_8812 attempt=3

# production (one line, unwrapped)
{"level":"info","time":"2026-03-11T15:02:41.118Z","service":"billing-api",
 "event":"user.login.failed","user_id":"usr_8812","attempt":3,"msg":"login failed"}
```

Two rules keep this honest. **Never make pretty-printing a code branch** —
`if (isProd) logger.info(obj) else console.log(text)` means the two
environments log different things and you debug a format you never ship.
And **never pretty-print in production**: it costs CPU per line and produces
output no aggregator can parse.

If you want readable output from a production log file locally, pipe it —
`kubectl logs deploy/billing-api | pino-pretty` — instead of changing the app.

## Sampling and Cardinality

Structured logs are cheap to write and expensive to store, index and search.
Two habits protect the bill and the signal.

**1. Never log inside a large loop.**

```ts
// ❌ BROKEN — 50,000 lines for one request
for (const row of rows) {
  logger.info({ event: 'import.row.processed', row_id: row.id }, 'processed row')
  await importRow(row)
}
```

Fifty thousand near-identical lines bury every other line in that window,
cost real money, and slow the request — logging is I/O even when buffered.
And they tell you nothing that one summary would not.

```ts
// ✅ FIXED — aggregate; log every failure, and one summary line
let ok = 0
const failures: Array<{ row_id: string; reason: string }> = []

for (const row of rows) {
  try { await importRow(row); ok++ } catch (error) {
    failures.push({ row_id: row.id, reason: (error as Error).message })
  }
}

logger.info({
  event: 'import.completed',
  total: rows.length, succeeded: ok, failed: failures.length,
  duration_ms: Date.now() - startedAt,
  failures: failures.slice(0, 20),     // a sample, not all of them
}, 'import completed')
```

One line, every number you would have counted by hand, and the failures you
actually need. If you want per-row detail during an investigation, log it at
`debug` and turn the level up temporarily.

**2. Watch field cardinality.** Cardinality is the number of distinct values
a field takes. High-cardinality fields are fine *as values* in a log store —
that is the difference between logs and metrics — but they are poison as
**index keys or event names**.

| Field | Cardinality | Verdict |
|---|---|---|
| `level` | 6 | Index it |
| `event` | tens to hundreds | Index it |
| `route` (pattern) | tens | Index it |
| `route` (resolved `/projects/42`) | unbounded | Never — use the pattern |
| `user_id` | millions | Store it; index only if your store handles it |
| `request_id` | one per request | Store and index — it is the join key |
| A full request body | effectively infinite | Do not log it at all |

The distinction that matters: a **value** can be high-cardinality; a **name**
must not be. `event: 'user.login.failed'` with `user_id: 'usr_8812'` is
right. `event: 'user.usr_8812.login.failed'` is wrong, and the same mistake
is fatal in metrics — see label cardinality in
[04-metrics-and-health-checks-part-1.md](04-metrics-and-health-checks-part-1.md).

For genuinely high-volume, low-value events, sample — and always keep the
failures, and always mark the line:

```ts
if (status >= 400 || Math.random() < 0.01) {
  logger.info({ event: 'health.poll', status, sampled: true, sample_rate: 0.01 })
}
```

The `sample_rate` field is what stops someone multiplying by the wrong number
six months later.

## Advanced: Conventions and Shipping

**OpenTelemetry semantic conventions** are an open standard for field names —
`http.request.method`, `http.response.status_code`, `url.path`,
`server.address`, `error.type`. Adopting them means dashboards, exporters and
vendor integrations understand your logs without per-field mapping, and your
logs, metrics and traces share one vocabulary.

The trade-off is verbosity: `http.response.status_code` versus `status`. A
reasonable middle path is to use the conventions for anything that crosses a
tool boundary (HTTP, database, messaging, errors) and short names for your
own domain fields (`invoice_id`, `tenant_id`). The important thing, as ever,
is to decide once. OpenTelemetry itself is
[03-correlation-ids-and-tracing-part-2.md](03-correlation-ids-and-tracing.md).

**Shipping.** Your app writes JSON to stdout (file 1); something else
collects, ships, indexes and stores it. You only choose the destination.

| Store | Model | Strengths | Watch out for |
|---|---|---|---|
| ELK / OpenSearch | Self-hosted, full-text index | Powerful queries, no per-GB vendor bill, own your data | You operate a cluster; indexing is RAM-hungry |
| Grafana Loki | Indexes **labels** only, not content | Very cheap storage; pairs with Prometheus and Grafana | Content search is a scan; keep labels low-cardinality |
| Datadog | Managed, logs + metrics + traces | Fastest to set up, correlation built in | Cost scales with volume and surprises you |
| CloudWatch Logs | Managed, AWS-native | Zero setup on AWS, IAM integration | Clunky query UX; cross-account is awkward |

Three things to get right whichever you choose. **Retention per level** —
`debug` for days, `info` for weeks, audit for years (file 1). **Cost
awareness** — log volume grows with traffic *and* with every new log line
someone adds, so review it like any other bill. And **a shipping failure must
not break the app**: if the collector is down, the app keeps writing to
stdout and the platform buffers. Never make your request path depend on a log
sink being reachable.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Interpolating values into the message | The facts cannot be filtered or grouped | Fields for values, a fixed sentence for `msg` |
| `userId` here, `user_id` there | Aggregation silently returns partial results | One schema, enforced with types |
| Numbers stored as strings | Cannot be averaged or percentiled | `duration_ms: 142`, never `"142"` |
| Passing `request_id` by hand | It gets dropped in the deepest function, which is the one that failed | A child logger bound at the edge |
| `logger.error(error.message)` | No stack, no code, no cause chain | Pass the error object with a serialiser |
| `JSON.stringify(error)` | Returns `{}` — the fields are non-enumerable | A serialiser that reads `message`, `stack`, `cause` |
| Interpolating an id into `event` | Unbounded event names; nothing can be counted | `event` is a fixed name; ids are fields |
| Logging one line per row in a loop | Buries every other line, costs money, slows the request | Aggregate; one summary line plus failures |
| Pretty-printing in production | Burns CPU and produces output no aggregator can parse | Pretty via transport in development only |
| Different log calls per environment | You debug a format you never ship | One call site; change the transport |
| Sampling without a marker | Someone multiplies by the wrong number later | `sampled: true` and `sample_rate` |
| An app that fails when the log sink is down | A logging outage becomes a service outage | Write to stdout; let the platform buffer |

## Questions to Test Yourself

1. Give two questions about a login failure that a structured line can answer
   and a string line cannot, and say why.
2. A codebase uses `userId`, `user_id` and `uid`. You run a query and get a
   result. Why is that more dangerous than getting an error?
3. Why must `duration_ms` be a number rather than a string, concretely?
4. What does a child logger do, and which single failure does it prevent that
   passing `request_id` as an argument does not?
5. Explain why `JSON.stringify(new Error('boom'))` returns `{}`. Which
   properties survive, and why is that worse than nothing surviving?
6. What is a cause chain, and what do you lose in an incident without one?
7. Why is `event: 'user.usr_8812.login.failed'` wrong? Give the correct line.
8. Write the log-based alert for "more than 5% of payments failed over five
   minutes", and say why a metric might be better at high volume.
9. A colleague adds `logger.debug` inside a loop over 50,000 rows and says it
   is free in production because the level is `info`. What is still paid?
10. Name one field you would take from the OpenTelemetry conventions and one
    you would keep short, and justify both.

## Related

- [01-logging-basics.md](01-logging-basics.md) — levels, redaction, stdout,
  retention, and choosing `pino` over `winston`.
- [03-correlation-ids-and-tracing-part-1.md](03-correlation-ids-and-tracing.md)
  — `AsyncLocalStorage`, so the bound logger is reachable without passing it.
- [04-metrics-and-health-checks-part-1.md](04-metrics-and-health-checks-part-1.md)
  — when a counted event should become a metric, and label cardinality.
- [error-handling/advanced.md](../../typescript-fundamentals/error-handling/advanced.md)
  — `Error.cause`, the chain this file insists on serialising.
- [01-error-taxonomy.md](../07-error-handling/01-error-taxonomy.md) — the
  `code` and `isOperational` fields that appear in `error.*`.
- [02-centralized-error-handling-part-1.md](../07-error-handling/02-centralized-error-handling-part-1.md)
  — the one place that writes the `http.request.failed` line.
