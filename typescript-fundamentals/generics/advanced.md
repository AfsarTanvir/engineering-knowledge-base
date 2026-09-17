# Generics — Advanced

Once you can write `Stack<T>` and `Repository<T extends Entity>`, the next level is understanding how TypeScript's own utility types (`Partial<T>`, `Pick<T, K>`, `Record<K, V>`) are built, and how to write your own type-level transformations using conditional types, mapped types, and `infer`. This is the machinery behind almost every advanced `.d.ts` file you'll ever read, and it's what lets a library expose a fully-typed API without hand-writing a type per function.

See [generics.md](./generics.md) for the basics — generic functions, constraints, generic classes, and the repository/response-wrapper patterns.

## Table of Contents

1. [Conditional Types](#conditional-types)
2. [`infer` — Extracting Types Mid-Condition](#infer--extracting-types-mid-condition)
3. [Mapped Types](#mapped-types)
4. [How Built-In Utility Types Actually Work](#how-built-in-utility-types-actually-work)
5. [Distributive Conditional Types](#distributive-conditional-types)
6. [Variance: Covariance and Contravariance Intuition](#variance-covariance-and-contravariance-intuition)
7. [Why It Matters](#why-it-matters)
8. [Common Mistakes](#common-mistakes)
9. [Questions to Test Yourself](#questions-to-test-yourself)

---

## Conditional Types

A conditional type picks between two types based on a type-level `extends` check — it's an `if/else` that runs on types instead of values, evaluated by the compiler, not at runtime.

```ts
type IsString<T> = T extends string ? "yes" : "no";

type A = IsString<"hello">; // "yes"
type B = IsString<42>;      // "no"
```

This becomes useful once you chain it with real logic:

```ts
type ExtractMessage<T> = T extends { message: string } ? T["message"] : never;

interface ErrorEvent { message: string; code: number; }
type Msg = ExtractMessage<ErrorEvent>; // string
type NoMsg = ExtractMessage<{ code: number }>; // never — no `message` field
```

## `infer` — Extracting Types Mid-Condition

`infer` lets you *capture* a type variable from within a conditional type's `extends` clause, instead of just testing structural compatibility.

```ts
// extract a function's return type — this is literally how TS's built-in ReturnType<T> works
type MyReturnType<T> = T extends (...args: any[]) => infer R ? R : never;

function getUser() {
  return { id: "1", name: "Afsar" };
}

type User = MyReturnType<typeof getUser>; // { id: string; name: string }
```

```ts
// unwrap a Promise's resolved value
type Unwrap<T> = T extends Promise<infer U> ? U : T;

type A = Unwrap<Promise<string>>; // string
type B = Unwrap<number>;          // number — not a Promise, passes through unchanged
```

```ts
// extract the element type of an array
type ElementOf<T> = T extends (infer U)[] ? U : never;

type Item = ElementOf<string[]>; // string
```

`infer` is how you write type-level "destructuring" — pulling a piece out of a larger, more complex type shape without knowing it ahead of time.

## Mapped Types

A mapped type builds a new object type by iterating over the keys of an existing one — the type-level equivalent of `Object.keys(obj).map(...)`.

```ts
type OptionalFields<T> = {
  [K in keyof T]?: T[K];
};

interface User { id: string; name: string; email: string; }
type PartialUser = OptionalFields<User>;
// { id?: string; name?: string; email?: string }
```

Modifiers can be added or *removed* with `+`/`-` prefixes:

```ts
type RequiredFields<T> = {
  [K in keyof T]-?: T[K]; // strips the optional modifier from every key
};

type ReadonlyFields<T> = {
  readonly [K in keyof T]: T[K];
};

type MutableFields<T> = {
  -readonly [K in keyof T]: T[K]; // strips readonly
};
```

Key remapping (`as`) lets you transform the keys themselves, not just the values:

```ts
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};

interface Product { name: string; price: number; }
type ProductGetters = Getters<Product>;
// { getName: () => string; getPrice: () => number }
```

## How Built-In Utility Types Actually Work

These aren't compiler magic — they're ordinary mapped/conditional types shipped in `lib.es5.d.ts`. Knowing their real definitions means you can write your own variants when the built-in one doesn't quite fit.

```ts
// Partial<T> — every field becomes optional
type MyPartial<T> = {
  [K in keyof T]?: T[K];
};

// Pick<T, K> — select a subset of keys
type MyPick<T, K extends keyof T> = {
  [P in K]: T[P];
};

// Record<K, V> — a dictionary type, every key of K maps to V
type MyRecord<K extends string | number | symbol, V> = {
  [P in K]: V;
};

// Omit<T, K> — Pick everything EXCEPT K (built from Pick + Exclude)
type MyOmit<T, K extends keyof any> = MyPick<T, Exclude<keyof T, K>>;

// Exclude<T, U> — remove members of a union that are assignable to U
type MyExclude<T, U> = T extends U ? never : T;
```

```ts
interface Order { id: string; total: number; status: "pending" | "shipped"; }

type OrderPreview = MyPick<Order, "id" | "total">;   // { id: string; total: number }
type OrderWithoutStatus = MyOmit<Order, "status">;   // { id: string; total: number }
type StatusMap = MyRecord<Order["status"], string>;  // { pending: string; shipped: string }
```

`Exclude<T, U>` is a **distributive** conditional type (see below) — that's exactly why `Omit` correctly removes one member from a union of keys instead of collapsing the whole thing to `never`.

## Distributive Conditional Types

When the type being checked in a conditional type is a **bare type parameter** (not wrapped in anything), TypeScript distributes the conditional over each member of a union individually, rather than treating the union as one opaque blob.

```ts
type ToArray<T> = T extends any ? T[] : never;

type Result = ToArray<string | number>;
// distributes: ToArray<string> | ToArray<number>
// = string[] | number[]
// NOT (string | number)[] — a meaningfully different type!
```

You can opt *out* of distribution by wrapping both sides in a tuple, which stops TypeScript from treating `T` as a naked, distributable parameter:

```ts
type ToArrayNonDist<T> = [T] extends [any] ? T[] : never;

type Result2 = ToArrayNonDist<string | number>;
// (string | number)[] — the union is treated as one whole, not distributed
```

This is exactly the mechanism used more deeply in [union-intersection-types/advanced.md](../union-intersection-types/advanced.md).

## Variance: Covariance and Contravariance Intuition

Variance answers: "if `Dog` is a subtype of `Animal`, is `Container<Dog>` a subtype of `Container<Animal>`?" TypeScript's answer differs depending on *where* `T` is used.

**Covariant position** (a type used as an output — return values, readonly fields): subtyping direction matches, so `Dog`-shaped things can stand in for `Animal`-shaped things.

```ts
interface Animal { name: string; }
interface Dog extends Animal { bark(): void; }

type Producer<T> = () => T;

let animalProducer: Producer<Animal>;
let dogProducer: Producer<Dog> = () => ({ name: "Rex", bark: () => {} });

animalProducer = dogProducer; // ✅ fine — a function producing a MORE specific Dog
                                // can safely be used wherever an Animal producer is expected
```

**Contravariant position** (a type used as an input — function parameters): the subtyping direction *flips*.

```ts
type Consumer<T> = (value: T) => void;

let dogConsumer: Consumer<Dog>;
let animalConsumer: Consumer<Animal> = (a) => console.log(a.name);

dogConsumer = animalConsumer; // ✅ fine — something that can handle ANY Animal
                                // can definitely handle the more specific Dog
// animalConsumer = dogConsumer; // ❌ unsafe — a function only equipped to handle Dog
                                    // can't safely be called with an arbitrary Animal
```

The intuition: it's safe to substitute a **more specific producer** or a **more general consumer**. Getting this backwards — accepting a `Consumer<Dog>` where `Consumer<Animal>` is required — would let code call `.bark()` on something that's only guaranteed to be an `Animal`, crashing at runtime.

TypeScript, by default, checks method parameters *bivariantly* (looser, for practical compatibility with JS patterns) but function-type parameters (arrow-style fields) strictly contravariantly — a subtlety that occasionally causes a callback type to type-check when a method-style signature with the same shape would not.

## Why It Matters

- Library `.d.ts` files (React, Express, tRPC) are built almost entirely from conditional types, mapped types, and `infer` — reading them without this vocabulary is close to impossible.
- Writing your own domain-specific utility type (e.g. `DeepPartial<T>`, `KeysMatching<T, V>`) instead of hand-maintaining parallel interfaces prevents an entire class of "the type and the shape silently drifted apart" bugs.
- Misunderstanding distributive conditional types leads to confusing "why is my type suddenly a union of arrays instead of an array of a union" bugs.
- Variance mistakes are exactly how a generic wrapper (e.g. a homemade `EventEmitter<T>`) ends up allowing a caller to register a handler that crashes on some inputs, with no compiler complaint.

## Common Mistakes

- Writing `T extends any ? X : Y` and being surprised the conditional distributes over a union parameter instead of testing the union as a whole.
- Reimplementing `Partial`/`Pick`/`Omit` from scratch out of habit instead of composing the built-ins, when composition would be clearer and stay in sync with future TS changes.
- Using `infer` inside a non-conditional position (it's only legal within the `extends` clause of a conditional type) and being confused by the resulting error.
- Assuming a custom generic wrapper is automatically variance-safe just because the underlying language (JS) doesn't enforce it — TypeScript's structural checks still catch genuine unsoundness in most cases, but manually using `as`/`any` inside generic code can silently reintroduce it.

## Questions to Test Yourself

1. Walk through how `MyReturnType<T>` uses `infer` to extract a function's return type — what happens if `T` isn't a function type at all?
2. Why does `Omit<T, K>` need `Exclude`, and why does `Exclude` rely specifically on distributive conditional behavior to work correctly on a union of keys?
3. What's the difference in output between `ToArray<string | number>` (distributive) and `ToArrayNonDist<string | number>` (non-distributive)?
4. Why is it safe to assign a `Producer<Dog>` to a `Producer<Animal>`-typed variable, but not safe to do the reverse for a `Consumer<T>`?
5. How would you write your own `DeepPartial<T>` mapped type that makes every nested object field optional, not just the top-level ones?
