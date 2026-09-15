# The Event Loop — Advanced

The basics cover the call stack, microtasks vs macrotasks, and blocking the loop with synchronous work. This file goes into how Node's event loop is actually structured internally (it's not identical to the browser's), the priority ordering senior engineers get asked about in interviews, and how to actually get CPU-heavy work off the main thread instead of just knowing you shouldn't block it. See [event-loop.md](./event-loop.md) for the basics this builds on.

## Table of Contents

1. [Node's Event Loop Phases](#nodes-event-loop-phases)
2. [Node vs Browser Event Loop Differences](#node-vs-browser-event-loop-differences)
3. [`process.nextTick` vs Microtasks — Priority Ordering](#processnexttick-vs-microtasks--priority-ordering)
4. [worker_threads vs cluster](#worker_threads-vs-cluster)
5. [Event Loop Starvation Scenarios](#event-loop-starvation-scenarios)
6. [Why It Matters](#why-it-matters)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)

---

## Node's Event Loop Phases

The base file's "microtask queue vs macrotask queue" model is a simplification (accurate for browsers, and close enough for Node most of the time). Node's actual event loop (built on libuv) runs through **distinct phases**, each with its own callback queue, in a fixed order, once per loop iteration ("tick"):

```text
┌───────────────────────────┐
│           timers          │  setTimeout / setInterval callbacks whose time has elapsed
├───────────────────────────┤
│     pending callbacks     │  some system-level callbacks deferred from the previous cycle
├───────────────────────────┤
│       idle, prepare       │  internal use only
├───────────────────────────┤
│            poll           │  retrieve new I/O events; execute I/O-related callbacks
├───────────────────────────┤
│            check          │  setImmediate() callbacks
├───────────────────────────┤
│      close callbacks       │  e.g. socket.on('close', ...)
└───────────────────────────┘
```

Between **every phase transition**, and after every individual callback within a phase, Node fully drains the microtask queue (promises) and `process.nextTick` queue (see next section) before moving on.

```ts
import { readFile } from "fs";

setTimeout(() => console.log("timeout"), 0); // → timers phase
setImmediate(() => console.log("immediate")); // → check phase

readFile(__filename, () => {
  // inside an I/O callback (poll phase), setImmediate is GUARANTEED to run
  // before setTimeout, because check comes right after poll
  setTimeout(() => console.log("timeout inside I/O"), 0);
  setImmediate(() => console.log("immediate inside I/O"));
});
// Output order for the two inside readFile is deterministic: "immediate inside I/O" then "timeout inside I/O"
// Output order for the two at the top level is NOT deterministic — depends on process startup timing
```

This is why `setImmediate` exists as distinct from `setTimeout(fn, 0)`: `setImmediate` is specifically designed to run "right after I/O, in the check phase, before any new timers" — it's the reliable choice when you want something to run after the current I/O operation but don't care about wall-clock timing.

## Node vs Browser Event Loop Differences

The browser event loop (as specified by HTML) is simpler and, crucially, ties rendering to it: after processing a task, if it's time to render a frame, the browser drains microtasks and then does a render/paint step before the next macrotask.

```text
Browser: task → drain ALL microtasks → (maybe render/paint) → next task → ...
Node:    phase → drain microtasks + nextTick between phases → next phase (no rendering, ever) → ...
```

Practical consequence: `requestAnimationFrame` in the browser is scheduled around this render step and has no Node equivalent at all — Node has no concept of frames because it has no display to paint to. And Node's phase-based model means the "one microtask queue, one macrotask queue" mental model from the basics file is an approximation: Node actually has *multiple* macrotask-like queues (timers, I/O callbacks, `setImmediate`, close callbacks) that run in strict phase order, not just "the macrotask queue" as one bucket.

```ts
// this exact snippet can print in different relative order in a browser vs Node
// for the top-level (non-I/O) case, because timer scheduling granularity differs
setTimeout(() => console.log("timeout"), 0);
setImmediate?.(() => console.log("immediate")); // setImmediate doesn't exist in browsers at all
```

## `process.nextTick` vs Microtasks — Priority Ordering

Node has a queue that runs with **even higher priority than promise microtasks**: `process.nextTick`. The full priority order, applied after every single callback (not just at phase boundaries):

```text
1. process.nextTick queue     → drained COMPLETELY first
2. Promise microtask queue     → drained COMPLETELY second
3. (then the event loop proceeds to the next phase/callback)
```

```ts
console.log("start");

setTimeout(() => console.log("timeout"), 0);

Promise.resolve().then(() => console.log("promise microtask"));

process.nextTick(() => console.log("nextTick"));

console.log("end");

// Output:
// start
// end
// nextTick          <- process.nextTick queue drains FIRST, before promises
// promise microtask
// timeout
```

And critically, `process.nextTick` callbacks can **starve the entire event loop** if they keep scheduling more `nextTick` calls, because Node fully drains the `nextTick` queue — including anything newly added to it *during* that drain — before doing anything else at all, forever, until the queue is empty.

```ts
// BROKEN — this will hang the process, never reaching the timers phase, ever
function recurse() {
  process.nextTick(recurse); // keeps refilling the queue Node is trying to drain
}
recurse();
setTimeout(() => console.log("this never runs"), 0);
```

`process.nextTick` is Node-specific (no browser equivalent) and is meant for very narrow use cases: deferring a callback to run immediately after the current operation, before any I/O — commonly used inside library code to guarantee an API is *always* async, even when the result is already available synchronously (avoiding "sometimes sync, sometimes async" API bugs).

```ts
// ensures the callback ALWAYS runs asynchronously, even in the cache-hit path,
// so callers can rely on consistent behavior (never call the callback synchronously)
function getValue(key: string, callback: (err: Error | null, value?: string) => void) {
  if (cache.has(key)) {
    process.nextTick(() => callback(null, cache.get(key))); // force async even though we already have it
  } else {
    fetchFromDb(key, callback); // naturally async
  }
}
```

## worker_threads vs cluster

Both let Node use more than one CPU core, but for different problems.

**`worker_threads`** creates additional JS execution threads *within the same process*, each with its own event loop, that can share memory via `SharedArrayBuffer` and pass data via message-passing. Use it for **CPU-bound work** you want off the main thread without spinning up a whole separate process.

```ts
// main.ts
import { Worker } from "worker_threads";

function runHeavyComputation(data: number[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const worker = new Worker("./heavy-computation-worker.js", { workerData: data });
    worker.on("message", resolve);
    worker.on("error", reject);
  });
}

const result = await runHeavyComputation(largeDataset);
// the main event loop stays responsive to other requests while the worker crunches numbers
```

```ts
// heavy-computation-worker.js
import { parentPort, workerData } from "worker_threads";
const result = workerData.reduce((sum: number, n: number) => sum + expensiveTransform(n), 0);
parentPort!.postMessage(result);
```

**`cluster`** forks multiple *entire copies* of your Node process, each with its own event loop and memory space, load-balanced by the OS/master process, typically to use multiple cores for **handling more concurrent I/O-bound requests** (e.g., an HTTP server), not for CPU-bound computation within a single request.

```ts
import cluster from "cluster";
import os from "os";

if (cluster.isPrimary) {
  const cpuCount = os.cpus().length;
  for (let i = 0; i < cpuCount; i++) cluster.fork(); // each worker gets its own process + event loop
} else {
  startHttpServer(); // each forked process runs a full independent server instance
}
```

Rule of thumb: **`cluster`/PM2-style process management scales *concurrent request handling* across cores; `worker_threads` scales *a single expensive computation* off the main thread.** Using `cluster` to solve a CPU-bound single-request bottleneck doesn't help — that one blocking request still blocks whichever single worker process received it.

## Event Loop Starvation Scenarios

Starvation is when some category of callback (timers, I/O, etc.) never gets a chance to run because something else keeps monopolizing the loop. The basics file showed the simplest case (one giant synchronous loop). Here are less obvious variants senior engineers get asked about:

```ts
// STARVATION VIA RECURSIVE PROMISES — microtasks are drained COMPLETELY before
// moving to the next phase, so an infinite chain of .then() calls never lets
// timers or I/O run, even though no single callback takes long
function recurse(): Promise<void> {
  return Promise.resolve().then(() => recurse());
}
recurse();
setTimeout(() => console.log("never runs"), 0); // starved — microtask queue never empties
```

```ts
// STARVATION VIA process.nextTick — shown above, same category of bug,
// even higher priority than promise microtasks

// STARVATION VIA SYNCHRONOUS ARRAY METHODS ON HUGE DATA — looks async-friendly
// because it's "just" .map/.filter, but it's still one giant synchronous call
app.get("/export", (req, res) => {
  const rows = hugeDataset
    .map(transformRow)      // synchronous, blocks the loop for the entire duration
    .filter(isValid)         // same
    .sort(compareRows);      // same
  res.json(rows);
});
// no individual line "looks" like a CPU-heavy loop, but the total synchronous
// work is identical to one big for-loop — the event loop is blocked the whole time
```

The fix for the last one is the same as the basics file: break the work into chunks yielded back to the event loop (`setImmediate` between chunks), or move it to a `worker_thread`.

```ts
// yields control back to the event loop between chunks, so other requests can be served
async function processInChunks<T>(items: T[], chunkSize: number, fn: (item: T) => void) {
  for (let i = 0; i < items.length; i += chunkSize) {
    items.slice(i, i + chunkSize).forEach(fn);
    await new Promise((resolve) => setImmediate(resolve)); // give the loop a breather
  }
}
```

## Why It Matters

Assuming Node's event loop is "just microtasks then macrotasks" (the simplified browser mental model) leads to wrong predictions about `setImmediate` vs `setTimeout` ordering inside I/O callbacks — a real interview and real debugging trap. Not knowing `process.nextTick` has higher priority than promises (and can fully starve the loop if used recursively) means a library author can accidentally hang a production server with what looks like an innocuous recursive helper. And conflating `cluster` with `worker_threads` leads to scaling the wrong dimension — deploying more processes when the actual problem is one CPU-bound computation blocking a single request.

## Common Mistakes

- Treating Node's event loop as having exactly "one microtask queue and one macrotask queue," missing that `setTimeout`, I/O callbacks, and `setImmediate` are different phases with a fixed order.
- Assuming `setTimeout(fn, 0)` and `setImmediate(fn)` are interchangeable — their relative order is undefined at the top level but deterministic inside an I/O callback.
- Writing a recursive `process.nextTick` or recursive `.then()` chain (even one that does very little work per call) without realizing it can starve the entire event loop.
- Reaching for `cluster` to fix a slow, CPU-bound single request, when the real fix is a `worker_thread` (or moving the work out of the request path entirely).
- Assuming `.map()`/`.filter()`/`.sort()` on a huge array are "safe" just because they're built-in array methods — they're still fully synchronous and block the loop just like a manual `for` loop.

## Questions to Test Yourself

1. Inside an I/O callback, why is `setImmediate` guaranteed to run before `setTimeout(fn, 0)`, when at the top level their order is not guaranteed?
2. What is the priority order between `process.nextTick`, promise microtasks, and the next event loop phase?
3. How can a recursive `process.nextTick` call hang a Node process forever, even if each individual call does almost no work?
4. When would you reach for `worker_threads` instead of `cluster`, and why doesn't `cluster` fix a single slow CPU-bound request?
5. Why can chaining `.map().filter().sort()` on a huge array block the event loop just as badly as an explicit `for` loop, even though no single method call "looks" like manual iteration?
