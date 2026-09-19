# TypeScript/JavaScript Fundamentals

Weeks 1–2 of [doc/career-roadmap.md](../doc/career-roadmap.md). Every topic has a base file (what it is, why it matters, worked examples, real bugs it causes, self-test questions) and an `advanced.md` (deeper material worth knowing once the base is solid).

- **Scope** — [base](scope/scope.md) · [advanced](scope/advanced.md) — `var` vs `let`/`const`, block vs function scope, the classic loop bug, TDZ internals, IIFEs
- **Closures** — [base](closures/closures.md) · [advanced](closures/advanced.md) — private state, function factories, memoization, closures & memory leaks, currying
- **`this` Binding** — [base](this-binding/this-binding.md) · [advanced](this-binding/advanced.md) — dynamic vs lexical `this`, losing `this` in callbacks, `call`/`apply`/`bind`, the four binding rules
- **Objects and References** — [base](objects-and-references/objects-and-references.md) · [advanced](objects-and-references/advanced.md) — value vs reference copying, shallow/deep copy, structural typing, WeakMap, Proxy
- **Prototypes** — [base](prototypes/prototypes.md) · [advanced](prototypes/advanced.md) — the prototype chain, `class` as sugar, `Object.create`, mixins, shadowing pitfalls
- **Equality & Coercion** — [base](equality-and-coercion/equality-and-coercion.md) · [advanced](equality-and-coercion/advanced.md) — `==` vs `===`, the falsy list, `NaN`, `Object.is`, `??` vs `||`
- **Destructuring & Spread** — [base](destructuring-and-spread/destructuring-and-spread.md) · [advanced](destructuring-and-spread/advanced.md) — defaults, renaming, nested destructuring, rest vs spread, destructuring `undefined`
- **async/await & Promises** — [base](async-await-promise/async-await-promise.md) · [advanced](async-await-promise/advanced.md) — Promise states, `Promise.all` vs sequential await, `Promise.race`/`any`, AbortController, async generators
- **Event Loop** — [base](event-loop/event-loop.md) · [advanced](event-loop/advanced.md) — call stack, microtasks vs macrotasks, Node event loop phases, `process.nextTick`, worker_threads vs cluster
- **Error Handling** — [base](error-handling/error-handling.md) · [advanced](error-handling/advanced.md) — custom error classes, centralized error middleware, `Error.cause`, retry/backoff, circuit breakers
- **Modules** — [base](modules/modules.md) · [advanced](modules/advanced.md) — named vs default exports, CommonJS vs ESM, circular dependencies, dynamic `import()`, tree-shaking
- **Generics** — [base](generics/generics.md) · [advanced](generics/advanced.md) — generic functions/classes, constraints, conditional/mapped types, `infer`
- **Interfaces** — [base](interfaces/interfaces.md) · [advanced](interfaces/advanced.md) — object shapes, function-type interfaces, declaration merging, interfaces vs type aliases
- **Union & Intersection Types** — [base](union-intersection-types/union-intersection-types.md) · [advanced](union-intersection-types/advanced.md) — discriminated unions, composing shapes, exhaustiveness checking with `never`
- **unknown vs any** — [base](unknown-any/unknown-any.md) · [advanced](unknown-any/advanced.md) — safe placeholders for untrusted data, `as const`, runtime validation (Zod), locking down `any`
- **Type Narrowing** — [base](type-narrowing/type-narrowing.md) · [advanced](type-narrowing/advanced.md) — `typeof`/`in`/`instanceof`, user-defined type guards, assertion functions

## How to use this

1. Read one base file per sitting (not all in one day — see the daily routine in the roadmap).
2. Close the file, then answer its "Questions to Test Yourself" from memory.
3. Only move to the next topic once you can answer them without looking.
4. Once all 16 base files are solid, do a second pass through the `advanced.md` files the same way.
