# Part 8 — Logging & Observability

Part 7 ended with a clean error response and a `request_id` printed in it. A
customer copies that id into a support ticket. Now someone has to open a tool,
paste the id, and find out what your server actually did.

This part is about making sure that search returns something useful.

**Observability** is one word for a simple idea: can you answer questions about
your running system without adding new code and deploying again? At 3 AM,
"let me add a `console.log` and redeploy" is not an answer. The information has
to already be there.

There are three kinds of information, and this part covers all three:

- **Logs** — a record of individual events. "What happened in *this* request?"
- **Metrics** — numbers aggregated over time. "How is the system doing *overall*?"
- **Traces** — one request's path across many services. "*Where* did the time go?"

> **📌 The whole part in one line:** log structured events with a shared
> request id, aggregate the numbers you would page someone about, and connect
> the two so a spike on a graph leads you to the exact failing request.

## Files

1. [Logging Basics](01-logging-basics.md) — why `console.log` is not logging,
   the six log levels and when to use each, alert fatigue, what must never be
   written to a log, stdout versus files, retention cost, and choosing between
   `pino` and `winston`.
2. [Structured Logging](02-structured-logging.md) — logging an object instead
   of a sentence, a standard field schema for the whole app, child loggers that
   carry context automatically, serialising errors properly, naming log events
   so they can be counted, and where logs get shipped.
3. [Correlation IDs and Tracing](03-correlation-ids-and-tracing.md) — giving
   every request an id and carrying it through HTTP calls, queue jobs and SQL
   comments with `AsyncLocalStorage`, then the step up to distributed tracing:
   spans, `traceparent`, OpenTelemetry, and sampling.
4. [Metrics and Health Checks — Part 1](04-metrics-and-health-checks-part-1.md)
   — counters, gauges, histograms and summaries, the golden signals with RED
   and USE, why averages lie and percentiles do not, instrumenting a Node API
   with `prom-client`, label cardinality, and business versus technical
   metrics.
5. [Metrics and Health Checks — Part 2](04-metrics-and-health-checks-part-2.md)
   — liveness versus readiness versus startup probes, readiness checks that do
   not cascade, what a health endpoint returns, alerting on symptoms, SLIs,
   SLOs and error budgets, dashboards, and profiling in production.

## Read in this order

Read 1 → 5 in order, one file per sitting.

The order builds on itself. File 2 cannot exist without file 1's log levels.
File 3 adds the one field (`request_id`) that makes file 2's structure
joinable across services. File 4 steps back from single events to aggregate
numbers, and uses the event names you learned to design in file 2. File 5
turns those numbers into the health endpoints your platform polls and the
alerts that wake someone up.

## What you should be able to do after this part

- Look at any line of logging in your codebase and say whether its level,
  its fields, and its contents are correct — including whether it leaks
  anything it should not.
- Add a `request_id` to every log line in an app without passing it as a
  function argument, and carry it into a background job.
- Read a distributed trace waterfall and point at the slow span.
- Choose between a counter, a gauge and a histogram for a new measurement, and
  pick labels that will not explode your metrics bill.
- Explain why a 200 ms average response time can still mean thousands of angry
  users, using p95 and p99.
- Write a readiness endpoint that checks the right things, fails fast, and
  cannot turn one dependency's outage into four.

## Where this connects

- The `request_id` in the error body comes from Part 7 —
  [Client-Facing Error Responses](../07-error-handling/03-client-facing-error-responses-part-1.md).
- The per-request context object that carries the id is Part 3 —
  [Controllers and Request Context](../03-request-lifecycle/04-controllers-and-request-context.md).
- The deployment side of health checks lives in
  [health-checks](../../cloud-devops/deployment-strategies/health-checks.md)
  and [load-balancing](../../system-design/foundational/load-balancing.md).
- Why writing logs synchronously hurts a Node server:
  [event-loop](../../typescript-fundamentals/event-loop/event-loop.md).
- Why logs go to stdout in a container:
  [docker overview](../../cloud-devops/docker/overview.md).

## Next

Part 9 — [Application Architecture](../09-application-architecture/) decides
where all this instrumentation belongs, so that logging does not end up
smeared across every layer of the app.
