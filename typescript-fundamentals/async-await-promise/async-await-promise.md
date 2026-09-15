# Promises and async/await

A `Promise` represents a value that isn't available yet but will be (or will fail) at some point — the result of a database query, an HTTP request, a file read. `async/await` is syntax sugar on top of promises that lets you write asynchronous code that *reads* like synchronous code.

## Table of Contents

1. [What Is It?](#what-is-it)
2. [Why Do We Need It?](#why-do-we-need-it)
3. [Promise States](#promise-states)
4. [Creating and Using a Promise](#creating-and-using-a-promise)
5. [async/await — Same Thing, Cleaner Syntax](#asyncawait--same-thing-cleaner-syntax)
6. [Error Handling](#error-handling)
7. [Running Things in Parallel: `Promise.all`](#running-things-in-parallel-promiseall)
8. [Sequential vs Parallel — A Real Performance Bug](#sequential-vs-parallel--a-real-performance-bug)
9. [`Promise.allSettled` — When Some Can Fail](#promiseallsettled--when-some-can-fail)
10. [Common Mistakes](#common-mistakes)
11. [What Happens Without Understanding This](#what-happens-without-understanding-this)
12. [Questions to Test Yourself](#questions-to-test-yourself)

---

## What Is It?

```ts
// a Promise is a placeholder for a future value
const promise: Promise<string> = fetch("/api/user")
  .then((res) => res.json())
  .then((data) => data.name);
```

Instead of blocking the entire program while waiting for the network/disk, JS hands you a `Promise` immediately and calls your callback (`.then`) later, once the value is ready — without blocking anything else in the meantime.

## Why Do We Need It?

JavaScript is single-threaded. If `fetch("/api/user")` blocked the thread until the response arrived, your entire server (or entire browser tab) would freeze for every other request/user while waiting on one network call. Promises let JS start the operation, move on to other work, and come back when it's done. This is the entire reason Node.js can handle thousands of concurrent requests on one thread.

## Promise States

```text
pending    → still waiting
fulfilled  → succeeded, has a value
rejected   → failed, has an error
```

A promise moves from `pending` to exactly one of `fulfilled`/`rejected`, once, permanently.

## Creating and Using a Promise

```ts
function delay(ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms < 0) {
      reject(new Error("ms must be positive"));
      return;
    }
    setTimeout(() => resolve(), ms);
  });
}

delay(1000)
  .then(() => console.log("1 second passed"))
  .catch((err) => console.error(err));
```

`resolve()` fulfills the promise; `reject()` rejects it. `.then()` handles success, `.catch()` handles failure.

## async/await — Same Thing, Cleaner Syntax

```ts
// with .then chains — gets messy fast with multiple steps
function getUserOrders(userId: string) {
  return getUser(userId)
    .then((user) => getOrders(user.id))
    .then((orders) => orders.filter((o) => o.status === "active"));
}

// with async/await — reads top to bottom like sync code
async function getUserOrders(userId: string) {
  const user = await getUser(userId);
  const orders = await getOrders(user.id);
  return orders.filter((o) => o.status === "active");
}
```

`await` pauses execution of *this function* (not the whole program) until the promise settles. An `async` function always returns a `Promise`, even if you `return` a plain value inside it.

```ts
async function getName() {
  return "Afsar"; // this actually returns Promise<string>
}
getName().then((name) => console.log(name)); // "Afsar"
```

## Error Handling

```ts
// .then/.catch style
fetchUser(id)
  .then((user) => console.log(user))
  .catch((err) => console.error("Failed:", err));

// async/await style — use try/catch
async function loadUser(id: string) {
  try {
    const user = await fetchUser(id);
    console.log(user);
  } catch (err) {
    console.error("Failed:", err);
  }
}
```

**A rejected promise with no `.catch()` and no surrounding `try/catch` becomes an "unhandled promise rejection"** — in Node this can crash the process (depending on version/config). This is one of the most common production bugs: an `await` inside a route handler with no try/catch around it.

## Running Things in Parallel: `Promise.all`

```ts
// sequential — waits for user, THEN starts orders (slower)
const user = await getUser(id);
const orders = await getOrders(id);

// parallel — both start at the same time (faster, if independent)
const [user, orders] = await Promise.all([getUser(id), getOrders(id)]);
```

`Promise.all` waits for every promise to fulfill and returns their results in the same order. **If any one of them rejects, the whole `Promise.all` immediately rejects** — even if the others would have succeeded.

## Sequential vs Parallel — A Real Performance Bug

```ts
// BROKEN (performance-wise) — each await blocks the next one from starting
// 3 independent DB calls at 100ms each = 300ms total
async function loadDashboard(userId: string) {
  const profile = await getProfile(userId);   // 100ms
  const orders = await getOrders(userId);     // starts only after profile finishes — 100ms
  const invoices = await getInvoices(userId); // starts only after orders finishes — 100ms
  return { profile, orders, invoices };
}

// FIXED — these three calls don't depend on each other, so run them together
// 3 independent DB calls at 100ms each, run concurrently = ~100ms total
async function loadDashboard(userId: string) {
  const [profile, orders, invoices] = await Promise.all([
    getProfile(userId),
    getOrders(userId),
    getInvoices(userId),
  ]);
  return { profile, orders, invoices };
}
```

This exact mistake (awaiting things sequentially that don't depend on each other) is one of the most common backend performance bugs — it doesn't look wrong, it just quietly makes every request 3x slower than it needs to be.

## `Promise.allSettled` — When Some Can Fail

```ts
// don't want one failure to cancel out results from the others
const results = await Promise.allSettled([
  sendEmail(user1),
  sendEmail(user2),
  sendEmail(user3),
]);

results.forEach((result, i) => {
  if (result.status === "fulfilled") {
    console.log(`Email ${i} sent:`, result.value);
  } else {
    console.error(`Email ${i} failed:`, result.reason);
  }
});
```

Use `Promise.all` when you need every operation to succeed or the whole thing should fail. Use `Promise.allSettled` when partial success is acceptable (e.g., sending notifications to 100 users — one failing shouldn't stop the other 99).

## Common Mistakes

- Forgetting `await` — you get a `Promise` object instead of the value, and bugs like `if (promiseObject)` which is always truthy.
- Awaiting things sequentially that could run in parallel (see above).
- No error handling around `await` — an unhandled rejection.
- Mixing `async/await` with `.then()` unnecessarily, making code harder to read.
- Using `forEach` with an async callback expecting it to wait — it doesn't:

```ts
// BROKEN — forEach does NOT wait for the async callbacks
items.forEach(async (item) => {
  await processItem(item);
});
console.log("done"); // logs immediately, before any item is actually processed

// FIXED — use a for...of loop (sequential) or Promise.all with map (parallel)
for (const item of items) {
  await processItem(item); // sequential, waits properly
}

await Promise.all(items.map((item) => processItem(item))); // parallel, waits properly
```

## What Happens Without Understanding This

- Requests silently run 2-5x slower than necessary because of unnecessary sequential awaits.
- Unhandled promise rejections crash servers or silently swallow errors.
- Race conditions where code assumes an async operation finished when it didn't (the `forEach` bug above).

## Questions to Test Yourself

1. What are the three states a Promise can be in, and can it change states more than once?
2. Why does an `async` function always return a Promise, even when you write `return 5`?
3. When should you use `Promise.all` vs running things sequentially with multiple `await`s?
4. What's the difference between `Promise.all` and `Promise.allSettled`, and when would you pick one over the other?
5. Why doesn't `await` inside a `.forEach()` callback actually pause the loop?
