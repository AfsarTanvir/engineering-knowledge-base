# Interfaces

An interface describes the **shape** of an object — what fields it must have, their types, and which are optional. It's a contract: anything that claims to be a `User` must actually look like a `User`, checked by the compiler before your code ever runs, instead of failing at 2am in production when a field turns out to be missing.

## Table of Contents

1. [What Is It?](#what-is-it)
2. [Optional Properties](#optional-properties)
3. [Readonly Properties](#readonly-properties)
4. [Extending Interfaces](#extending-interfaces)
5. [Interfaces vs Type Aliases (Brief)](#interfaces-vs-type-aliases-brief)
6. [Implementing Interfaces in Classes](#implementing-interfaces-in-classes)
7. [Function Type Interfaces](#function-type-interfaces)
8. [Index Signatures](#index-signatures)
9. [What Happens Without Interfaces](#what-happens-without-interfaces)
10. [Common Mistakes](#common-mistakes)
11. [Questions to Test Yourself](#questions-to-test-yourself)

---

## What Is It?

```ts
interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  isActive: boolean;
}

function greet(user: User) {
  console.log(`Hello, ${user.name}`); // TypeScript knows .name exists and is a string
}

greet({ id: "1", name: "Afsar", email: "a@x.com", role: "admin", isActive: true }); // ✅
greet({ id: "1", name: "Afsar" }); // ❌ compile error — missing required fields
```

Interfaces let a function's caller and its implementation agree on a contract, verified statically instead of discovered at runtime via `undefined is not an object`.

## Optional Properties

A `?` marks a field as not required — callers may omit it, and code that reads it must handle the `undefined` case.

```ts
interface UserProfile {
  id: string;
  name: string;
  bio?: string; // optional
}

const minimal: UserProfile = { id: "1", name: "Afsar" }; // ✅ bio omitted, that's fine
const full: UserProfile = { id: "2", name: "Sam", bio: "Engineer" }; // ✅

function printBio(profile: UserProfile) {
  console.log(profile.bio.toUpperCase()); // ❌ compile error — bio might be undefined
  console.log(profile.bio?.toUpperCase()); // ✅ safe — optional chaining
}
```

## Readonly Properties

`readonly` prevents reassignment after the object is created — useful for values that should never change post-construction (IDs, creation timestamps).

```ts
interface Invoice {
  readonly id: string;
  readonly createdAt: Date;
  total: number; // still mutable
}

function issueInvoice(invoice: Invoice) {
  invoice.total = 150; // ✅ fine
  invoice.id = "new-id"; // ❌ compile error — Cannot assign to 'id' because it is a read-only property
}
```

This is a compile-time guarantee only — it doesn't freeze the object at runtime (use `Object.freeze` for that), but it stops accidental reassignment throughout your own codebase.

## Extending Interfaces

An interface can build on another with `extends`, inheriting all its fields and adding more — avoiding duplicated shape definitions.

```ts
interface Entity {
  id: string;
  createdAt: Date;
}

interface Product extends Entity {
  name: string;
  price: number;
}

const product: Product = {
  id: "p1",
  createdAt: new Date(),
  name: "Widget",
  price: 9.99,
}; // must satisfy BOTH Entity and Product's own fields
```

An interface can extend multiple interfaces at once:

```ts
interface Timestamped {
  createdAt: Date;
  updatedAt: Date;
}

interface Named {
  name: string;
}

interface Article extends Timestamped, Named {
  body: string;
}
```

## Interfaces vs Type Aliases (Brief)

Interfaces and `type` aliases overlap heavily for describing object shapes. The two practical differences worth knowing now (deeper coverage lives in the advanced types file):

```ts
// interfaces can be re-opened and merged (declaration merging)
interface Window {
  title: string;
}
interface Window {
  isOpen: boolean;
}
// Window now has both title and isOpen — this only works with `interface`

// type aliases can describe things interfaces can't, like unions
type Status = "pending" | "approved" | "rejected"; // no interface equivalent
```

Rule of thumb: use `interface` for object shapes you expect to extend or that classes will implement; use `type` for unions, intersections, tuples, and other non-object-shape constructs.

## Implementing Interfaces in Classes

A class can promise to satisfy an interface with `implements` — the compiler then checks every required member is actually present.

```ts
interface Shape {
  area(): number;
  perimeter(): number;
}

class Circle implements Shape {
  constructor(private radius: number) {}

  area(): number {
    return Math.PI * this.radius ** 2;
  }

  perimeter(): number {
    return 2 * Math.PI * this.radius;
  }
}

class Broken implements Shape {
  area(): number {
    return 0;
  }
  // ❌ compile error — Broken is missing perimeter()
}
```

This is how you enforce that every strategy in a "pluggable strategy" system (payment providers, notification channels, storage backends) actually implements the required methods.

## Function Type Interfaces

An interface can describe a callable shape instead of (or in addition to) data fields.

```ts
interface Comparator<T> {
  (a: T, b: T): number;
}

const byLength: Comparator<string> = (a, b) => a.length - b.length;

["ccc", "a", "bb"].sort(byLength); // ["a", "bb", "ccc"]
```

Combined with properties, an interface can describe an object that's both callable and has fields:

```ts
interface Counter {
  (): number;        // calling it returns the current count
  reset(): void;      // it also has a reset method
}
```

## Index Signatures

An index signature describes objects used as dictionaries/maps, where the keys aren't known ahead of time but their value type is consistent.

```ts
interface StringDictionary {
  [key: string]: string;
}

const translations: StringDictionary = {
  hello: "hola",
  goodbye: "adios",
};

translations.hello;      // string
translations["anything"]; // string — TypeScript allows any string key, always typed as string
```

```ts
interface RequestCounts {
  [route: string]: number;
}

const hits: RequestCounts = {};
hits["/api/users"] = (hits["/api/users"] ?? 0) + 1;
```

Mixing a known field with an index signature requires the known field to be compatible with the index signature's type:

```ts
interface Config {
  [key: string]: string;
  environment: string; // ✅ fine, matches string
}
```

## What Happens Without Interfaces

- Object shapes are only implicitly documented (or not documented at all), so callers guess which fields exist and typo field names with no warning.
- Runtime crashes like `Cannot read properties of undefined` from accessing a field that was never actually there.
- Refactors become dangerous — renaming a field means grepping the whole codebase and hoping you found every usage, instead of the compiler pointing to every broken call site.

## Common Mistakes

- Marking everything optional (`field?: string`) "just in case," which forces every consumer to null-check fields that are actually always present.
- Using `interface` where a union or tuple is really needed — interfaces can't express `"a" | "b"`, only `type` aliases can.
- Forgetting that `implements` only checks the public shape — it does not stop a class from having wildly different internal behavior for the same method signatures.
- Overusing index signatures instead of a real interface when the keys are actually known and fixed.

## Questions to Test Yourself

1. What's the practical difference between a field being optional (`field?: T`) versus typed as `field: T | undefined`?
2. Why can't a `readonly` field be reassigned even though the object itself isn't frozen at runtime?
3. When would you reach for `extends` on an interface instead of duplicating fields?
4. Give one thing a `type` alias can express that a plain `interface` cannot.
5. Why does `implements Shape` on a class catch missing methods at compile time instead of at the first runtime call?
