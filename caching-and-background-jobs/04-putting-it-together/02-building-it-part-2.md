# Building It — Part 2

Part 1 left the API finished and jobs piling up in Redis with nobody reading
them. This part writes the consumer side: the worker process, what makes the
job safe to run twice, what happens when it fails, how the user finds out it
succeeded, and the instrumentation you add while building rather than after the
first incident. It ends with a `docker-compose` file so you can actually run
the whole thing on your laptop.

> **⬅️ This continues [Part 1](./02-building-it-part-1.md).**

> **📌 In one line:** a worker is not "the same code somewhere else" — it needs
> its own concurrency budget, its own shutdown, its own duplicate protection,
> and its own answer to "what happens when this fails for the fifth time".

## Table of Contents

1. [Step 6: The Worker Process](#step-6-the-worker-process)
2. [Step 7: Making the Job Idempotent](#step-7-making-the-job-idempotent)
3. [Step 8: Retries, Backoff and Where a Job Goes to Die](#step-8-retries-backoff-and-where-a-job-goes-to-die)
4. [Step 9: Telling the User It Finished](#step-9-telling-the-user-it-finished)
5. [Step 10: The Metrics and Logs You Add While Building](#step-10-the-metrics-and-logs-you-add-while-building)
6. [Running the Whole Thing Locally](#running-the-whole-thing-locally)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)
9. [Related](#related)

---

## Step 6: The Worker Process

A separate process, started from its own entry point, so a deploy can restart
workers and API pods independently.

```ts
// bin/worker.ts
import { Worker } from 'bullmq'
import { queueRedis } from '#jobs/queues'
import { handleInvoiceSend } from '#jobs/invoice_send'

const worker = new Worker<InvoiceSendPayload>(
  'invoices',
  async (job) => {
    // The request id from the HTTP call, now on every line this job logs.
    const log = logger.child({
      jobId: job.id,
      jobName: job.name,
      attempt: job.attemptsMade + 1,
      requestId: job.data.requestId,
    })
    return handleInvoiceSend(job.data, log)
  },
  { connection: queueRedis, concurrency: 4, lockDuration: 60_000 },
)
```

**Concurrency is sized against the database pool, not against ambition.** Each
in-flight job can hold one database connection. With a pool of 10 per process
and 4 concurrent jobs, you still have headroom for the health check and the
worker's own bookkeeping. Set concurrency to 20 against a pool of 10 and jobs
start failing on pool timeouts while the database sits idle.

| | Value here | The constraint |
|---|---|---|
| Worker processes | 2 | Pods you can afford |
| Concurrency per process | 4 | ≤ database pool minus headroom |
| Database pool per process | 10 | `max_connections` ÷ total processes |
| Total connections from workers | 20 | Must fit alongside the API's share |

Pool sizing is [connection pooling — part 1](../../databases/operations/01-connection-pooling-part-1.md);
concurrency sizing is
[Writing Reliable Workers — Part 1](../03-background-jobs/03-writing-reliable-workers-part-1.md).

Graceful shutdown is the other half, and it is what makes a deploy boring:

```ts
// bin/worker.ts
async function shutdown(signal: string) {
  logger.info({ signal }, 'worker.shutdown.start')
  // Stop taking new jobs, then wait for in-flight ones to finish.
  await worker.close()
  await Promise.all([queueRedis.quit(), db.close()])
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
```

Your orchestrator sends `SIGTERM` and then waits — 30 seconds by default on
Kubernetes. If `worker.close()` has not returned by then you get `SIGKILL`, and
whatever was in flight is interrupted. Make your job timeout shorter than that
grace period. Shutdown, timeouts and stalled jobs in full:
[Writing Reliable Workers — Part 2](../03-background-jobs/03-writing-reliable-workers-part-2.md).

> **⚠️ Warning:** `process.exit(0)` before `worker.close()` resolves throws away
> in-flight jobs. They are not lost — they stall and get retried — but you are
> now relying on step 7 to stop a second email.

---

## Step 7: Making the Job Idempotent

`SIGKILL` arrives after the email is sent but before the job is marked
complete. The job is retried. Without protection, the customer gets the invoice
twice. Two layers, because each covers what the other cannot.

**Layer 1 — claim before you send.** One row per invoice, inserted with a
unique constraint, so only one attempt can proceed.

```ts
// app/jobs/invoice_send.ts
export async function handleInvoiceSend(data: InvoiceSendPayload, log: Logger) {
  const key = `invoice-send:${data.invoiceId}`

  // INSERT wins or loses atomically. No SELECT-then-INSERT race.
  const claim = await db
    .insertQuery()
    .table('job_claims')
    .insert({ key, status: 'in_progress', claimed_at: new Date() })
    .onConflict('key')
    .ignore()
    .returning('key')

  if (claim.length === 0) {
    log.info({ key }, 'job.duplicate.skipped')
    return { skipped: true }        // another attempt owns this invoice
  }
  // ... render, upload, send, then mark the claim 'done'
}
```

**Layer 2 — the provider's idempotency key.** The claim row protects against
two workers. It does not protect against *you* crashing between the provider
call and the claim update, because the provider already sent the mail. So give
the provider a key it recognises:

```ts
// The SAME key on every attempt. Derived from the work, never random.
await mailer.send({
  to: invoice.customerEmail,
  template: 'invoice',
  attachments: [{ url: pdfUrl }],
  idempotencyKey: `invoice-send:${invoice.id}:v1`,
})
```

```ts
// ❌ BROKEN - a new key per attempt means every attempt is a new email
idempotencyKey: `invoice-send:${randomUUID()}`

// ✅ FIXED - derived from the invoice, so attempt 4 is recognised as attempt 1
idempotencyKey: `invoice-send:${invoice.id}:v1`
```

```mermaid
stateDiagram-v2
    [*] --> Claiming
    Claiming --> Skipped: row exists
    Claiming --> Rendering: row inserted
    Rendering --> Uploaded: PDF in object storage
    Uploaded --> Sending: provider call with idempotency key
    Sending --> Done: claim marked done
    Sending --> Retrying: provider 5xx
    Retrying --> Sending: provider recognises the key, no second email
    Skipped --> [*]
    Done --> [*]
```

The PDF upload is a checkpoint. If the URL is already recorded on the invoice,
a retry skips the 2.8-second render. Claim tables, the sweeper that releases a
claim held by a dead worker, and side effects you cannot undo are all in
[Idempotent Jobs — Part 1](../03-background-jobs/05-idempotent-jobs-part-1.md).

---

## Step 8: Retries, Backoff and Where a Job Goes to Die

The producer already asked for 5 attempts with exponential backoff. Two things
are still missing: jitter, and a decision about errors that will never succeed.

```ts
// app/jobs/backoff.ts
// Full jitter: a random point in the window, not the edge of it. Without this,
// 300 jobs that failed together retry in the same millisecond, together.
export function backoffMs(attempt: number): number {
  const window = Math.min(2_000 * 2 ** (attempt - 1), 60_000)
  return Math.floor(Math.random() * window)
}
```

```ts
// app/jobs/invoice_send.ts
try {
  await mailer.send({ ... })
} catch (err) {
  if (err instanceof PermanentMailError) {
    // Invalid address, rejected template: attempt 5 fails exactly like attempt 1.
    await markSendFailed(data.invoiceId, err)
    throw new UnrecoverableError(err.message)  // stop retrying now
  }
  throw err                                    // transient: let the backoff run
}
```

| Failure | Retry? | Why |
|---|---|---|
| Provider returns 503 | Yes | Transient; backoff gives it room |
| Provider times out | Yes | Ambiguous, which is why step 7 exists |
| Invalid email address | **No** | Four more attempts produce four more identical failures |
| Payload missing `invoiceId` | **No** | A poison message; it will never parse |
| Database deadlock | Yes | Retrying is the documented fix |

And a job that exhausts its attempts needs a destination, not a log line:

```ts
worker.on('failed', async (job, err) => {
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return
  await deadLetterQueue.add('invoice.send.dead', {
    original: job.data, failedReason: err.message, attempts: job.attemptsMade,
  })
  await markSendFailed(job.data.invoiceId, err)   // the user must be able to see this
})
```

Backoff strategies, the jitter formula and attempt counts are in
[Retries, Backoff and Dead Letter — Part 1](../03-background-jobs/04-retries-backoff-and-dead-letter-part-1.md).

---

## Step 9: Telling the User It Finished

The moment you return `202 Accepted`, you owe the user a completion path.
Before this refactor the spinner stopping *was* the confirmation. Now the
request succeeds long before the work does, and silence is indistinguishable
from failure.

```ts
// app/jobs/invoice_send.ts, after the provider call succeeds
await db.transaction(async (trx) => {
  await invoices.setStatus(trx, data.invoiceId, 'sent')
  await audit.record(trx, { invoiceId: data.invoiceId, event: 'send_succeeded' })
  await notifications.create(trx, {
    userId: data.actorId,
    type: 'invoice.sent',
    body: `Invoice ${invoice.number} was emailed to ${invoice.customerEmail}.`,
  })
})
await invalidateDashboard(data.companyId)  // the invoice list changed
```

Three channels, and you need at least the first:

| Channel | Good for | Cost |
|---|---|---|
| A notification row the UI polls | Always works, survives a closed tab | A poll, or a page refresh |
| A websocket or server-sent event push | Feels instant | Only reaches a connected client |
| An email on failure only | The user walked away | Nothing on success |

**Failure needs a path too.** `send_failed` must be visible in the UI with a
retry button, or the invoice silently stays unsent. Delivery mechanics,
templates and provider choice are in
[sending email and notifications — part 1](../../backend-fundamentals/12-files-and-integrations/04-sending-email-and-notifications-part-1.md).

> **📌 Remember:** async work without a completion path is not faster for the
> user. It is the same wait with less information.

---

## Step 10: The Metrics and Logs You Add While Building

Add these now. Added later, they tell you nothing about the incident you are
currently in.

```ts
// app/services/cache/remember.ts - two counters, one label
metrics.increment('cache.request', { family, result: hit ? 'hit' : 'miss' })

// bin/worker.ts - duration by outcome, so a slow success is visible
metrics.histogram('job.duration_ms', Date.now() - startedAt, {
  queue: 'invoices', job: job.name, outcome: 'completed',
})

// A small recurring task - depth alone is not enough
const counts = await invoiceQueue.getJobCounts('waiting', 'active', 'failed', 'delayed')
metrics.gauge('queue.waiting', counts.waiting, { queue: 'invoices' })
const oldest = await invoiceQueue.getWaiting(0, 0)
metrics.gauge('queue.oldest_waiting_seconds',
  oldest[0] ? (Date.now() - oldest[0].timestamp) / 1000 : 0, { queue: 'invoices' })
```

| Signal | Healthy | What a bad value means |
|---|---|---|
| `cache.request` hit ratio | > 80% after warm-up | Keys too specific, TTL too short, or eviction |
| `job.duration_ms` p95 | Stable | The provider is degrading before it starts failing |
| `queue.waiting` | Near zero, spiky | Producers outrunning consumers |
| `queue.oldest_waiting_seconds` | < 60 | **The real stuck-queue alarm** — depth can be low while nothing moves |
| `job` failure rate | < 1% | A dependency is down, or a poison message is cycling |

The last one is the point: a queue with 3 waiting jobs looks fine, and if the
oldest has been waiting 40 minutes, the worker is dead. Metrics and health
checks are
[04-metrics-and-health-checks-part-1.md](../../backend-fundamentals/08-logging-and-observability/04-metrics-and-health-checks-part-1.md).

**Thread the request id all the way through.** The API generates it, the
payload carries it, the worker's child logger attaches it. One `grep` then
shows the HTTP request, the enqueue, all five attempts and the notification:

```text
10:31:02 info  req=7f3a http.request   POST /invoices/4821/send  status=202 ms=16
10:31:02 info  req=7f3a job.enqueued   queue=invoices jobId=invoice-send:4821
10:31:04 info  req=7f3a job.started    attempt=1
10:31:09 warn  req=7f3a job.failed     attempt=1 err=provider 503
10:31:14 info  req=7f3a job.completed  attempt=2 durationMs=4820
```

That is [correlation ids and tracing](../../backend-fundamentals/08-logging-and-observability/03-correlation-ids-and-tracing.md),
applied across a process boundary.

---

## Running the Whole Thing Locally

Two Redis instances, because the design says two. Running one locally and two
in production means you never test the thing you shipped.

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: devpass
      POSTGRES_DB: saas_dev
    ports: ['5432:5432']
    volumes: ['pgdata:/var/lib/postgresql/data']

  redis-cache:
    image: redis:7
    # Cache policy: when memory is full, throw away the least recently used key.
    command: redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru
    ports: ['6379:6379']

  redis-queue:
    image: redis:7
    # Queue policy: NEVER evict. An evicted job is a job that silently vanished.
    command: redis-server --maxmemory 256mb --maxmemory-policy noeviction --appendonly yes
    ports: ['6380:6379']

volumes:
  pgdata:
```

```text
$ docker compose up -d
$ docker compose exec redis-queue redis-cli config get maxmemory-policy
1) "maxmemory-policy"
2) "noeviction"
```

The two `command:` lines are the entire argument for two instances, visible in
six words. `allkeys-lru` and `noeviction` cannot both be true of one server,
and the queue is the one that must not lose data.

```text
CACHE_REDIS_URL=redis://localhost:6379
QUEUE_REDIS_URL=redis://localhost:6380
DATABASE_URL=postgres://postgres:devpass@localhost:5432/saas_dev
```

Run `node build/bin/server.js` and `node build/bin/worker.js` in two terminals.
Containers, images and volumes are
[docker/overview.md](../../cloud-devops/docker/overview.md); the eviction
argument is [Memory and Operations — Part 1](../02-redis-in-practice/05-memory-and-operations-part-1.md).

The build is now complete. Do not trust it yet —
[file 03](./03-breaking-it-on-purpose.md) is where you find out which parts are
real.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Concurrency set higher than the pool | Jobs fail on pool timeouts while the database is idle | Concurrency ≤ pool minus headroom |
| `process.exit()` without awaiting `close()` | In-flight jobs are interrupted on every deploy | Await shutdown, then exit |
| A job timeout longer than the shutdown grace period | `SIGKILL` every deploy | Timeout shorter than the grace period |
| `SELECT` then `INSERT` for the claim | Two workers both find nothing | `INSERT ... ON CONFLICT` |
| A random idempotency key per attempt | Every attempt is a new email | Derive it from the invoice id |
| Retrying a permanent error | Four identical failures, delayed | Classify, then throw unrecoverable |
| No destination for an exhausted job | The work vanishes with a log line | Dead-letter plus a visible status |
| No completion path | The user cannot tell "sending" from "failed" | A notification row, and a visible failure state |
| Only alerting on queue depth | Depth is low while nothing moves | Alert on oldest-waiting-age |
| One Redis locally, two in production | You test a system you do not ship | Two in `docker-compose` |

## Questions to Test Yourself

1. Your pool is 10 per process and concurrency is 20. Describe the failure, and
   say why the database graphs look healthy throughout.
2. What is the relationship between the job timeout and the orchestrator's
   shutdown grace period, and which must be smaller?
3. The claim row stops two workers. Name the duplicate it does **not** stop,
   and the layer that does.
4. Why must the provider idempotency key be derived from the invoice rather
   than generated per attempt?
5. Give two errors that must not be retried and explain what retrying costs.
6. A queue has 3 waiting jobs and the oldest has waited 40 minutes. What is
   wrong, and which metric told you?
7. Why does the `docker-compose` file set a different `maxmemory-policy` on
   each Redis, and what happens if you swap them?
8. Trace the request id from the HTTP handler to the fifth retry's log line.
   Name every place it is copied.

## Related

- [Building It — Part 1](./02-building-it-part-1.md) — the service layer, the
  cache and the producer this part consumes.
- [Breaking It on Purpose](./03-breaking-it-on-purpose.md) — the drills that
  test every step above.
- [Writing Reliable Workers — Part 1](../03-background-jobs/03-writing-reliable-workers-part-1.md)
  and [Part 2](../03-background-jobs/03-writing-reliable-workers-part-2.md) —
  concurrency, shutdown, timeouts, stalled jobs.
- [Idempotent Jobs — Part 1](../03-background-jobs/05-idempotent-jobs-part-1.md)
  — the claim table and the key design in step 7.
- [Retries, Backoff and Dead Letter — Part 1](../03-background-jobs/04-retries-backoff-and-dead-letter-part-1.md)
  — the policy applied in step 8.
- [sending email and notifications — part 1](../../backend-fundamentals/12-files-and-integrations/04-sending-email-and-notifications-part-1.md)
  — the completion path in step 9.
- [metrics and health checks — part 1](../../backend-fundamentals/08-logging-and-observability/04-metrics-and-health-checks-part-1.md)
  and [correlation ids and tracing](../../backend-fundamentals/08-logging-and-observability/03-correlation-ids-and-tracing.md)
  — step 10.
- [docker/overview.md](../../cloud-devops/docker/overview.md) — the local stack.
