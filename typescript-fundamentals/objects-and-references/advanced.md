# Objects and References — Advanced

The basics cover value vs reference semantics, shallow vs deep copying, and the classic React state bug. This file covers the tools TypeScript and JavaScript give you to control reference behavior more precisely — structural typing, real immutability, weak references, and intercepting property access. See [objects-and-references.md](./objects-and-references.md) for the basics this builds on.

## Table of Contents

1. [Structural Typing (Duck Typing) in TypeScript](#structural-typing-duck-typing-in-typescript)
2. [`Object.freeze` vs True Deep Immutability](#objectfreeze-vs-true-deep-immutability)
3. [WeakMap and WeakRef — Avoiding Memory Leaks](#weakmap-and-weakref--avoiding-memory-leaks)
4. [Proxy Objects](#proxy-objects)
5. [Getters/Setters and Reference Semantics](#gettersetters-and-reference-semantics)
6. [Why It Matters](#why-it-matters)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)

---

## Structural Typing (Duck Typing) in TypeScript

Unlike Java/C#, TypeScript's type system is **structural**, not nominal: two types are compatible if they have the same *shape*, regardless of name or explicit inheritance. "If it walks like a duck and quacks like a duck, it's a duck."

```ts
interface Point2D {
  x: number;
  y: number;
}

interface Vector {
  x: number;
  y: number;
}

function distanceFromOrigin(p: Point2D): number {
  return Math.sqrt(p.x ** 2 + p.y ** 2);
}

const v: Vector = { x: 3, y: 4 };
distanceFromOrigin(v); // ✅ works — `Vector` is never declared as a `Point2D`,
                        // but it has the same shape, so TS accepts it
```

This extends to **excess property checks**, which only apply to object *literals*, not variables — a subtlety that trips people up constantly:

```ts
function printPoint(p: Point2D) {
  console.log(p.x, p.y);
}

printPoint({ x: 1, y: 2, z: 3 }); // ❌ Error: object literal may only specify known properties
                                    // ('z' does not exist in type 'Point2D')

const point3D = { x: 1, y: 2, z: 3 };
printPoint(point3D); // ✅ works! same object shape, but it's a variable, not a literal,
                       // so the excess property check doesn't apply — structural typing wins
```

This directly connects to the reference-semantics basics: since `point3D` is passed by reference, `printPoint` receives the *same* object with the extra `z` property still attached — TypeScript just doesn't complain about it at the call site because it's not a literal.

Structural typing means "is this assignable" is really "does this have at least the required shape" — which is why interfaces in TS are often described as contracts about shape, not identity.

## `Object.freeze` vs True Deep Immutability

`Object.freeze()` prevents adding, removing, or reassigning **top-level** properties. It does *not* freeze nested objects — this is a very common gotcha that looks like it should work.

```ts
const config = Object.freeze({
  env: "production",
  limits: { maxUsers: 100 },
});

config.env = "staging"; // silently ignored in non-strict mode, throws in strict/module code
console.log(config.env); // "production" — top-level freeze worked

config.limits.maxUsers = 999; // ✅ this succeeds! `limits` itself was never frozen
console.log(config.limits.maxUsers); // 999 — "frozen" config just got mutated
```

For real deep immutability you either recursively freeze, or use a library (e.g. Immer, immutable.js) or the built-in `structuredClone` combined with a deep-freeze helper:

```ts
function deepFreeze<T>(obj: T): Readonly<T> {
  Object.getOwnPropertyNames(obj).forEach((key) => {
    const value = (obj as any)[key];
    if (value && typeof value === "object") deepFreeze(value);
  });
  return Object.freeze(obj);
}

const frozenConfig = deepFreeze({ env: "production", limits: { maxUsers: 100 } });
frozenConfig.limits.maxUsers = 999; // now throws in strict mode — nested object frozen too
```

TypeScript's `Readonly<T>` and `as const` are **compile-time only** — they give you no runtime protection at all. This is a common trap: people assume `readonly` guarantees immutability, but it's purely a type-checker construct that disappears once compiled to JS.

```ts
interface Settings {
  readonly maxRetries: number;
}
function tryMutate(s: Settings) {
  (s as any).maxRetries = 999; // TS would block `s.maxRetries = 999` directly,
                                 // but a cast bypasses it, and at RUNTIME nothing stops this at all
}
```

## WeakMap and WeakRef — Avoiding Memory Leaks

A regular `Map` holds a **strong reference** to its keys — if you use an object as a key, that object can never be garbage collected as long as the `Map` exists, even if nothing else references it. This is a real memory leak source for caches keyed by objects (e.g., DOM nodes, request objects).

```ts
// BROKEN (potential leak) — a plain Map keeps every key alive forever
const metadataCache = new Map<object, { visits: number }>();

function trackVisit(userSession: object) {
  const entry = metadataCache.get(userSession) ?? { visits: 0 };
  entry.visits++;
  metadataCache.set(userSession, entry);
}
// even after `userSession` is no longer used anywhere else in the app,
// `metadataCache` still holds a reference to it — it can NEVER be garbage collected
```

`WeakMap` solves this by holding **weak references** to its keys: if nothing else references the key object, it (and its associated value) can be garbage collected, and the entry silently disappears from the map.

```ts
// FIXED — WeakMap keys don't prevent garbage collection
const metadataCache = new WeakMap<object, { visits: number }>();

function trackVisit(userSession: object) {
  const entry = metadataCache.get(userSession) ?? { visits: 0 };
  entry.visits++;
  metadataCache.set(userSession, entry);
}
// once `userSession` is no longer referenced elsewhere, it (and its cache entry)
// can be garbage collected automatically — no manual cleanup needed
```

The trade-off: `WeakMap`/`WeakSet` are **not iterable** and have no `.size` — you can't list their keys, because the whole point is that entries can vanish at any time via GC, so exposing enumeration would be nonsensical. Use them specifically for "attach metadata to an object without preventing it from being collected" — never as a general-purpose map.

`WeakRef` (newer, used less often directly) lets you hold a reference to an object *without* keeping it alive, and check later if it still exists:

```ts
let cache: WeakRef<HTMLElement> | null = null;

function getCachedElement(): HTMLElement | null {
  const el = cache?.deref(); // returns the object, or undefined if it was GC'd
  return el ?? null;
}

cache = new WeakRef(document.getElementById("widget")!);
```

Most application code should reach for `WeakMap` over raw `WeakRef` — `WeakRef` is a low-level primitive mainly used to build caching/memoization libraries, and misusing it (checking `.deref()` at the wrong time) can introduce subtle bugs since GC timing is not deterministic or spec-guaranteed.

## Proxy Objects

A `Proxy` wraps an object and lets you intercept fundamental operations on it — property reads, writes, deletion, `in` checks — via **traps**. This is how libraries like Vue 3's reactivity system and validation libraries work under the hood.

```ts
const user = { name: "Afsar", age: 30 };

const loggedUser = new Proxy(user, {
  get(target, prop, receiver) {
    console.log(`reading "${String(prop)}"`);
    return Reflect.get(target, prop, receiver);
  },
  set(target, prop, value, receiver) {
    console.log(`writing "${String(prop)}" = ${value}`);
    return Reflect.set(target, prop, value, receiver);
  },
});

loggedUser.name; // logs: reading "name"
loggedUser.age = 31; // logs: writing "age" = 31
console.log(user.age); // 31 — the underlying object WAS actually mutated
```

A practical use: validation that can't be bypassed by directly mutating properties.

```ts
function createValidatedUser(initial: { age: number }) {
  return new Proxy(initial, {
    set(target, prop, value) {
      if (prop === "age" && (typeof value !== "number" || value < 0)) {
        throw new TypeError("age must be a non-negative number");
      }
      return Reflect.set(target, prop, value);
    },
  });
}

const u = createValidatedUser({ age: 25 });
u.age = -5; // ❌ throws TypeError — the proxy intercepted the write before it happened
```

Crucially, a `Proxy` is still a reference type like any other object — assigning it, passing it to functions, and comparing it with `===` all follow the same rules from the base file. The difference is what happens *when you read or write its properties*, not how it's referenced.

## Getters/Setters and Reference Semantics

`get`/`set` accessors let a property look like a plain field from the outside while actually running code — including code that depends on (or breaks) the reference rules from the base file.

```ts
class Temperature {
  #celsius: number;
  constructor(celsius: number) {
    this.#celsius = celsius;
  }
  get fahrenheit(): number {
    return this.#celsius * 9 / 5 + 32; // computed, not stored — no separate reference to manage
  }
  set fahrenheit(f: number) {
    this.#celsius = (f - 32) * 5 / 9;
  }
}

const t = new Temperature(0);
console.log(t.fahrenheit); // 32 — reads like a plain property, but it's a computed getter
t.fahrenheit = 212;
console.log(t["_celsius" as any]); // undefined — there's no such field, it's private #celsius
```

A subtle interaction with reference semantics: a getter that returns an *object* still hands out a reference, so mutating the returned object can silently corrupt internal state — the getter itself doesn't protect against that.

```ts
class Team {
  #members: string[] = ["Alice", "Bob"];
  get members(): string[] {
    return this.#members; // ❌ leaks the actual internal array by reference
  }
}

const team = new Team();
team.members.push("Eve"); // mutates the PRIVATE internal array directly!
console.log(team.members); // ["Alice", "Bob", "Eve"] — encapsulation broken
```

The fix mirrors the shallow-copy lesson from the base file — a getter that exposes internal reference types should return a copy:

```ts
get members(): string[] {
  return [...this.#members]; // safe — caller gets a copy, internal state is protected
}
```

## Why It Matters

Structural typing means TypeScript is checking "shape," not "identity" — misunderstanding that leads to confusing "why did this compile" or "why doesn't this compile" moments. `Object.freeze` and `readonly` both look like they guarantee immutability but only do so shallowly (or not at all at runtime) — teams that assume otherwise ship bugs where "frozen" config gets mutated deep inside. `WeakMap` exists specifically because regular `Map`/objects create real, measurable memory leaks when used as long-lived caches keyed by short-lived objects. And Proxies/getters show that "reference semantics" isn't just about who points at what — it's also about what code silently runs when you touch a property at all.

## Common Mistakes

- Assuming `Object.freeze` deep-freezes nested objects — it only freezes one level.
- Trusting TypeScript's `readonly`/`as const` as runtime protection — they vanish at compile time.
- Using a plain `Map` or object as a long-lived cache keyed by objects (DOM nodes, sessions) and leaking memory because those keys can never be garbage collected.
- Writing a getter that returns an internal array/object directly, allowing callers to mutate "private" state through the public getter.
- Forgetting that structural typing means an object with *extra* properties is still assignable to a narrower type through a variable, even though the identical object literal would be rejected.

## Questions to Test Yourself

1. Why does TypeScript allow passing a variable with extra properties to a function, but reject an object literal with those same extra properties?
2. Why does `Object.freeze({ a: { b: 1 } })` fail to prevent `obj.a.b = 2`?
3. Why would using a plain `Map` (instead of a `WeakMap`) as a cache keyed by DOM elements cause a memory leak?
4. What's wrong with a getter like `get items() { return this.#items; }` when `#items` is an array, and how do you fix it?
5. How does a `Proxy`'s `set` trap let you enforce validation that plain property assignment cannot?
