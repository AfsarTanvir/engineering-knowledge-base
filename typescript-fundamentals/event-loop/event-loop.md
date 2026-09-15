# The Event Loop

The event loop is the mechanism that lets single-threaded JavaScript handle async operations (timers, I/O, promises) without blocking. Understanding it is what lets you correctly predict "what order will these console.logs print in" — which is a very common interview question and a real source of production bugs (starvation, unexpected ordering).

## Table of Contents

1. [What Is It?](#what-is-it)
2. [Why Do We Care?](#why-do-we-care)
3. [Call Stack, Web APIs/Node APIs, Task Queues](#call-stack-web-apisnode-apis-task-queues)
4. [Microtasks vs Macrotasks](#microtasks-vs-macrotasks)
5. [The Classic Ordering Example](#the-classic-ordering-example)
6. [Why This Matters for Node.js Backends](#why-this-matters-for-nodejs-backends)
7. [Blocking the Event Loop — A Real Production Bug](#blocking-the-event-loop--a-real-production-bug)
8. [What Happens Without Understanding This](#what-happens-without-understanding-this)
9. [Questions to Test Yourself](#questions-to-test-yourself)

---

## What Is It?

JavaScript runs on **one thread**. The event loop is what allows that one thread to:
1. Run your synchronous code.
2. Hand off slow operations (timers, network calls, file I/O) to the runtime (browser or Node), which does them in the background.
3. Come back and run your callback once that operation finishes — but only when the thread is free.

```ts
console.log("1");
setTimeout(() => console.log("2"), 0);
console.log("3");

// Output: 1, 3, 2
// setTimeout hands the callback off to the runtime, which schedules it
// for AFTER the current synchronous code finishes — even with a 0ms delay.
```

## Why Do We Care?

- It explains why `setTimeout(fn, 0)` doesn't run immediately.
- It explains why a `Promise.then()` callback runs before a `setTimeout` callback, even if both are "ready" at the same time.
- It's the reason a single Node.js process can serve thousands of concurrent HTTP requests without threads — as long as you don't block it (see below).

## Call Stack, Web APIs/Node APIs, Task Queues

```text
Call Stack     → where your currently-running synchronous code executes
Web/Node APIs  → where timers, network calls, file reads run in the background
Microtask Queue → promise callbacks (.then/.catch/.finally, queueMicrotask)
Macrotask Queue → setTimeout/setInterval callbacks, I/O callbacks
```

The loop's rule: **after the call stack is empty, drain the ENTIRE microtask queue first, then run exactly one macrotask, then repeat.**

## Microtasks vs Macrotasks

```ts
console.log("start");

setTimeout(() => console.log("macrotask: setTimeout"), 0);

Promise.resolve().then(() => console.log("microtask: promise"));

console.log("end");

// Output:
// start
// end
// microtask: promise
// macrotask: setTimeout
```

Even though both were scheduled "immediately," the promise callback (microtask) always runs before the timeout (macrotask), because the event loop fully empties the microtask queue before touching the macrotask queue.

## The Classic Ordering Example

```ts
console.log("1: sync");

setTimeout(() => console.log("2: setTimeout"), 0);

Promise.resolve()
  .then(() => console.log("3: promise 1"))
  .then(() => console.log("4: promise 2"));

console.log("5: sync");

// Output: 1, 5, 3, 4, 2
// - all synchronous code runs first (1, 5)
// - then ALL queued microtasks drain, even chained ones (3, then 4)
// - only then does the macrotask (setTimeout) run (2)
```

## Why This Matters for Node.js Backends

A single Node process handles many concurrent requests by relying on this model: while request A is waiting on a database query (an async I/O operation handed off to the background), the event loop is free to start processing request B. This is why Node can serve high concurrency with low memory compared to a thread-per-request model — **as long as your code doesn't do heavy synchronous work that blocks the loop.**

## Blocking the Event Loop — A Real Production Bug

```ts
// BROKEN — synchronous CPU-heavy work blocks EVERY other request
app.get("/report", (req, res) => {
  let total = 0;
  for (let i = 0; i < 10_000_000_000; i++) {
    total += i; // this loop hogs the single thread
  }
  res.json({ total });
});
// while this runs, the server cannot respond to ANY other incoming request —
// not because of this route being slow, but because the ENTIRE process is stuck.

// FIXED (conceptually) — move CPU-heavy work off the main thread
// e.g., a worker_thread, a separate queue/worker process, or an external service
```

This is why "the server is slow for everyone" bugs are often caused by one synchronous, CPU-heavy route — not by the database, not by network latency, but by blocking the single JS thread that every other request also needs.

## What Happens Without Understanding This

- You can't predict console.log ordering or debug race conditions in async code.
- You might write a CPU-heavy synchronous loop in a request handler and be confused why the whole server "hangs" for unrelated requests.
- You might assume `setTimeout(fn, 0)` runs "right away," when it actually waits for the current synchronous code and all microtasks to finish first.

## Questions to Test Yourself

1. Why does a `Promise.then()` callback always run before a `setTimeout(fn, 0)` callback?
2. What are the two queues involved, and which one gets fully drained first?
3. Why can one slow synchronous route handler make an entire Node.js server unresponsive to other users?
4. If you need to do genuinely CPU-heavy work in a Node backend, what should you do instead of a big synchronous loop in a request handler?
