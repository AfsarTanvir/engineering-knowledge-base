# Modules

A module is just a file whose internals are private by default — nothing is visible outside it unless you explicitly `export` it. Modules are how you break a codebase into independent, reusable, testable pieces instead of one giant global script.

## Table of Contents

1. [What Is It?](#what-is-it)
2. [Why Do We Need It?](#why-do-we-need-it)
3. [Named Exports vs Default Exports](#named-exports-vs-default-exports)
4. [Re-exporting (Barrel Files)](#re-exporting-barrel-files)
5. [CommonJS vs ES Modules](#commonjs-vs-es-modules)
6. [Circular Dependencies — A Real Bug](#circular-dependencies--a-real-bug)
7. [Module Scope in Practice](#module-scope-in-practice)
8. [What Happens Without Modules](#what-happens-without-modules)
9. [Common Mistakes](#common-mistakes)
10. [Questions to Test Yourself](#questions-to-test-yourself)

---

## What Is It?

```ts
// math.ts
export function add(a: number, b: number): number {
  return a + b;
}

function internalHelper() {
  // NOT exported — invisible outside this file
}

// app.ts
import { add } from "./math";

console.log(add(2, 3)); // 5
// internalHelper is not accessible here at all — it doesn't exist outside math.ts
```

Everything in a file is scoped to that file unless explicitly exported. This is "module scope" — one of the [scope](../scope/scope.md) types.

## Why Do We Need It?

- **Encapsulation:** hide implementation details, expose only what's needed (like closures do for functions, modules do for files).
- **Reuse:** one `formatDate.ts` file used across the whole app instead of copy-pasted logic.
- **Dependency clarity:** `import` statements at the top of a file tell you exactly what it depends on.
- **Testability:** you can import and test one function in isolation without loading the entire application.

## Named Exports vs Default Exports

```ts
// named exports — a file can have many, each imported by its exact name
export function formatCurrency(amount: number) { /* ... */ }
export function formatDate(date: Date) { /* ... */ }

import { formatCurrency, formatDate } from "./formatters";

// default export — a file has at most one, imported under any name you choose
export default class UserService { /* ... */ }

import UserService from "./user-service"; // you decide the local name
import MyOwnName from "./user-service";   // still works, same thing
```

**Practical recommendation:** prefer named exports. They force consistent naming across the codebase (no one accidentally imports the same thing under 5 different names), and they support better auto-import/refactor tooling in editors.

## Re-exporting (Barrel Files)

```ts
// validators/email.ts
export function isValidEmail(s: string) { /* ... */ }

// validators/phone.ts
export function isValidPhone(s: string) { /* ... */ }

// validators/index.ts — a "barrel" that re-exports everything
export * from "./email";
export * from "./phone";

// consumer code — one clean import instead of two
import { isValidEmail, isValidPhone } from "./validators";
```

Useful for a clean public API for a folder, but overusing barrels across a large codebase can slow down bundlers/TypeScript and obscure real dependency paths — use them for genuinely cohesive groups, not as a blanket habit.

## CommonJS vs ES Modules

Two different module systems exist in the JS/Node ecosystem — knowing which one you're in matters because their behavior around imports differs.

```js
// CommonJS (older, still default in many Node setups) — require/module.exports
const { add } = require("./math");
module.exports = { add };
// synchronous, resolved at require-time

// ES Modules (modern standard) — import/export
import { add } from "./math.js";
export { add };
// statically analyzed, can be tree-shaken by bundlers, supports top-level await
```

A common real-world source of confusion: mixing the two in one project ("Cannot use import statement outside a module", or `require()` of an ES module) — this is a config issue (`"type": "module"` in `package.json`, `tsconfig` module settings) more than a language issue, but you need to know which system you're actually running under.

## Circular Dependencies — A Real Bug

```ts
// a.ts
import { b } from "./b";
export const a = "value from a, uses: " + b;

// b.ts
import { a } from "./a";
export const b = "value from b, uses: " + a;

// this is a circular dependency — a needs b, b needs a
// depending on which one loads first, one of them will see the OTHER
// as `undefined` at import time, because it hasn't finished initializing yet
```

This shows up in real codebases as "why is this imported value `undefined` even though the file clearly exports it" — the fix is almost always to break the cycle (extract shared logic into a third file both depend on) rather than to "fix the import order."

## Module Scope in Practice

```ts
// config.ts
const API_KEY = process.env.API_KEY; // private to this module

export function getApiHeaders() {
  return { Authorization: `Bearer ${API_KEY}` };
}

// nowhere else in the codebase can directly read config.ts's API_KEY variable —
// only through the function you chose to expose
```

This is the module-level equivalent of the private-state pattern shown in [closures](../closures/closures.md) — instead of a function closing over a variable, a file "closes over" its top-level variables and exposes only what it exports.

## What Happens Without Modules

- Every variable/function lives in one giant global namespace — name collisions are inevitable as the codebase grows (this was literally how JS worked before modules existed, using `<script>` tags and globals).
- No clear way to know what a piece of code depends on without reading the whole thing.
- Impossible to test a single piece of logic in isolation.
- No tree-shaking — bundlers can't discard unused code because there's no static boundary of what's "exported" vs "internal."

## Common Mistakes

- Overusing default exports, leading to inconsistent naming for the same import across a codebase.
- Creating circular dependencies without realizing it, then "fixing" the symptom instead of the actual cycle.
- Exporting things "just in case" instead of keeping implementation details private — defeats the purpose of module boundaries.
- Mixing CommonJS and ESM without understanding which one a given file/project is using.

## Questions to Test Yourself

1. Why is a variable declared at the top of a file NOT accessible from another file unless exported?
2. What's a concrete downside of using default exports everywhere instead of named exports?
3. Why would two files importing from each other cause one of the imported values to be `undefined`?
4. Why can bundlers "tree-shake" unused code from ES modules but generally not from CommonJS?
