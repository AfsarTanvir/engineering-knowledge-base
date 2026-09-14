# Closures — Advanced

The basics cover what a closure is and the classic loop bug. This file covers what happens when closures interact with memory management, async code, and design decisions you'll actually make on a team — the kind of thing that shows up as a slow memory leak in production rather than an obviously wrong console.log. See [closures.md](./closures.md) for the basics this builds on.

## Table of Contents

1. [Closures and Garbage Collection](#closures-and-garbage-collection)
2. [Memory Leaks From Long-Lived Event Listeners](#memory-leaks-from-long-lived-event-listeners)
3. [Closures in Loops With async/await — A Subtler Bug](#closures-in-loops-with-asyncawait--a-subtler-bug)
4. [Currying and Partial Application](#currying-and-partial-application)
5. [Closures vs Classes for Encapsulation](#closures-vs-classes-for-encapsulation)
6. [Why It Matters](#why-it-matters)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)

---

## Closures and Garbage Collection

A closure keeps its captured variables alive for as long as the closure itself is reachable. This is not automatic magic that "just works" — it means the garbage collector cannot free that memory even if the variable is huge and you only need one small part of it.

```ts
function attachHandler() {
  const hugeBuffer = new Array(10_000_000).fill("x"); // ~huge amount of memory
  const id = "handler-1";

  // this closure only needs `id`, but it was DEFINED in the same scope as hugeBuffer
  return function onClick() {
    console.log("clicked:", id);
  };
}

const handler = attachHandler();
// hugeBuffer is NOT garbage collected as long as `handler` is reachable,
// even though onClick never references it — V8 can sometimes optimize this away,
// but you should never rely on that; assume the whole captured scope stays alive.
```

The safe mental model: a closure keeps alive the entire variable environment it was created in, not just the specific variables it happens to reference. Modern V8 does some dead-variable elimination, but it's an implementation detail, not a spec guarantee — don't design around it.

```ts
// safer — only capture what you actually need
function attachHandler() {
  const hugeBuffer = new Array(10_000_000).fill("x");
  const id = "handler-1";
  processBuffer(hugeBuffer); // use it here, don't let it leak into the returned closure

  return function onClick() {
    console.log("clicked:", id); // now this closure's scope doesn't need to hold hugeBuffer
  };
}
```

## Memory Leaks From Long-Lived Event Listeners

The most common real-world closure memory leak: attaching a listener that closes over a large object or DOM node, and never removing the listener.

```ts
// BROKEN — leaks memory every time this runs and the component is later removed
function setupWidget(container: HTMLElement) {
  const largeDataset = fetchLargeDataset(); // large in-memory object

  const onScroll = () => {
    renderVisibleRows(largeDataset, container.scrollTop);
  };

  window.addEventListener("scroll", onScroll);
  // if this widget is later destroyed/unmounted but onScroll is never removed,
  // `window` still holds a reference to onScroll, which holds `largeDataset`
  // and `container` alive FOREVER — even after the widget is gone from the DOM.
}

// FIXED — always pair addEventListener with removeEventListener
function setupWidget(container: HTMLElement) {
  const largeDataset = fetchLargeDataset();

  const onScroll = () => {
    renderVisibleRows(largeDataset, container.scrollTop);
  };

  window.addEventListener("scroll", onScroll);

  return function cleanup() {
    window.removeEventListener("scroll", onScroll); // breaks the reference chain
  };
}
```

This exact pattern is why React's `useEffect` requires a cleanup function, and why forgetting one is the #1 cause of "memory grows every time I navigate between pages" bugs in single-page apps — each mount creates a new closure attached to a long-lived object (`window`, a global event bus, a WebSocket), and without cleanup, every previous mount's closure (and everything it captured) stays alive forever.

```tsx
useEffect(() => {
  const onResize = () => setWidth(window.innerWidth);
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize); // the cleanup IS the fix
}, []);
```

## Closures in Loops With async/await — A Subtler Bug

The base file's loop bug (`var` vs `let` with `setTimeout`) is well known. A subtler version of the same root cause shows up with `async/await` in loops, and it's easy to miss because the code "looks" sequential.

```ts
// BROKEN — looks fine, but all requests share incorrectly-ordered side effects
async function processUsers(userIds: string[]) {
  const results: string[] = [];

  for (let i = 0; i < userIds.length; i++) {
    fetchUser(userIds[i]).then((user) => {
      // each callback closes over `i` correctly (let = per-iteration binding),
      // BUT the callbacks resolve in whatever order the network returns them —
      // NOT necessarily in loop order, so `results` ends up out of order
      results[i] = user.name; // this part is actually fine, since `i` is captured correctly
    });
  }

  return results; // ❌ returns BEFORE any fetchUser has resolved — the real bug
}
```

The `let` closure capture is correct here — that's not the bug. The bug is forgetting to `await` inside the loop, so the function returns an array of `undefined`s before any promise settles. The fix depends on whether order/concurrency matters:

```ts
// FIXED — parallel, but you still need to wait for all of them
async function processUsers(userIds: string[]) {
  const results = await Promise.all(userIds.map((id) => fetchUser(id).then((u) => u.name)));
  return results;
}
```

A genuinely closure-related async bug: capturing a *mutable* loop variable inside a `.then()` chain that runs later, expecting it to reflect the value "at call time" rather than "at resolution time."

```ts
// BROKEN — `let` per-iteration binding doesn't save you if you mutate a SHARED object
async function tagRequests(ids: string[]) {
  const sharedContext = { requestCount: 0 };

  for (const id of ids) {
    sharedContext.requestCount++; // mutating the SAME object every iteration
    fetchData(id).then((data) => {
      // by the time this resolves, sharedContext.requestCount may have
      // already been incremented by later iterations — it's a shared reference,
      // not a per-iteration value, regardless of let/const
      console.log(`request #${sharedContext.requestCount}:`, data);
    });
  }
}
```

This is really an [objects-and-references](../objects-and-references/objects-and-references.md) problem wearing a closures costume: `let` gives you a fresh *binding* per iteration, but it does nothing to protect a shared *object* referenced from every iteration.

## Currying and Partial Application

Currying transforms a function of multiple arguments into a chain of single-argument functions, each closure "remembering" the arguments supplied so far. It's a direct, practical application of closures beyond toy examples.

```ts
// a manual curry — each returned function closes over the args accumulated so far
function curry<A, B, C>(fn: (a: A, b: B) => C) {
  return (a: A) => (b: B) => fn(a, b);
}

function add(a: number, b: number) {
  return a + b;
}

const curriedAdd = curry(add);
const add5 = curriedAdd(5); // closes over a = 5
console.log(add5(3)); // 8
console.log(add5(10)); // 15 — reuses the same "a = 5" closure
```

Partial application is the more general/practical cousin: pre-filling *some* arguments, not necessarily one at a time.

```ts
function partial<T extends unknown[], U extends unknown[], R>(
  fn: (...args: [...T, ...U]) => R,
  ...preset: T
) {
  return (...rest: U) => fn(...preset, ...rest);
}

function logMessage(level: string, service: string, message: string) {
  console.log(`[${level}] (${service}) ${message}`);
}

const logError = partial(logMessage, "ERROR"); // closes over level = "ERROR"
logError("payments", "charge failed"); // [ERROR] (payments) charge failed
logError("auth", "token expired");     // [ERROR] (auth) token expired
```

This pattern is exactly how middleware factories, configured loggers, and pre-bound API clients are usually built in real codebases — a closure "bakes in" config once, and the returned function is reused everywhere with less boilerplate.

## Closures vs Classes for Encapsulation

Both give you private state, but they trade off differently. The base file showed a closure-based bank account. Here's the same thing as a class, to compare directly.

```ts
// closure-based — true privacy, no `this`, one instance per factory call
function createBankAccount(initialBalance: number) {
  let balance = initialBalance;
  return {
    deposit: (amount: number) => (balance += amount),
    getBalance: () => balance,
  };
}

// class-based — privacy via `#` private fields, supports inheritance, `instanceof`
class BankAccount {
  #balance: number;
  constructor(initialBalance: number) {
    this.#balance = initialBalance;
  }
  deposit(amount: number) {
    this.#balance += amount;
  }
  getBalance() {
    return this.#balance;
  }
}
```

Trade-offs:
- **Memory:** the closure version creates a *new* set of functions (`deposit`, `getBalance`) per call — for thousands of instances, that's thousands of duplicate function objects. Class methods live once on the prototype and are shared across all instances.
- **Inheritance:** classes support `extends`/`super` naturally. Composing behavior with closures usually means composing functions manually (no built-in inheritance model), which some consider a feature, not a limitation.
- **`instanceof` / identity checks:** classes give you `account instanceof BankAccount`. Closures give you a plain object shape — you'd rely on structural typing (see [objects-and-references advanced](../objects-and-references/advanced.md)) instead.
- **`this` footguns:** classes reintroduce `this`-binding issues (a method passed as a callback loses its `this` unless bound/arrow-wrapped). Closures sidestep `this` entirely.

```ts
class Counter {
  #count = 0;
  increment() {
    this.#count++;
    return this.#count;
  }
}
const counter = new Counter();
const detached = counter.increment;
detached(); // ❌ TypeError: Cannot read private member #count — `this` is now undefined
```

Rule of thumb: reach for closures for a handful of one-off stateful helpers (memoizers, small factories); reach for classes when you have many instances of the same shape, need inheritance, or need `instanceof`/tooling support (decorators, DI frameworks) that assumes classes.

## Why It Matters

Closures are the reason JavaScript's "everything is passed by function" style works at all — but the same mechanism that makes private state and factories convenient is exactly what causes silent, hard-to-profile memory leaks when listeners aren't cleaned up. And picking closures vs classes isn't a style preference once you're dealing with thousands of instances — it's a real memory and performance decision.

## Common Mistakes

- Assuming V8 always frees unused captured variables from a closure's scope — don't rely on it; keep closures narrow.
- Attaching event listeners in a closure without ever removing them, especially in single-page apps where components mount/unmount repeatedly.
- Blaming `let`'s per-iteration binding for a bug that's actually a shared mutable object being referenced from every iteration.
- Forgetting `await`/`Promise.all` in an async loop and assuming the closure bug (which is actually fixed by `let`) is what's still wrong.
- Reaching for a closure-based factory for a class that will have thousands of instances, needlessly duplicating method objects per instance.

## Questions to Test Yourself

1. Why can a closure keep a huge unrelated object alive in memory, even if the closure itself never reads that object?
2. Why does forgetting `removeEventListener` on a closure-based handler cause a memory leak specifically in single-page apps?
3. In the async loop example, is the "wrong order of results" bug caused by `let` failing to create per-iteration bindings, or by something else? What?
4. What's the practical memory trade-off between a closure-based factory and a class when you need 10,000 instances?
