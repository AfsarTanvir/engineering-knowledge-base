# Metrics and Health Checks — Part 1: Metrics

Support forwards a message: *"Checkout feels slow today."* You have perfect
logs. You can open any single request and read exactly what it did.

And you still cannot answer the question. "Slow today" is not about one
request. It is about ten thousand of them, compared against yesterday's ten
thousand. Reading individual log lines to answer it is like reading a
building's visitor book to work out whether the lifts are busy.

Logs record events. Metrics record **numbers about all the events at once**.
Part 1 is about producing those numbers and reading them honestly — especially
the part everyone gets wrong, which is that the average is almost never the
number you want. Part 2 wires all of it to health endpoints and alerts.

> **📌 In one line:** logs answer "what happened in *this* request", metrics
> answer "how is the system doing *overall*" — and the number that matters is
> almost never the average.

## Table of Contents

1. [One Request vs the Whole System](#one-request-vs-the-whole-system)
2. [The Four Metric Types](#the-four-metric-types)
3. [The Golden Signals](#the-golden-signals)
4. [Why Averages Lie](#why-averages-lie)
5. [Instrumenting a Node API](#instrumenting-a-node-api)
6. [Label Cardinality: The Expensive Mistake](#label-cardinality-the-expensive-mistake)
7. [Business Metrics vs Technical Metrics](#business-metrics-vs-technical-metrics)
8. [Advanced: The Cost of Metrics, Pull vs Push](#advanced-the-cost-of-metrics-pull-vs-push)
9. [Common Mistakes](#common-mistakes)
10. [Questions to Test Yourself](#questions-to-test-yourself)
11. [Related](#related)

---

## One Request vs the Whole System

Make it concrete. A user reports that saving a task failed at 14:02.

**With logs** you search `request_id=01HQ4Z...` and read the story: auth passed,
validation passed, the `UPDATE` took 9,400 ms, the client gave up. One request,
fully explained. What you cannot tell is whether this happened once or four
thousand times, whether it started at 14:02 or at 09:00, and whether it is
still happening now.

**With metrics** you look at a graph of `http_request_duration_seconds` for
`PATCH /projects/:id/tasks/:taskId` and see p99 climb from 180 ms to 9 s at
13:40, affecting 4% of requests, still rising. You cannot tell which user, or
what the exact SQL was.

| | Logs | Metrics |
|---|---|---|
| Unit | One event | One number, aggregated over time |
| Question | What happened in this request? | How is the system doing overall? |
| Cost per event | High — every field is stored | Near zero — events collapse into counters |
| Retention | Days to weeks | Months to years |
| Good at | Explaining one failure in detail | Detecting that failures started |
| Bad at | "How many?" and "since when?" | "Why, exactly?" |

The two are a pair, not a choice. The workflow is always: a **metric** tells
you something changed and when, a **trace** tells you where the time went, a
**log** tells you why. File 3 covers the field that joins them —
[Correlation IDs and Tracing](03-correlation-ids-and-tracing.md).

## The Four Metric Types

Almost every measurement you will ever take is one of four shapes. Picking the
wrong one is the most common instrumentation bug, because the metric still
produces a graph — just a meaningless one.

| Type | What it does | Only goes up? | SaaS example | Read it as |
|---|---|---|---|---|
| **Counter** | Counts occurrences since the process started | Yes (resets to 0 on restart) | `invoices_sent_total` | A *rate*: `rate(invoices_sent_total[5m])` |
| **Gauge** | A value that can move either way, sampled now | No | `jobs_queue_depth`, `db_pool_in_use` | The current level |
| **Histogram** | Buckets observations by size, plus a sum and a count | Buckets are counters | `http_request_duration_seconds` | Percentiles, computed on the server |
| **Summary** | Like a histogram, but percentiles are computed in the process | Mixed | `gc_pause_seconds` on a single instance | Percentiles for *that instance only* |

Two rules follow from the table, and they matter more than the definitions.

**Never use a counter for something that can go down.** If you increment on job
enqueue and decrement on completion, a restart resets it to zero and the graph
lies forever. Queue depth is a gauge.

**Prefer a histogram to a summary.** A summary's percentiles are calculated
inside one process, and *percentiles cannot be averaged*. The mean of six
instances' p99 values is not the fleet's p99 — it is a number with no meaning.
A histogram ships raw bucket counts, which *can* be summed across instances,
so the backend computes a true fleet-wide p99. Use a summary only when you
genuinely care about one process in isolation.

> **💡 Tip:** the suffix conventions are load-bearing. Counters end in
> `_total`, durations are in **seconds** (not milliseconds), sizes in
> **bytes**. Every dashboard and alerting library assumes this.

## The Golden Signals

Google's SRE practice names four signals that, between them, catch most
user-facing problems. If you instrument nothing else, instrument these.

| Signal | What to measure | A bad value looks like |
|---|---|---|
| **Latency** | Duration of successful requests, as a histogram, split by route. Measure failures separately — a fast 500 flatters your graph | p99 crosses the number users notice (often ~1 s for interactive, ~200 ms for an autocomplete) |
| **Traffic** | Requests per second, jobs per second, by route | A *drop* to zero is as alarming as a spike — usually an upstream is down or DNS broke |
| **Errors** | 5xx rate as a **proportion** of requests, plus explicit failures that return 200 | Error ratio above your SLO's threshold, sustained for minutes |
| **Saturation** | How full the constrained resource is: pool in-use / pool max, queue depth, event-loop lag, memory vs limit | Any resource above ~80% of its ceiling, or a queue whose depth grows monotonically |

Two shorter framings you will hear, both subsets of the same idea:

- **RED** — Rate, Errors, Duration. Applied per *service* or per *endpoint*.
  This is the request-handling view, and it is what belongs on a service
  dashboard.
- **USE** — Utilisation, Saturation, Errors. Applied per *resource*: CPU,
  memory, disk, connection pool. This is the infrastructure view, and it is
  what you open once RED tells you something is wrong.

In Node, the single most under-instrumented saturation signal is **event-loop
lag**. If the loop is blocked, every request is slow regardless of how fast
your database is — see
[event-loop](../../typescript-fundamentals/event-loop/event-loop.md).

## Why Averages Lie

This is the most valuable idea in the file, so here is a full worked example.

Ten thousand requests hit one endpoint in a minute. Total time spent:
2,034,000 ms. The average is **203 ms**. Comfortable. You would not open a
ticket for that number.

Here is the actual distribution:

```text
Requests in one minute, by duration (10,000 total)

    0–100 ms  ████████████████████████████████████████   7,000   @ ~45 ms
  100–500 ms  █████████████                              2,300   @ ~250 ms
   0.5–2.0 s  ███                                          590   @ ~1.1 s
     2–5 s    ▌                                            110   @ ~4.5 s
```

A **percentile** is the value below which that share of observations fall.
Sort all 10,000 durations from fastest to slowest; the p99 is the 9,900th
value — 99% of requests were faster than it, 1% were slower.

| Statistic | Value | What it actually tells you |
|---|---|---|
| Mean | 203 ms | Nothing any single user experienced. It sits in an empty gap of the distribution |
| p50 (median) | 45 ms | The *typical* experience. Half of users saw this or better |
| p95 | 1,100 ms | 1 request in 20 is over a second — noticeable hesitation |
| p99 | **4,500 ms** | 1 in 100 waits four and a half seconds |
| Max | 12,000 ms | One pathological request. Useful, but a single retry or GC pause moves it |

The average is 203 ms *because* the 7,000 fast requests drag it down. Those
110 slow requests are 1.1% of the minute — and **6,600 requests an hour**. If
each belongs to a different customer, that is 6,600 people an hour watching a
spinner, while your dashboard shows a healthy green 203 ms.

Worse, the slow tail is not randomly distributed. It concentrates on the users
with the most data — your biggest accounts. The average hides your most
valuable customers' experience by construction.

> **📌 Remember:** an average tells you about your servers. A percentile tells
> you about your users. Alert on p95 and p99; keep p50 on the dashboard only to
> tell "everything got slower" apart from "the tail got worse".

Three rules follow:

1. **Never average percentiles.** Not across instances, not across time
   windows, not across anything. Aggregate the histogram buckets and recompute.
2. **Choose buckets before you need them.** A histogram can only report
   percentiles at bucket boundaries. If your buckets stop at 1 s, every slow
   request is "over 1 s" and you cannot tell 1.1 s from 40 s.
3. **Split by route.** A fleet-wide p99 mixes a 5 ms health check with a 6 s
   report export, and means nothing.

## Instrumenting a Node API

`prom-client` is the standard Node library. Define metrics once, in a module,
so they are registered exactly once per process.

```ts
// app/metrics.ts
import client from 'prom-client'

export const registry = new client.Registry()
registry.setDefaultLabels({ service: 'billing-api', env: process.env.NODE_ENV! })

// CPU, heap, GC pauses, open handles, and event-loop lag — all for free.
client.collectDefaultMetrics({ register: registry })

// LATENCY — a histogram, because we want real percentiles across instances.
export const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  // Buckets must straddle the values you care about, including the bad ones.
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
})

// BUSINESS EVENT — a counter. Read as a rate, never as an absolute.
export const invoicesSent = new client.Counter({
  name: 'invoices_sent_total',
  help: 'Invoices successfully delivered to a customer',
  labelNames: ['channel'] as const, // 'email' | 'webhook' | 'post' — bounded
  registers: [registry],
})

// SATURATION — gauges. A queue can shrink, so it cannot be a counter.
export const queueDepth = new client.Gauge({
  name: 'jobs_queue_depth',
  help: 'Jobs waiting to be picked up',
  labelNames: ['queue'] as const,
  registers: [registry],
})
```

A gauge whose value you can read on demand should use `collect()`, so it is
sampled at scrape time rather than kept fresh by a timer you have to maintain:

```ts
new client.Gauge({
  name: 'db_pool_connections',
  help: 'Database pool connections by state',
  labelNames: ['state'] as const,
  registers: [registry],
  collect() {
    // Runs on every scrape. Keep it cheap and synchronous.
    this.set({ state: 'in_use' }, pool.totalCount - pool.idleCount)
    this.set({ state: 'idle' }, pool.idleCount)
    this.set({ state: 'waiting' }, pool.waitingCount) // > 0 means exhaustion
  },
})
```

`waiting` is the number that tells you the pool is too small — see
[04-connection-pooling.md](../10-database-integration/04-connection-pooling.md).

Then one middleware and one endpoint:

```ts
app.use((req, res, next) => {
  const end = httpDuration.startTimer({ method: req.method })
  res.on('finish', () => {
    end({
      route: req.route?.path ?? 'unmatched', // the PATTERN — see next section
      status: String(res.statusCode),
    })
  })
  next()
})

// Prometheus scrapes this. Keep it off the public internet.
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', registry.contentType)
  res.end(await registry.metrics())
})

// Business events are incremented where the business decision is made —
// in the service layer, not the controller.
invoicesSent.inc({ channel: 'email' })
```

## Label Cardinality: The Expensive Mistake

A **label** is a key/value pair attached to a metric. Every distinct
*combination* of label values creates a separate **time series** — its own
independent stream of numbers, stored for as long as your retention allows.

The count multiplies. That is the whole problem.

```ts
// ❌ BROKEN — every one of these labels is unbounded
httpDuration.observe({
  route: req.path,          // '/projects/9a1f-.../tasks/2231'
  user_id: req.user.id,     // 50,000 values and growing
  email: req.user.email,    // same, but also personal data in a metric store
}, seconds)
```

Do the arithmetic. With 5 methods, 40 route patterns and 8 status codes you
have `5 × 40 × 8 = 1,600` series. Perfectly healthy. Now add `user_id` with
50,000 users and you have **80,000,000 series**. Your process holds every one
of them in memory between scrapes, `/metrics` becomes a multi-megabyte response
that takes seconds to render, and your metrics vendor bills you per active
series.

Using the resolved path is the same bug wearing a disguise: `/projects/9a1f`
and `/projects/b2c3` are different label values, so every project id you have
ever served becomes a permanent time series — and no two requests ever group
together, which destroys the metric's entire purpose.

```ts
// ✅ FIXED — every label has a small, bounded, known set of values
httpDuration.observe({
  method: req.method,                         // ~5
  route: req.route?.path ?? 'unmatched',      // '/projects/:id/tasks' — ~40
  status: String(res.statusCode),             // ~8
}, seconds)

// The identity you dropped is not lost — it belongs on the log line,
// which is designed to hold high-cardinality fields.
logger.info({ event: 'http.request', user_id: req.user.id, duration_ms })
```

> **⚠️ Warning:** the test for a label is *"can I write down every possible
> value of this before deploying?"* If the answer involves a database lookup, a
> user, a tenant with unbounded growth, a URL, an error message string, or a
> timestamp, it is not a label. Tenant id is the borderline case: fine at 200
> customers, ruinous at 200,000.

Two more traps worth naming. Never label with a raw error message
(`error: 'connect ETIMEDOUT 10.0.3.44:5432'` — the IP and port vary); use a
short stable code like `error_kind: 'db_timeout'`. And never label with
anything containing a timestamp or a request id; that is one series per
request, the worst possible outcome.

## Business Metrics vs Technical Metrics

Technical metrics describe the machine. Business metrics describe whether the
product is working. You need both, and teams almost always have only the first.

| Technical | Business |
|---|---|
| `http_request_duration_seconds` | `signups_total` |
| `db_pool_connections{state="waiting"}` | `checkouts_completed_total` |
| `nodejs_eventloop_lag_seconds` | `invoices_sent_total` |
| `process_resident_memory_bytes` | `password_resets_completed_total` |

Here is why it matters. Technical metrics only catch failures your
instrumentation anticipated. **Business metrics catch failures nobody
anticipated**, because they measure the outcome rather than a mechanism.

Signups-per-hour is frequently the fastest outage detector in the building. A
broken email provider, an expired TLS certificate on a third-party script, a
front-end deploy that hid the button, a country-level CDN failure — every one
of those produces *zero* 5xx responses on your API. Latency is fine. Errors are
fine. Every technical graph is green. And signups go to zero within five
minutes.

The alert is simple and unusually reliable: *signups in the last 30 minutes are
below 40% of the same window last week.* Compare against the same weekday and
hour, not against an absolute threshold, or you will page someone every Sunday
at 4 AM.

> **💡 Tip:** the event names you standardised in
> [Structured Logging](02-structured-logging.md) are exactly the business
> metrics to promote to counters. `invoice.payment.failed` as a log event
> becomes `invoice_payments_failed_total` as a counter — same name, cheaper at
> volume, alertable.

## Advanced: The Cost of Metrics, Pull vs Push

**The cost of metrics.** Vendors bill per *active time series* per month, and
the series count is driven almost entirely by label cardinality. One careless
label can multiply a bill by a thousand overnight, so treat a new label like a
schema change and review it. Drop series nobody queries (the default metric set
includes plenty you will never open), shorten retention for high-resolution
data, and use **recording rules** to pre-compute expensive aggregations once
instead of on every dashboard refresh. Metrics should remain the cheap pillar;
when they are not, cardinality is the reason.

**Pull vs push.** Prometheus *pulls*: it scrapes `/metrics` on a schedule. That
gives you a free liveness signal — a target that cannot be scraped is visibly
down — plus one place to control frequency, and no way for a runaway process to
flood the backend. It requires your instances to be reachable and long-lived
enough to scrape. *Push* (a push gateway, StatsD, or OTLP export) suits
short-lived batch jobs and serverless functions that finish before any scrape
could reach them, and instances behind NAT that the collector cannot address. A
common setup is pull for long-running services, push for cron jobs and
functions.

For the database side of monitoring — `pg_stat_statements`, slow query logs,
lock waits and replication lag — go to
[05-monitoring-and-troubleshooting-part-1.md](../../databases/operations/05-monitoring-and-troubleshooting-part-1.md).
That ground is not repeated here.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Watching the average response time | A 203 ms mean hides a 4.5 s p99 affecting thousands of users an hour | Alert on p95 and p99; keep p50 for context |
| Averaging p99 across instances | The mean of percentiles is not a percentile; the number is meaningless | Aggregate histogram buckets, then compute |
| `user_id`, email or raw path as a label | Cardinality explodes into millions of series; memory and bill follow | Bounded labels only; identities go on log lines |
| Using the resolved path `/projects/42` | No two requests group together, so the metric measures nothing | The route pattern `/projects/:id` |
| A counter for queue depth | It cannot go down, and a restart zeroes it | A gauge |
| A summary instead of a histogram | Per-process percentiles cannot be combined across the fleet | A histogram with sensible buckets |
| Histogram buckets that stop at 1 s | Every slow request lands in the last bucket; p99 becomes unreadable | Buckets that straddle the bad values too |
| Measuring latency of successes and failures together | A fast 500 pulls the graph down and hides the outage | Split by status, or exclude errors |
| Counting errors absolutely, not as a ratio | A traffic drop silences you; a traffic spike pages you | 5xx as a proportion of total requests |
| Only technical metrics | Outages with zero 5xx responses go undetected | Add business counters; signups-per-hour catches what nothing else does |

## Questions to Test Yourself

1. A user reports a failure at 14:02. Say precisely which question logs can
   answer here and which one only metrics can, and why each is useless for the
   other.
2. Your average latency is 203 ms and your p99 is 4.5 seconds. Explain how both
   can be true, and calculate roughly how many users per hour are affected at
   10,000 requests per minute.
3. Why is the arithmetic mean of six instances' p99 values not the fleet's p99?
   What must you aggregate instead?
4. A colleague instruments queue depth as a counter, incrementing on enqueue
   and decrementing on completion. Name two separate things that go wrong.
5. You want per-tenant latency. Argue both sides of adding `tenant_id` as a
   label, and give the number that decides it.
6. A teammate adds `error_message` as a metric label to make debugging easier.
   Describe exactly what happens to the metrics backend, and where that data
   should live instead.
7. Your histogram buckets end at 1 second and p99 reads "1 s" during an
   incident where users waited 40 seconds. Explain the mechanism.
8. Every technical graph is green and signups have been zero for 20 minutes.
   Name three causes consistent with both facts.
9. Why should a signup alert compare against the same hour last week rather
   than a fixed threshold?
10. When would you deliberately choose a push-based collector over Prometheus
    scraping?

---

> **➡️ Continued in [Part 2](04-metrics-and-health-checks-part-2.md)** —
> liveness, readiness and startup probes, readiness checks that do not cascade,
> what a health endpoint returns, alerting on symptoms, SLI/SLO/error budgets,
> dashboards, and profiling in production.

## Related

- [Part 2](04-metrics-and-health-checks-part-2.md) — health checks, alerting
  and error budgets.
- [Logging Basics](01-logging-basics.md) — levels, alert fatigue, and the route
  pattern rule that this file's labels depend on.
- [Structured Logging](02-structured-logging.md) — the named events that become
  the business counters here.
- [Correlation IDs and Tracing](03-correlation-ids-and-tracing.md) — how a
  metric spike leads to the exact failing request.
- [04-connection-pooling.md](../10-database-integration/04-connection-pooling.md)
  — the pool gauges, and why `waiting > 0` is the number to watch.
- [05-monitoring-and-troubleshooting-part-1.md](../../databases/operations/05-monitoring-and-troubleshooting-part-1.md)
  — the database-side runbook, deliberately not repeated here.
- [event-loop](../../typescript-fundamentals/event-loop/event-loop.md) — why
  event-loop lag is Node's most important saturation signal.
