# Closures

A closure is what happens when a function **"remembers" the variables from the scope it was created in**, even after that outer scope has finished running. This isn't an optional advanced feature — it's how JavaScript functions work by default, and it silently powers things like `useState`, event handlers, memoization, and private data.

## Table of Contents

1. [What Is It?](#what-is-it)
2. [Why Do We Use It?](#why-do-we-use-it)
3. [The Core Example](#the-core-example)
4. [Practical Use 1: Private State / Data Encapsulation](#practical-use-1-private-state--data-encapsulation)
5. [Practical Use 2: Function Factories](#practical-use-2-function-factories)
6. [Practical Use 3: Memoization / Caching](#practical-use-3-memoization--caching)
7. [The Loop + Closure Bug (and Fix)](#the-loop--closure-bug-and-fix)
8. [What Happens Without Closures](#what-happens-without-closures)
9. [Trade-offs / Gotchas](#trade-offs--gotchas)
10. [Questions to Test Yourself](#questions-to-test-yourself)

---

## What Is It?

```ts
function makeCounter() {
  let count = 0; // this variable lives in makeCounter's scope

  return function increment() {
    count++; // increment "closes over" count
    return count;
  };
}

const counter = makeCounter();
console.log(counter()); // 1
console.log(counter()); // 2
console.log(counter()); // 3
```

`makeCounter()` finished running and returned. Normally `count` would be garbage-collected. But because `increment` still references `count`, JavaScript keeps it alive. That bundle of "function + the variables it references from its birth scope" is a **closure**.

## Why Do We Use It?

- To create private state without classes (`count` above can't be accessed or modified except through `increment`).
- To configure a function once and reuse it (function factories).
- To cache expensive results between calls (memoization).
- It's the mechanism behind virtually every callback-based API: event listeners, `setTimeout`, array methods, React hooks.

## The Core Example

```ts
function outer() {
  const message = "captured";

  function inner() {
    console.log(message); // inner "closes over" message
  }

  return inner;
}

const fn = outer(); // outer() has already returned
fn(); // "captured" — message is still alive because fn references it
```

## Practical Use 1: Private State / Data Encapsulation

```ts
function createBankAccount(initialBalance: number) {
  let balance = initialBalance; // not accessible from outside directly

  return {
    deposit(amount: number) {
      balance += amount;
      return balance;
    },
    withdraw(amount: number) {
      if (amount > balance) throw new Error("Insufficient funds");
      balance -= amount;
      return balance;
    },
    getBalance() {
      return balance;
    },
  };
}

const account = createBankAccount(100);
account.deposit(50);
console.log(account.getBalance()); // 150
// there is NO way to directly do account.balance = 1000000 — it's private
```

This is a real alternative to a class with a private field, and it's a common interview question: "implement a counter/bank account without exposing internal state."

## Practical Use 2: Function Factories

```ts
function multiplyBy(factor: number) {
  return (n: number) => n * factor; // closes over `factor`
}

const double = multiplyBy(2);
const triple = multiplyBy(3);

console.log(double(5)); // 10
console.log(triple(5)); // 15
```

Each returned function keeps its own `factor` — this is how you build configurable, reusable pieces of logic (validators, formatters, middleware factories in Express/Adonis, etc.).

## Practical Use 3: Memoization / Caching

```ts
function memoize(fn: (n: number) => number) {
  const cache = new Map<number, number>(); // closed over by the returned function

  return (n: number) => {
    if (cache.has(n)) return cache.get(n)!;
    const result = fn(n);
    cache.set(n, result);
    return result;
  };
}

const slowSquare = (n: number) => {
  for (let i = 0; i < 1e8; i++); // pretend this is expensive
  return n * n;
};

const fastSquare = memoize(slowSquare);
fastSquare(5); // slow the first time
fastSquare(5); // instant — served from `cache`
```

## The Loop + Closure Bug (and Fix)

This is the same bug shown in [scope](../scope/scope.md), but it's really a **closures** problem: each callback closes over a variable, and which variable (shared vs per-iteration) determines the outcome.

```ts
// BROKEN — var is function-scoped, so there's one shared `i`
// all 3 closures close over the SAME i, which is 3 by the time they run
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 100);
}
// 3, 3, 3

// FIXED — let creates a new binding per iteration
// each closure closes over its OWN i
for (let i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 100);
}
// 0, 1, 2
```

## What Happens Without Closures

You'd have to pass every piece of state explicitly through every function call, or store it globally. Globals mean shared mutable state — any code anywhere could read/write it, which is exactly the bug class closures let you avoid (accidental external mutation, name collisions).

## Trade-offs / Gotchas

- **Memory:** a closure keeps its captured variables alive as long as the closure itself is reachable. Holding onto closures you no longer need (e.g., in long-lived event listeners) can leak memory — remove listeners / clear references when done.
- **Debugging:** closures can make it less obvious where a value came from, since it's not a parameter or a local — it's "borrowed" from an outer scope.
- **Shared mutable closures:** if two closures capture the *same* mutable variable, changes from one are visible to the other — sometimes desired (the bank account example), sometimes an accidental bug.

## Questions to Test Yourself

1. Why does `makeCounter()`'s `count` variable not get garbage collected after the function returns?
2. How would you implement a private counter without using a class?
3. What's the actual difference between the `var` and `let` versions of the loop example — is it a scope issue, a closure issue, or both?
4. Why can memoization introduce a memory-growth issue if the cache is never cleared?
