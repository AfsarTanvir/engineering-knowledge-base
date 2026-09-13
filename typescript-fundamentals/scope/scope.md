# Scope

Scope determines **where a variable is visible and accessible** in your code. Getting this wrong causes bugs like "why is this variable undefined here" or "why did my loop capture the wrong value."

## Table of Contents

1. [What Is It?](#what-is-it)
2. [Why Do We Care?](#why-do-we-care)
3. [Types of Scope](#types-of-scope)
4. [`var` vs `let`/`const` — The Real Difference](#var-vs-letconst--the-real-difference)
5. [The Classic Loop Bug](#the-classic-loop-bug)
6. [Block Scope in Practice](#block-scope-in-practice)
7. [What Happens Without Proper Scoping](#what-happens-without-proper-scoping)
8. [Common Mistakes](#common-mistakes)
9. [Questions to Test Yourself](#questions-to-test-yourself)

---

## What Is It?

Every variable "lives" in some region of your code — a function, a block (`{ }`), or the whole module/file. That region is its **scope**. Outside that region, the variable doesn't exist (or a different variable with the same name does).

```ts
function greet() {
    const message = 'hello'; // scoped to greet()
    console.log(message);
}

greet();
console.log(message); // ReferenceError: message is not defined
```

## Why Do We Care?

- It's how JavaScript/TypeScript prevents variables from leaking everywhere and colliding.
- It's the mechanism behind closures (see [closures](../closures/closures.md)) — a function "remembers" the scope it was created in.
- Misunderstanding it is the #1 source of async/loop bugs.

## Types of Scope

```text
Global scope         → visible everywhere in the file/module
Function scope       → visible only inside the function (var respects this)
Block scope          → visible only inside { } (let/const respect this)
Module scope         → each file is its own scope unless you export things
```

```ts
const globalVar = "I'm global";

function outer() {
    const outerVar = "I'm function-scoped";

    if (true) {
        const blockVar = "I'm block-scoped";
        console.log(globalVar, outerVar, blockVar); // all visible here
    }

    console.log(blockVar); // ❌ ReferenceError — blockVar died with the if-block
}
outer();
```

## `var` vs `let`/`const` — The Real Difference

`var` is **function-scoped** and gets **hoisted** (declaration moved to the top, initialized as `undefined`). `let`/`const` are **block-scoped** and live in the "temporal dead zone" until their line executes.

```ts
function example() {
    console.log(a); // undefined (hoisted, not an error)
    var a = 1;

    console.log(b); // ❌ ReferenceError: Cannot access 'b' before initialization
    let b = 2;
}
example();
```

```ts
if (true) {
    var x = 'leaks out';
    let y = 'stays in';
}
console.log(x); // "leaks out" — var ignored the block
console.log(y); // ❌ ReferenceError — let respected the block
```

**Rule of thumb: never use `var` in new code.** Use `const` by default, `let` when you need to reassign.

## The Classic Loop Bug

This is the single most common real-world scope bug, and it's exactly why `let` exists.

```ts
// with var — BROKEN
for (var i = 0; i < 3; i++) {
    setTimeout(() => console.log(i), 0);
}
// prints: 3, 3, 3
// because there's only ONE `i` (function-scoped), and by the time the
// timeouts run, the loop has already finished and i is 3.

// with let — CORRECT
for (let i = 0; i < 3; i++) {
    setTimeout(() => console.log(i), 0);
}
// prints: 0, 1, 2
// because let creates a NEW `i` binding for each loop iteration,
// and each closure captures its own copy.
```

This is a direct bridge into [closures](../closures/closures.md) — each iteration's callback closes over a different `i` when using `let`.

## Block Scope in Practice

```ts
type Order = {
    status: string;
    total: number;
};
function processOrder(order: Order) {
    if (order.status === 'pending') {
        const tax = order.total * 0.1; // only exists inside this if-block
        order.total += tax;
    }
    // console.log(tax) here would be a ReferenceError — and that's GOOD,
    // it stops you from accidentally using a half-computed value elsewhere.
}
const order: Order = {
    status: 'pending',
    total: 1000,
};
processOrder(order);
console.log(order);
```

## What Happens Without Proper Scoping

- Variables leak into outer scope (`var` in a loop or `if`), causing accidental overwrites.
- Two unrelated pieces of code silently interfere with each other via a shared global.
- Debugging becomes "which of the 10 places that touch this global variable set it last?"

## Common Mistakes

- Using `var` out of habit (old tutorials, copy-pasted code).
- Assuming a loop variable is "fresh" per iteration when using `var` (it isn't).
- Shadowing a variable name in a nested scope and being confused about which one is being read/written:

```ts
const value = 'outer';
function test() {
    console.log(value); // ❌ not "outer" — ReferenceError (TDZ), see below
    const value = 'inner';
}
test();
```

This happens because `value` is declared somewhere in `test`'s scope (even later), so JS treats the whole function scope as "this name belongs to the inner `value`" from the start — the inner declaration shadows the outer one for the entire function body, and you hit it before it's initialized.

## Questions to Test Yourself

1. Why does `var i` in a `for` loop cause every `setTimeout` callback to log the same final value?
2. What's the difference between "not defined" and "cannot access before initialization"?
3. Why does TypeScript/ESLint recommend `const` over `let` by default?
4. If you truly need a variable that survives outside a block, where should you declare it?
