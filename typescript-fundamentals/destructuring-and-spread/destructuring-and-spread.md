# Destructuring and Spread

Nearly every modern TS codebase leans on destructuring for function parameters (config/options objects) and spread for building new objects/arrays without mutating the originals. They're concise, but each has a sharp edge — destructuring `undefined`, and spread silently deep-copying nothing (it's shallow) — that causes real bugs if you don't know exactly what's happening under the hood.

## Table of Contents

1. [Array Destructuring](#array-destructuring)
2. [Object Destructuring](#object-destructuring)
3. [Default Values in Destructuring](#default-values-in-destructuring)
4. [Renaming Destructured Variables](#renaming-destructured-variables)
5. [Nested Destructuring](#nested-destructuring)
6. [Destructuring Function Parameters](#destructuring-function-parameters)
7. [Spread Operator: Arrays and Objects](#spread-operator-arrays-and-objects)
8. [Rest Parameters vs Rest in Destructuring](#rest-parameters-vs-rest-in-destructuring)
9. [What Happens Without This](#what-happens-without-this)
10. [Common Mistakes](#common-mistakes)
11. [Questions to Test Yourself](#questions-to-test-yourself)

---

## Array Destructuring

Pulls values out of an array by **position**.

```ts
const coordinates: [number, number, number] = [10, 20, 30];
const [x, y, z] = coordinates;
console.log(x, y, z); // 10 20 30

const [first, , third] = coordinates; // skip an element with an empty slot
console.log(first, third); // 10 30
```

## Object Destructuring

Pulls values out of an object by **key name**, not position.

```ts
const user = { id: 1, name: 'Ada', email: 'ada@example.com' };
const { name, email } = user;
console.log(name, email); // "Ada" "ada@example.com"
```

## Default Values in Destructuring

If the key is missing or explicitly `undefined`, the default is used instead.

```ts
const config = { timeout: 5000 };
const { timeout = 3000, retries = 3 } = config;
console.log(timeout, retries); // 5000 3 — timeout was present, retries used its default

const { retries: r = 3 } = { retries: undefined };
console.log(r); // 3 — undefined triggers the default

const { retries: r2 = 3 } = { retries: 0 };
console.log(r2); // 0 — a REAL value of 0 is kept, defaults only kick in for undefined, not for falsy values
```

## Renaming Destructured Variables

Useful to avoid name collisions or to give a clearer local name.

```ts
const apiResponse = { id: 42, data: { title: 'Post' } };
const { id: postId, data: postData } = apiResponse;
console.log(postId, postData); // 42 { title: 'Post' }

// combined with a default
const { retries: maxRetries = 3 } = { };
console.log(maxRetries); // 3
```

## Nested Destructuring

Mirrors the shape of the object/array you're pulling from.

```ts
const order = {
  id: 'ord_1',
  customer: {
    name: 'Grace',
    address: { city: 'London', zip: 'E1 6AN' },
  },
  items: [{ sku: 'A1', qty: 2 }],
};

const {
  customer: {
    name,
    address: { city },
  },
  items: [firstItem],
} = order;

console.log(name, city, firstItem); // "Grace" "London" { sku: 'A1', qty: 2 }
// note: `customer` and `address` themselves are NOT bound as variables here —
// only the leaves you explicitly named (name, city, firstItem) are
```

## Destructuring Function Parameters

The most common real-world use — config/options objects instead of long positional parameter lists.

```ts
interface CreateServerOptions {
  port: number;
  host?: string;
  useHttps?: boolean;
}

// destructuring right in the parameter list, with defaults
function createServer({ port, host = 'localhost', useHttps = false }: CreateServerOptions) {
  console.log(`Starting ${useHttps ? 'https' : 'http'}://${host}:${port}`);
}

createServer({ port: 3000 }); // "Starting http://localhost:3000"
```

This is the standard pattern for any function that takes "a bunch of optional settings" — callers can pass only what they care about, in any order, by name, instead of remembering positional argument order.

## Spread Operator: Arrays and Objects

`...` expands an iterable (array spread) or an object's own enumerable properties (object spread) in place.

```ts
const nums = [1, 2, 3];
const moreNums = [...nums, 4, 5]; // [1, 2, 3, 4, 5] — a NEW array, nums is untouched
console.log(nums, moreNums);

const merged = [...nums, ...[10, 20]]; // [1, 2, 3, 10, 20]

const base = { a: 1, b: 2 };
const extended = { ...base, c: 3 }; // { a: 1, b: 2, c: 3 } — new object
const overridden = { ...base, a: 99 }; // { a: 99, b: 2 } — later keys win, in written order
```

This is the standard pattern for immutable updates (never mutate `base` directly, always spread into a new object) — used constantly in state-management code (Redux reducers, React `setState` updaters).

```ts
function updateUser(user: { id: number; name: string }, changes: Partial<typeof user>) {
  return { ...user, ...changes }; // new object, original `user` reference unchanged
}
```

## Rest Parameters vs Rest in Destructuring

`...` also means "gather the rest" — in a function parameter list, or at the end of a destructuring pattern. Same symbol, opposite conceptual direction from spread (spread expands, rest collects).

```ts
// rest PARAMETER — collects any number of arguments into an array
function sum(...numbers: number[]) {
  return numbers.reduce((total, n) => total + n, 0);
}
console.log(sum(1, 2, 3, 4)); // 10

// rest in ARRAY destructuring — collects "everything else" after the named elements
const [firstScore, ...restScores] = [100, 90, 85, 70];
console.log(firstScore, restScores); // 100 [90, 85, 70]

// rest in OBJECT destructuring — collects remaining keys into a new object
const { id, ...otherFields } = { id: 1, name: 'Ada', email: 'ada@example.com' };
console.log(id, otherFields); // 1 { name: 'Ada', email: 'ada@example.com' }
```

A rest element must always come **last** in a pattern — `const [...rest, last] = arr` is a syntax error.

## What Happens Without This

Without destructuring, you'd write `const name = user.name; const email = user.email;` for every field you need — verbose, and easy to typo a key name inconsistently. Without spread, you'd mutate objects/arrays directly (`user.name = newName`) or manually loop to copy fields — both far more error-prone and a common source of "who else is holding a reference to this object I just mutated" bugs.

## Common Mistakes

- Assuming default values apply to any falsy value — they only apply when the destructured value is exactly `undefined` (missing key, or explicit `undefined`); `0`, `""`, `false`, and `null` are all kept as-is.
- Forgetting a rest element must be last in the pattern.
- Believing spread performs a deep copy — it only copies one level deep (see [advanced.md](./advanced.md) for the nested-object trap this causes).
- Destructuring a function parameter without a default object, then calling the function with no argument at all: `function f({ a }: { a: number }) {}` then `f()` throws, because there's no object to destructure from in the first place.

## Questions to Test Yourself

1. Why does `const { retries = 3 } = { retries: 0 }` result in `retries` being `0`, not `3`?
2. What's the difference between "rest" in a function parameter list and "rest" at the end of an array/object destructuring pattern?
3. Given `const merged = { ...defaults, ...overrides }`, which object's values win when both have the same key?
4. Why must a rest element always be the last item in a destructuring pattern?
