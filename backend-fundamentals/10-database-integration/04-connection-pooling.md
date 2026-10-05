# Connection Pooling

A restaurant with eight tables can serve hundreds of people in an evening,
because nobody keeps a table all night. Your database is the restaurant. A
connection is a table. The pool is the host at the door deciding who sits and
who waits.

Most developers meet the pool exactly once — a `max: 10` in a config file they
copied — and then meet it again during an incident, when every request is timing
out and the database dashboard looks completely idle.

> **📌 In one line:** the pool is a small fixed number of connections shared by
> every request, so the two things that matter are *never holding one longer
> than you need* and *never forgetting to give one back*.

> **🔍 Scope: the operational side lives in `databases/`.** Pool-sizing
> mathematics, PgBouncer's three modes, diagnosing from `pg_stat_activity`, and
> what PostgreSQL does per connection are covered in
> [01-connection-pooling-part-1.md](../../databases/operations/01-connection-pooling-part-1.md)
> and
> [01-connection-pooling-part-2.md](../../databases/operations/01-connection-pooling-part-2.md).
> **This file is the application developer's half:** what to configure, the bugs
> your own code introduces, and how to see them from inside the app.

## Table of Contents

1. [Why a Connection Is Not Free](#why-a-connection-is-not-free)
2. [Configuring the Pool in a Node App](#configuring-the-pool-in-a-node-app)
3. [The Multiplication Trap](#the-multiplication-trap)
4. [Pool Leaks in Application Code](#pool-leaks-in-application-code)
5. [Long Transactions and Long Queries](#long-transactions-and-long-queries)
6. [Recognising Exhaustion from the Application Side](#recognising-exhaustion-from-the-application-side)
7. [Layering Your Timeouts](#layering-your-timeouts)
8. [Graceful Shutdown](#graceful-shutdown)
9. [Read Replicas from the Application's Side](#read-replicas-from-the-applications-side)
10. [Serverless and the Connection Storm](#serverless-and-the-connection-storm)
11. [Advanced: Health Checks and Clustered Node](#advanced-health-checks-and-clustered-node)
12. [Common Mistakes](#common-mistakes)
13. [Questions to Test Yourself](#questions-to-test-yourself)
14. [Related](#related)

---

## Why a Connection Is Not Free

Opening a PostgreSQL connection is not like opening a socket. The server forks
an operating-system **process** for it, allocates several megabytes of private
memory, and runs authentication and TLS. That is tens of milliseconds and a
permanent memory cost for as long as the connection lives.

So the naive design — connect, query, disconnect, per request — pays that price
on every single request, and a few hundred concurrent requests would exhaust the
server's memory. The pool opens a handful of connections at startup and lends
them out. Your query now waits microseconds for a table instead of building a
new restaurant.

The engine-side detail — why each connection is a process, what it costs, and
why 500 connections is slower in total than 20 — is in
[01-connection-pooling-part-1.md](../../databases/operations/01-connection-pooling-part-1.md).

---

## Configuring the Pool in a Node App

Four settings do almost all the work.

```ts
// config/database.ts — AdonisJS. Knex uses the same `pool` block;
// node-postgres and Prisma use the same names with small spelling differences.
export default defineConfig({
  connections: {
    postgres: {
      client: 'pg',
      connection: {
        host: env.get('DB_HOST'),
        database: env.get('DB_DATABASE'),
        // Not a pool setting, but the only one that can FREE a stuck slot.
        options: '-c statement_timeout=10000 -c idle_in_transaction_session_timeout=30000',
      },
      pool: {
        min: 2,                      // keep a couple warm; avoids cold-start latency
        max: 10,                     // see the multiplication trap below
        acquireTimeoutMillis: 5000,  // fail fast instead of queueing forever
        idleTimeoutMillis: 30000,    // release unused connections after a quiet spell
      },
    },
  },
})
```

| Setting | What it decides | Start with | If you get it wrong |
|---|---|---|---|
| `max` | Ceiling on connections **this process** opens | 5–10 per instance | Too high: you exceed `max_connections` and the database thrashes. Too low: requests queue |
| `min` | Connections kept open while idle | 2 | Too low: first request after a quiet period pays the connect cost |
| Acquire timeout | How long a request waits for a free connection | 5 s | Too long: requests pile up behind an already-broken database instead of failing |
| Idle timeout | When an unused connection is closed | 30 s | Too short: constant connect/disconnect churn |

Two pieces of reasoning behind those numbers.

**`max` is smaller than you expect.** A pool of 10 does not mean 10 requests per
second — it means 10 *concurrent queries*. If your median query takes 5 ms, ten
connections serve roughly 2,000 queries a second. Most applications are nowhere
near that, and raising `max` to 50 usually makes things slower, because the
database now context-switches between 50 processes competing for the same disk
and CPU. The arithmetic is in
[the sizing section](../../databases/operations/01-connection-pooling-part-1.md).

**The acquire timeout is a feature, not a failure.** When the pool is empty, you
want requests to fail in 5 seconds with a clear error you can alert on — not to
queue for 60 seconds and then all arrive at once.

---

## The Multiplication Trap

Stated plainly: **the pool is per process, and the database limit is global.**

```text
  pool max × number of processes  <  max_connections − reserved
```

Every deployment breaks this the same way. Work a real example against a
database with `max_connections = 100`:

| Consumer | Instances | Pool `max` | Connections |
|---|---|---|---|
| API servers | 4 | 10 | 40 |
| Background workers | 2 | 5 | 10 |
| Cron / scheduled jobs | 1 | 3 | 3 |
| Migration task during deploy | 1 | 2 | 2 |
| Superuser reserved slots | — | — | 3 |
| Monitoring agent, your `psql` | — | — | 5 |
| **Total** | | | **63 / 100** |

Comfortable. Now traffic doubles and the autoscaler takes the API from 4
instances to 12:

```text
  12 × 10  +  10 + 3 + 2 + 3 + 5  =  143       ✗  over the limit
```

**Nobody changed a config file. Nobody deployed.** New instances start, fail to
connect with `FATAL: sorry, too many clients already`, fail their health checks,
get replaced, and try again — while the instances that *did* connect are now
carrying all the traffic. The scaling rule meant to absorb the spike is what
turns it into an outage, and it fires precisely when load is highest.

> **⚠️ Warning:** size the pool from your autoscaler's **maximum** instance
> count, not its usual one. If it can reach 12 instances, budget for 12. With a
> 100-connection limit and 20 non-API connections, that is `80 / 12 ≈ 6` per
> pool. Six feels too small and is almost certainly correct.

Three ways out, in order: shrink the per-instance pool; put PgBouncer in front so
many client connections share few real ones
([part 2](../../databases/operations/01-connection-pooling-part-2.md)); or raise
`max_connections`, which costs memory and only moves the queue into the database.

---

## Pool Leaks in Application Code

This is the section to actually act on. A leak is simple: your code borrows a
connection and never returns it. The pool shrinks by one, permanently. Do it on
an error path that fires a hundred times a day and by evening the pool is empty
and every request times out.

**Shape 1: manual acquire with an exit path in between.**

```ts
// ❌ BROKEN — two leaks, and the second one is invisible.
async function exportProjectTasks(projectId: string) {
  const client = await pool.connect()

  const project = await client.query('SELECT id FROM projects WHERE id = $1', [projectId])
  if (project.rowCount === 0) {
    return null                       // leak 1: release() never runs
  }

  // leak 2: if this throws — constraint, timeout, network — release() never runs
  const rows = await client.query('SELECT * FROM tasks WHERE project_id = $1', [projectId])

  client.release()
  return rows.rows
}
```

The early `return` is at least visible in the diff. The thrown error is not: it
can come from any line, including inside the driver, and there is no code to
review that shows it.

```ts
// ✅ FIXED (preferred) — let the library own the borrow/return cycle.
// `db.query` / `knex(...)` / `prisma.x` acquire and release around one query.
async function exportProjectTasks(projectId: string) {
  const project = await db.from('projects').where('id', projectId).first()
  if (!project) return null
  return db.from('tasks').where('project_id', projectId)
}
```

```ts
// ✅ FIXED (when you genuinely need the raw client) — try/finally, always.
async function exportProjectTasks(projectId: string) {
  const client = await pool.connect()
  try {
    const project = await client.query('SELECT id FROM projects WHERE id = $1', [projectId])
    if (project.rowCount === 0) return null

    const rows = await client.query('SELECT * FROM tasks WHERE project_id = $1', [projectId])
    return rows.rows
  } finally {
    client.release()                  // runs on return, on throw, on everything
  }
}
```

`finally` is the whole lesson. If a line of code borrows a resource, the very
next thing you write is the `finally` that gives it back — before you write the
logic in between.

**Shape 2: the forgotten `await`.** Subtler and just as fatal.

```ts
// ❌ BROKEN — the function returns before the query settles.
async function logAudit(action: string) {
  const client = await pool.connect()
  try {
    client.query('INSERT INTO audit_log (action) VALUES ($1)', [action])  // no await
  } finally {
    client.release()      // released while the query is still in flight
  }
}
```

The `finally` runs immediately, the connection goes back to the pool mid-query,
and the next borrower inherits a connection with unread results. Symptoms are
bizarre: one request receiving another request's rows. A lint rule for floating
promises (`@typescript-eslint/no-floating-promises`) catches this class entirely;
turn it on.

**Shape 3: holding a connection for the whole request.** Acquiring a client in
middleware and releasing it in a response hook means the connection is held
while you call Stripe, render a template and serialise JSON — and any code path
that skips the hook leaks. Borrow per query, or per transaction. Never per
request.

> **📌 Remember:** every leak is the same bug wearing a different hat — a borrow
> whose return is not guaranteed by the language. Prefer the managed API, and
> when you cannot, `try/finally` is not optional.

---

## Long Transactions and Long Queries

A leak removes a connection permanently. A long transaction removes one
temporarily — which is less dramatic and far more common.

A transaction pins its connection from `BEGIN` to `COMMIT`. So an HTTP call
inside a transaction is not just a rollback problem (that argument is in
[03-transactions-part-1.md](03-transactions-part-1.md)); it is a pool problem
first. Thirty seconds waiting on Stripe is thirty seconds of a pool slot doing
nothing.

```text
  pool max = 10, transactions average 20 ms  →  ~500 transactions/second
  pool max = 10, transactions average 2 s    →  5 transactions/second
```

The same applies to an unindexed query that scans a large table, and to a
session left `idle in transaction` by the early-return bug. Three defences, all
configured rather than coded: `statement_timeout` kills the runaway query,
`idle_in_transaction_session_timeout` kills the abandoned session, and keeping
external calls outside transactions prevents both.

---

## Recognising Exhaustion from the Application Side

Pool exhaustion has a distinctive signature, and its cruelty is that it looks
like a database problem while the database is perfectly healthy.

| What you see | What it means |
|---|---|
| Request latency climbing steadily, not spiking | Requests are queueing for connections |
| `TimeoutError: Knex: Timeout acquiring a connection` | The pool was empty for the whole acquire timeout |
| Database CPU low, disk quiet, `pg_stat_activity` mostly idle | The bottleneck is your pool, not the server |
| All endpoints slow, including trivial ones | Contention is on the shared resource, not on a query |
| Latency does not recover after traffic drops | A leak — capacity is gone, not busy |

That last row is the one that identifies a leak rather than load. Load recovers.
A leak does not.

Guessing is unnecessary — the pool can tell you. Export four numbers and you
will never have to guess again:

```ts
// Sampled on a timer and exported to your metrics backend.
setInterval(() => {
  const p = db.pool                      // knex/tarn exposes these directly
  metrics.gauge('db.pool.used', p.numUsed())
  metrics.gauge('db.pool.free', p.numFree())
  metrics.gauge('db.pool.waiting', p.numPendingAcquires())  // ← the alert
  metrics.gauge('db.pool.max', poolMax)
}, 5_000)
```

**`waiting` is the metric that matters.** It should be zero almost all the time.
Anything above zero for a sustained period means requests are queueing, and it
rises *before* latency does — it is a leading indicator, not a symptom. Alert on
it, and on acquire-timeout errors, which should be zero.

Also instrument **acquire duration** as a histogram, separately from query
duration. Those two numbers answer completely different questions: slow queries
mean "fix the SQL", slow acquires mean "fix the pool or the leak". Averaged
together, they hide each other. See
[04-metrics-and-health-checks.md](../08-logging-and-observability/04-metrics-and-health-checks-part-1.md).

---

## Layering Your Timeouts

Every layer between the browser and the disk has a timeout. If they are set
carelessly the **wrong one fires first**, and you lose the information that would
have told you what happened.

**The rule: the innermost timeout must be the shortest**, and each layer outward
gets more time than the layer inside it.

| Layer | Setting | Example | Set it where |
|---|---|---|---|
| One SQL statement | `statement_timeout` | 10 s | Database role or connection string |
| Waiting for a lock | `lock_timeout` | 3 s | Database role |
| Abandoned transaction | `idle_in_transaction_session_timeout` | 30 s | Database role |
| Borrowing a connection | Pool acquire timeout | 5 s | Pool config |
| The whole HTTP handler | Request timeout | 30 s | Application middleware |
| The edge | Load balancer / proxy timeout | 60 s | Infrastructure |

Invert any two and the failure gets worse. Say the load balancer gives up at
15 s while `statement_timeout` is 30 s: the user gets a 504, the client
disconnects — **and the query keeps running**, still holding its pool slot and
its locks. You have an outage with no error in your logs and a connection you
cannot account for. Ordered correctly, the same incident produces `canceling
statement due to statement timeout`, naming the exact query.

> **💡 Tip:** give background jobs a separate database role with a much longer
> `statement_timeout`. One global value is always wrong for somebody — reports
> legitimately take minutes, web requests never should.

---

## Graceful Shutdown

When you deploy, the orchestrator sends `SIGTERM` and waits a grace period
before `SIGKILL`. `process.exit()` in that handler kills in-flight requests
mid-transaction: those transactions roll back, users see 502s, and connections
are torn down abruptly. Every deploy costs you a handful of failed requests.

The correct order is **stop taking work before you stop doing work**.

```ts
let shuttingDown = false

async function shutdown(signal: string) {
  if (shuttingDown) return             // SIGTERM can arrive twice
  shuttingDown = true
  logger.info({ signal }, 'shutdown started')

  // 1. Fail readiness first so the load balancer stops sending new requests.
  health.setNotReady()
  await sleep(5_000)                   // let the probe notice

  // 2. Stop accepting connections; in-flight requests keep running.
  await new Promise<void>((resolve) => server.close(() => resolve()))

  // 3. Stop workers that also borrow connections.
  await jobQueue.stop()

  // 4. Now the pool should be idle. end() waits for borrowed connections
  //    to come back, then closes them cleanly.
  await db.manager.closeAll()

  logger.info('shutdown complete')
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
```

> **⚠️ Warning:** closing the pool first is the common mistake. In-flight
> requests then fail with "pool is ended" — you converted a clean deploy into
> errors for exactly the users you were protecting.

Two constraints on the drain. Keep it **shorter than the orchestrator's grace
period**: if Kubernetes kills at 30 s and your longest request takes 60 s, the
drain never completes, so cap request duration instead. And add a **hard
timeout** on the whole shutdown, so one stuck connection cannot hang the deploy
forever. The process lifecycle around this is in
[01-anatomy-of-a-backend-app.md](../03-request-lifecycle/01-anatomy-of-a-backend-app.md).

---

## Read Replicas from the Application's Side

A read replica is a second database that streams changes from the primary. From
the application, it means **two pools** and a routing decision on every query.

```ts
// Two pools, two roles. The replica connection should be read-only at the
// database level too, so a routing bug cannot write to it.
const write = makePool(env.get('DB_PRIMARY_URL'), { max: 6 })
const read  = makePool(env.get('DB_REPLICA_URL'), { max: 10 })

export function forQuery(intent: 'read' | 'write' | 'read-own-write') {
  return intent === 'read' ? read : write
}
```

Note that the multiplication trap now applies **twice**, once per database. Two
pools of 10 on 12 instances is 240 connections across two servers, not 120 on
one.

The trap that will actually bite you is **read-after-write**. Replication is
asynchronous, so a replica is milliseconds to seconds behind:

```text
  t+0ms    POST /projects        →  primary: INSERT, COMMIT, 201
  t+40ms   GET  /projects        →  replica: still 80 ms behind
                                    response: the new project is missing
```

The user created something and it vanished. Nothing is broken, and nothing in
your logs says so. Practical rules:

- Route to the **primary** for the rest of the request after any write, and for
  a short window after (by session or by user).
- Route reports, exports, search and dashboards to the **replica** — these are
  the queries that benefit most and tolerate lag best.
- Treat "which replica am I on?" as unanswerable. Never assume two consecutive
  reads hit the same one.
- Monitor lag, and **stop routing reads to a replica that falls behind a
  threshold**. Serving badly stale data is worse than serving slowly.

Measuring lag, the fixes in depth, and what happens during failover are in
[04-read-replicas-and-replication-lag.md](../../databases/operations/04-read-replicas-and-replication-lag.md).

---

## Serverless and the Connection Storm

In a serverless runtime, every concurrent invocation is its own isolated
process. There is no shared pool — a pool of 5 in a function that scales to 200
concurrent invocations asks for up to 1,000 connections, and the database
refuses almost all of them at exactly the busiest moment.

Three mitigations, all outside your handler code: put a **connection proxy**
(PgBouncer, RDS Proxy, Supabase pooler, Neon's pooled endpoint) between the
functions and the database and point the function at it; keep the per-function
pool at **1**, since one invocation runs one request; or use a **driver that
speaks HTTP** instead of the PostgreSQL wire protocol, which removes the
persistent connection entirely. Details and the trade-offs of transaction-mode
pooling are in
[01-connection-pooling-part-2.md](../../databases/operations/01-connection-pooling-part-2.md).

---

## Advanced: Health Checks and Clustered Node

**A health check must test the pool without hammering the database.** The naive
readiness endpoint runs `SELECT 1` on every probe. With six instances probed
every five seconds, that is a query per second forever — and worse, the probe
*borrows a connection*, so when the pool is exhausted the health check fails
too, and the orchestrator restarts instances that were merely busy. Your
fastest path out of an incident is now restarting into the same one.

```ts
// Readiness: mostly free, and it distinguishes "busy" from "broken".
app.get('/ready', async (req, res) => {
  if (shuttingDown) return res.status(503).json({ status: 'draining' })

  const p = db.pool
  // A saturated pool is a warning, not a reason to be killed.
  const saturated = p.numFree() === 0 && p.numPendingAcquires() > 0

  // Only touch the database if the cached result is stale.
  const ok = await cachedPing(5_000)     // at most one SELECT 1 per 5 seconds

  if (!ok) return res.status(503).json({ status: 'db-unreachable' })
  return res.json({ status: 'ok', saturated, used: p.numUsed(), max: poolMax })
})
```

Keep **liveness** (is the process alive?) separate from **readiness** (should it
get traffic?). Liveness must never query the database: a database outage would
otherwise restart every instance you have.

**Per-worker pools in a clustered Node process.** `cluster` and PM2 fork one
worker per CPU core, and each worker is a separate process with its own pool.
Four workers with `max: 10` is 40 connections from one container, not 10 — a
multiplication trap hiding inside a single machine. Divide `max` by the worker
count, or, better, run one process per container and let the orchestrator do the
scaling, where the connection budget is visible in the deployment manifest
rather than buried in a process manager.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Raising `max` to fix slowness | More concurrency on a saturated database is slower | Find the slow query or the leak |
| Sizing from average instance count | The autoscaler silently breaks the budget | Size from the maximum |
| Manual `pool.connect()` without `finally` | Any throw or early return leaks a connection | Managed API, or `try/finally` |
| A query without `await` | The connection is released mid-query | Enable `no-floating-promises` |
| Holding a connection for the whole request | Pinned across HTTP calls and rendering | Borrow per query or per transaction |
| No acquire timeout | Requests queue forever behind a dead database | 5 s, and alert on the errors |
| No `statement_timeout` | One runaway query holds a slot indefinitely | Set it on the database role |
| Load balancer timeout shorter than `statement_timeout` | 504 with no log, query still running | Innermost timeout shortest |
| `process.exit()` on SIGTERM | In-flight requests die every deploy | Drain, then close the pool |
| Closing the pool before the HTTP server | "pool is ended" errors during shutdown | Server first, pool last |
| `SELECT 1` on every health probe | Adds load and borrows a slot during exhaustion | Cache the ping; report pool stats |
| Same `max` in every clustered worker | Silent multiplication inside one container | Divide by worker count |

---

## Questions to Test Yourself

1. Why is a PostgreSQL connection expensive in a way an HTTP connection is not?
2. Your pool is 10 and the median query takes 5 ms. Roughly what query
   throughput does that allow, and why does raising `max` to 50 often make it
   worse?
3. Write the multiplication-trap inequality, then calculate a safe `max` for 12
   API instances and `max_connections = 100`.
4. Describe exactly how autoscaling breaks a pool budget that nobody changed.
5. Give the two leaks in a manual `pool.connect()` function with an early
   return, and say which is harder to spot in review.
6. A query is issued without `await` inside a `try/finally`. Describe the
   symptom a user experiences.
7. Latency is climbing, the database is idle, and it does not recover when
   traffic falls. Leak or load? How do you know?
8. Which single pool metric is a leading indicator, and what should it normally
   be?
9. The load balancer times out at 15 s and `statement_timeout` is 30 s. Walk
   through what happens to the query, the logs, and the pool slot.
10. Put these in order and justify it: `statement_timeout`, acquire timeout,
    HTTP request timeout, load balancer timeout.
11. Why must the HTTP server close before the pool during shutdown?
12. Give the read-after-write timeline, and two rules that prevent it.
13. Why can a naive `SELECT 1` readiness probe make an incident worse?

---

## Related

- [01-connection-pooling-part-1.md](../../databases/operations/01-connection-pooling-part-1.md)
  — sizing mathematics, what a pool is, and diagnosing from `pg_stat_activity`.
- [01-connection-pooling-part-2.md](../../databases/operations/01-connection-pooling-part-2.md)
  — PgBouncer's three modes, what transaction mode breaks, and serverless.
- [03-transactions-part-1.md](03-transactions-part-1.md) — why a transaction is
  a pool reservation, and the early return that leaks one.
- [03-transactions-part-2.md](03-transactions-part-2.md) — `idle in
  transaction`, and the timeouts that clean it up.
- [04-read-replicas-and-replication-lag.md](../../databases/operations/04-read-replicas-and-replication-lag.md)
  — measuring lag, fixing read-after-write, and failover.
- [04-metrics-and-health-checks.md](../08-logging-and-observability/04-metrics-and-health-checks-part-1.md)
  — gauges, histograms, and liveness versus readiness.
- [01-anatomy-of-a-backend-app.md](../03-request-lifecycle/01-anatomy-of-a-backend-app.md)
  — the process lifecycle that graceful shutdown belongs to.
- [02-migrations-part-2.md](02-migrations-part-2.md) — how a blocked migration
  empties the pool in seconds.
- [health-checks.md](../../cloud-devops/deployment-strategies/health-checks.md)
  — what the orchestrator does with your readiness endpoint.
