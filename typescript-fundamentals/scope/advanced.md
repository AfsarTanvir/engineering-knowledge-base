# Scope — Advanced

The basics (function vs block scope, `var` vs `let`, the loop bug) cover 90% of day-to-day bugs. This file covers the parts that show up when you're debugging genuinely confusing "why does this variable exist/not exist here" issues, reviewing a bundler config, or explaining to someone why a `switch` statement threw a weird error. See [scope.md](./scope.md) for the basics this builds on.

## Table of Contents

1. [The Temporal Dead Zone, Precisely](#the-temporal-dead-zone-precisely)
2. [Module Scope vs Script Scope](#module-scope-vs-script-scope)
3. [The `switch` Statement Scoping Trap](#the-switch-statement-scoping-trap)
4. [Scope Chains and Lookup Cost](#scope-chains-and-lookup-cost)
5. [IIFEs: History and Why You Rarely Need Them Now](#iifes-history-and-why-you-rarely-need-them-now)
6. [Why It Matters](#why-it-matters)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)

---

## The Temporal Dead Zone, Precisely

The base file shows that `let`/`const` throw if accessed before their declaration line. The mechanism behind that is the **Temporal Dead Zone (TDZ)**: from the start of the enclosing scope until the declaration executes, the binding exists (it's been "hoisted" in the sense that the *name* is reserved) but touching it is an error — it has no value yet, not even `undefined`.

```ts
{
  // TDZ for `config` starts here
  console.log(typeof config); // ❌ ReferenceError, NOT "undefined"
  let config = { env: "prod" };
  // TDZ ends here, `config` is now usable
}

console.log(typeof neverDeclared); // "undefined" — genuinely undeclared names are safe with typeof
```

This is why `typeof` is NOT always a safe way to check "does this exist" — it only saves you from undeclared names, not TDZ violations.

TDZ also applies to `class` declarations and to default parameters that reference later parameters:

```ts
function example(a = b, b = 2) {
  // ❌ ReferenceError: Cannot access 'b' before initialization
  // `a`'s default tries to read `b` before `b`'s own parameter binding is initialized
}
```

Function declarations don't have this problem because they're fully hoisted (declaration *and* value):

```ts
sayHi(); // ✅ works — function declarations are hoisted with their body
function sayHi() {
  console.log("hi");
}

sayBye(); // ❌ TypeError: sayBye is not a function (hoisted as `undefined`, TDZ for the `let`)
let sayBye = () => console.log("bye");
```

## Module Scope vs Script Scope

Every ES module (any file using `import`/`export`, or any `.ts` file compiled as a module) gets its **own top-level scope** — top-level `const x` in `a.ts` is not visible in `b.ts` unless explicitly exported. This is different from old-style `<script>` tags without `type="module"`, where every script shared one global scope, and one file's global `var` could collide with another's.

```ts
// a.ts
const secret = "only visible in a.ts";
export const shared = 42;

// b.ts
console.log(secret); // ❌ ReferenceError — module scope isolates this
import { shared } from "./a";
console.log(shared); // 42 — explicit export/import required
```

This is why you almost never see naming collisions across modern TS/JS files, but constantly saw them in old multi-`<script>`-tag pages (`app.js` and `vendor.js` both declaring `var config` and clobbering each other).

Node's CommonJS (`require`/`module.exports`) achieves the same isolation differently: each file is wrapped in a function by the module loader, giving it function-scope isolation rather than true module scope — but the practical effect (no accidental global leakage) is similar.

## The `switch` Statement Scoping Trap

A `switch` statement's `case` blocks do **not** each get their own scope — the whole `switch` body is one block. This causes a very specific, very common bug.

```ts
function describe(status: number) {
  switch (status) {
    case 1:
      let message = "pending"; // ❌ SyntaxError on re-declaration below,
      break;                    // because this `let` belongs to the WHOLE switch block
    case 2:
      let message = "active"; // ❌ "message has already been declared"
      break;
  }
}
```

Two `case`s tried to declare `let message` in what looks like separate blocks, but they're actually the same block. The fix is to wrap each `case` in its own `{ }`:

```ts
function describe(status: number) {
  switch (status) {
    case 1: {
      let message = "pending"; // ✅ scoped to this case's own block
      console.log(message);
      break;
    }
    case 2: {
      let message = "active"; // ✅ a different block, no collision
      console.log(message);
      break;
    }
  }
}
```

There's a subtler variant of this bug that doesn't throw but produces wrong TDZ behavior:

```ts
switch (status) {
  case 1:
    console.log(x); 
    // ❌ ReferenceError (TDZ) — even though `let x` is in a LATER case,
    // it belongs to the same block, so its TDZ covers this line too
    break;

  case 2:
    let x = 5;
    break;
}
```

## Scope Chains and Lookup Cost

When you reference a variable, the engine walks the **scope chain**: current scope → enclosing scope → ... → global scope, stopping at the first match. Deeply nested closures with long scope chains mean every lookup of an outer variable has to walk further.

```ts
function level1() {
  const a = 1;
  function level2() {
    const b = 2;
    function level3() {
      const c = 3;
      function level4() {
        console.log(a, b, c); // `a` requires walking 3 scopes up
      }
      level4();
    }
    level3();
  }
  level2();
}
```

In practice, modern JS engines (V8) optimize this heavily — scope chain lookups are not the bottleneck in real code 99% of the time, and premature "flattening" of nested functions for performance is usually a waste of effort. Where it *does* matter: extremely hot loops (millions of iterations) that reference deeply-nested outer variables can benefit from hoisting a frequently-used outer variable into a local one first — but measure before optimizing, don't guess.

```ts
// micro-optimization, only worth it in a proven hot path
function processLargeArray(items: number[], multiplier: number) {
  const m = multiplier; // local copy avoids repeated scope-chain walks in a tight loop
  for (let i = 0; i < items.length; i++) {
    items[i] *= m;
  }
}
```

## IIFEs: History and Why You Rarely Need Them Now

An **Immediately Invoked Function Expression (IIFE)** was the pre-ES6 way to create an isolated scope, because `var` had no block scope and there were no modules.

```ts
// classic IIFE pattern — creates a private scope so `counter` doesn't leak globally
var makeCounter = (function () {
  var counter = 0; // private, not accessible outside this IIFE
  return function () {
    return ++counter;
  };
})();

makeCounter(); // 1
makeCounter(); // 2
console.log(counter); // ❌ ReferenceError — counter never leaked out
```

This was essential in the era of concatenating many `<script>` files into one global scope — an IIFE was the only way to avoid `var` collisions between libraries (jQuery plugins are the textbook example: `(function($) { ... })(jQuery);`).

Today you rarely need this because:
- `let`/`const` already give you block scope.
- ES modules already give you file-level isolation (no leaking into `window`/`global`).
- Bundlers (webpack, esbuild, Vite) wrap modules in their own scopes automatically.

```ts
// modern equivalent — no IIFE needed, module scope + block scope already isolate this
let counter = 0;
export function increment() {
  return ++counter;
}
```

You'll still see IIFEs in two legitimate modern contexts: bundler output (to avoid polluting the global namespace of the bundled `<script>` tag) and `async` top-level code in environments without top-level `await` support:

```ts
(async () => {
  const data = await fetchData();
  console.log(data);
})();
```

## Why It Matters

Misreading TDZ as "the same thing as undeclared" leads to defensive `typeof` checks that don't actually protect you. Misunderstanding `switch` block scoping produces confusing `SyntaxError`s that look unrelated to the actual bug (people often blame `break` statements or case ordering). And not knowing why IIFEs exist means either cargo-culting them into new code that doesn't need them, or being confused when reading a decade of legacy code that's full of them.

## Common Mistakes

- Using `typeof x === "undefined"` to "safely" check a `let`/`const` binding that's actually in its TDZ — it throws instead of returning `"undefined"`.
- Declaring the same `let`/`const` name in two different `case` labels without wrapping each in `{ }`.
- Assuming a deeply nested closure is a performance problem without profiling first.
- Adding an IIFE around a module's top-level code "just in case," when the module system already provides that isolation.

## Questions to Test Yourself

1. What's the difference between a variable being "not declared" and a variable being "in the TDZ," and how does `typeof` behave differently for each?
2. Why does declaring `let x` in one `case` of a `switch` and again in another `case` throw a `SyntaxError`, and how do you fix it?
3. Why did IIFEs matter so much before ES6 modules existed, and what two modern features made most of them unnecessary?
4. Is a deeply nested scope chain something you should optimize by default? Why or why not?
