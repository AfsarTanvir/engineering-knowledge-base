# Type Narrowing — Advanced

The base file covers narrowing that TypeScript figures out entirely on its own, from `typeof`/`instanceof`/`in`/discriminant checks. The advanced layer is about **teaching** the compiler new narrowing logic through custom predicates and assertion functions, handling narrowing across more complex class hierarchies, and understanding the specific, frequently-surprising situations where narrowing simply doesn't survive — particularly inside closures.

See [type-narrowing.md](./type-narrowing.md) for the basics — `typeof`, `instanceof`, `in`, equality narrowing, and exhaustiveness with `never`.

## Table of Contents

1. [User-Defined Type Guards (`is` Predicates)](#user-defined-type-guards-is-predicates)
2. [Assertion Functions (`asserts`)](#assertion-functions-asserts)
3. [`in`/`instanceof` in Complex Class Hierarchies](#ininstanceof-in-complex-class-hierarchies)
4. [Why Narrowing "Forgets" Inside a Callback](#why-narrowing-forgets-inside-a-callback)
5. [Working Around Narrowing Loss](#working-around-narrowing-loss)
6. [Why It Matters](#why-it-matters)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)

---

## User-Defined Type Guards (`is` Predicates)

A function whose return type is `param is Type` teaches the compiler a new narrowing rule: "if this returns `true`, trust that `param` is `Type` from here on." This is how you extend narrowing beyond the built-in operators to arbitrary custom logic.

```ts
interface Cat { kind: "cat"; meow(): void; }
interface Dog { kind: "dog"; bark(): void; }
type Pet = Cat | Dog;

function isCat(pet: Pet): pet is Cat {
  return pet.kind === "cat";
}

function play(pet: Pet) {
  if (isCat(pet)) {
    pet.meow(); // narrowed to Cat, purely because isCat said so
  } else {
    pet.bark(); // narrowed to Dog by elimination
  }
}
```

Predicates are especially valuable for validating `unknown` data, where no built-in operator can express the check in one step:

```ts
interface ApiUser { id: string; name: string; email: string; }

function isApiUser(value: unknown): value is ApiUser {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.email === "string"
  );
}

function handleResponse(body: unknown) {
  if (isApiUser(body)) {
    console.log(body.email); // safely narrowed, fully checked, not just asserted
  }
}
```

An important, easy-to-miss danger: **a predicate is only as trustworthy as its implementation.** TypeScript does not verify that the body of `isApiUser` actually proves what the signature claims — a sloppy predicate that returns `true` too eagerly narrows to a type that isn't really guaranteed, silently reintroducing the exact class of bug guards are meant to prevent.

```ts
// a LYING predicate — compiles fine, but is worse than useless
function isApiUserBad(value: unknown): value is ApiUser {
  return typeof value === "object"; // doesn't check id/name/email at all!
}
```

## Assertion Functions (`asserts`)

An assertion function doesn't return a boolean to be checked in an `if` — it either returns normally (meaning the assertion held) or throws. TypeScript narrows the variable for all code **after the call**, in the same scope, rather than only inside a branch.

```ts
function assertIsString(value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`Expected string, got ${typeof value}`);
  }
}

function process(value: unknown) {
  assertIsString(value);
  console.log(value.toUpperCase()); // ✅ narrowed to string for the rest of this scope,
                                     // with no surrounding if/else needed
}
```

A more general, condition-only form (no type predicate, just "keep going only if true") is also legal:

```ts
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function divide(a: number, b: number) {
  assert(b !== 0, "Division by zero");
  return a / b; // TypeScript doesn't change b's type here, but the guard is a real runtime check
}
```

Assertion functions are the natural fit for **precondition checks at the top of a function** (validating arguments before use) where an `if`-based guard would otherwise force awkward early returns or deep nesting.

```ts
interface Config { apiKey: string; timeout: number; }

function assertValidConfig(config: unknown): asserts config is Config {
  if (
    typeof config !== "object" || config === null ||
    typeof (config as any).apiKey !== "string" ||
    typeof (config as any).timeout !== "number"
  ) {
    throw new Error("Invalid config shape");
  }
}

function startApp(rawConfig: unknown) {
  assertValidConfig(rawConfig);
  console.log(rawConfig.apiKey); // narrowed for the rest of startApp, no branching required
}
```

## `in`/`instanceof` in Complex Class Hierarchies

With more than two levels of inheritance, `instanceof` narrows to the *most specific* matching class in the chain — and ordering your checks from most-specific to least-specific matters, exactly like `catch` blocks or `switch` cases.

```ts
class ApiError extends Error {
  constructor(message: string, public statusCode: number) { super(message); }
}
class NotFoundError extends ApiError {
  constructor(resource: string) { super(`${resource} not found`, 404); }
}
class ValidationError extends ApiError {
  constructor(public field: string, message: string) { super(message, 400); }
}

function handle(error: Error) {
  if (error instanceof NotFoundError) {
    console.log(`404: ${error.message}`); // narrowed to NotFoundError specifically
  } else if (error instanceof ValidationError) {
    console.log(`400 on field ${error.field}`); // narrowed to ValidationError
  } else if (error instanceof ApiError) {
    console.log(`API error ${error.statusCode}`); // any OTHER ApiError subtype
  } else {
    console.log(`Unknown error: ${error.message}`); // plain Error, or something else entirely
  }
}
```

Checking `ApiError` *before* `NotFoundError` would be a real bug — every `NotFoundError` is also an `ApiError` (`instanceof` walks the whole prototype chain), so the more general branch would swallow the specific one and it would never be reached. This mirrors the ordering rule for `catch` clauses and `switch` fallthrough in other languages.

`in` becomes trickier across hierarchies with **optional** methods, since the property might exist on the prototype without being callable in every legitimate state:

```ts
interface Streamable { stream(): AsyncIterable<Uint8Array>; }
interface Downloadable { download(): Promise<Buffer>; }

function fetchContent(source: Streamable | Downloadable | (Streamable & Downloadable)) {
  if ("stream" in source) {
    // narrowed to Streamable | (Streamable & Downloadable) — "in" only proves the property EXISTS,
    // it doesn't rule out the intersection case, unlike instanceof against a concrete class
  }
}
```

## Why Narrowing "Forgets" Inside a Callback

This is one of the most common "TypeScript is being dumb" complaints, and it's actually correct, conservative behavior: TypeScript narrows based on **control flow it can statically prove**, and a callback might run *later*, after the variable could have been reassigned.

```ts
interface Config { apiUrl?: string; }

function connect(config: Config) {
  if (config.apiUrl) {
    // config.apiUrl narrowed to `string` HERE
    setTimeout(() => {
      fetch(config.apiUrl.toUpperCase());
      // ❌ error — Object is possibly 'undefined'
      // TypeScript can't prove config.apiUrl is still defined by the time
      // this callback actually executes — something else could have mutated
      // config in between the check and the callback running
    }, 1000);
  }
}
```

The property access (`config.apiUrl`, not a plain local variable) makes this worse: TypeScript narrows properties more conservatively than local `const` variables in general, because a property can be changed through any reference to the same object, including from code the narrowing analysis can't see (another function holding the same `config` object, a getter with side effects, etc).

```ts
// even a LOCAL variable loses narrowing across a closure if it's declared `let`
function process(value: string | number) {
  if (typeof value === "string") {
    setTimeout(() => {
      value.toUpperCase(); // ✅ actually fine IF `value` is a parameter/const never reassigned
    }, 100);
  }
}

// but this DOES lose narrowing, because `value` is reassignable and the callback
// could run after a reassignment TypeScript can't rule out:
function processMutable(getValue: () => string | number) {
  let value = getValue();
  if (typeof value === "string") {
    value = getValue(); // reassigned — could now be a number again!
    setTimeout(() => {
      value.toUpperCase(); // ❌ error — narrowing was invalidated by the reassignment
    }, 100);
  }
}
```

## Working Around Narrowing Loss

The standard fix is to copy the narrowed value into a new `const` binding right after the check — a `const` can never be reassigned, so TypeScript is willing to trust its narrowed type inside any nested closure, no matter when that closure runs.

```ts
function connect(config: Config) {
  if (config.apiUrl) {
    const apiUrl = config.apiUrl; // snapshot into a const — narrowing now "sticks"
    setTimeout(() => {
      fetch(apiUrl.toUpperCase()); // ✅ fine — `apiUrl` can never become undefined again
    }, 1000);
  }
}
```

For assertion-style helpers, the same idea applies — assert, then immediately capture into a `const` if the value will be used inside any nested function:

```ts
function startApp(rawConfig: unknown) {
  assertValidConfig(rawConfig);
  const config = rawConfig; // now a stable, narrowed const
  setTimeout(() => console.log(config.apiKey), 0); // safe
}
```

## Why It Matters

- Type predicates and assertion functions are how you extend TypeScript's narrowing to your own domain logic (validated API shapes, custom error hierarchies, business rules) instead of being limited to `typeof`/`instanceof`/`in`.
- A dishonest predicate (returns `true` without really checking) is a silent, compiler-endorsed way to reintroduce exactly the runtime crash class narrowing exists to prevent — worse than no predicate at all, because it looks safe.
- The closure-narrowing-loss behavior is one of the most common sources of "TypeScript error that looks wrong but isn't" — understanding *why* it happens (reassignability, not just "callbacks are weird") turns it from a fight into a five-second fix.

## Common Mistakes

- Writing a `value is T` predicate that doesn't actually verify every field the type claims — the fastest way to make a "safe" check meaningless.
- Reaching for a type assertion (`as T`) to fix a narrowing-loss error inside a callback instead of the correct fix: copying the narrowed value into a `const`.
- Ordering `instanceof` checks from general to specific in a class hierarchy, causing a more specific subclass branch to be unreachable dead code.
- Expecting `in` to distinguish between two overlapping interfaces the same way `instanceof` distinguishes between concrete, non-overlapping classes — `in` only proves a property exists, not that other properties are absent.
- Assuming an assertion function's narrowing persists in a *different* function that later receives the already-checked value as a fresh parameter — narrowing doesn't cross function boundaries; the receiving function's parameter type still governs.

## Questions to Test Yourself

1. What specifically stops TypeScript from trusting that `config.apiUrl` is still a `string` inside a `setTimeout` callback, even though it was checked right before?
2. Why does copying `config.apiUrl` into `const apiUrl = config.apiUrl` fix the narrowing-loss problem, when the underlying object reference hasn't changed at all?
3. What's the difference in control flow between a function using an `is` predicate (`value is T`) and one using an `asserts` signature (`asserts value is T`)?
4. Why would checking `instanceof ApiError` before `instanceof NotFoundError` in an if/else chain make the `NotFoundError` branch unreachable?
5. What makes a type predicate "dishonest," and why does the compiler have no way to catch that on its own?
