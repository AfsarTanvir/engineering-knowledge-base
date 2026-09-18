# Interfaces — Advanced

The base file covers shape-checking and `extends`. What's left is the stuff that actually differentiates `interface` from `type` in a real codebase: declaration merging (a feature unique to `interface`, and a common source of "wait, where did this field come from" confusion), the deeper trade-offs behind picking one over the other, and what TypeScript's *structural* typing actually implies compared to the *nominal* typing most other statically-typed languages use.

See [interfaces.md](./interfaces.md) for the basics — optional/readonly fields, single/multiple `extends`, `implements`, and index signatures.

## Table of Contents

1. [Declaration Merging](#declaration-merging)
2. [Merging Function Overloads](#merging-function-overloads)
3. [Real-World Merging: Extending Third-Party Types](#real-world-merging-extending-third-party-types)
4. [Interfaces vs Type Aliases — The Full Trade-off](#interfaces-vs-type-aliases--the-full-trade-off)
5. [Extending Multiple Interfaces: Conflicts](#extending-multiple-interfaces-conflicts)
6. [Structural vs Nominal Typing](#structural-vs-nominal-typing)
7. [Faking Nominal Typing in a Structural System](#faking-nominal-typing-in-a-structural-system)
8. [Why It Matters](#why-it-matters)
9. [Common Mistakes](#common-mistakes)
10. [Questions to Test Yourself](#questions-to-test-yourself)

---

## Declaration Merging

Declaring the same `interface` name twice doesn't overwrite the first declaration — TypeScript **merges** all the fields into one combined interface. Classes and functions with the same name don't do this; only `interface` (and `namespace`) does.

```ts
interface RequestContext {
  requestId: string;
}

interface RequestContext {
  userId?: string;
}

// merged: RequestContext now has BOTH fields
const ctx: RequestContext = { requestId: "abc-123", userId: "u1" };
```

This is not a toy feature — it's the standard mechanism for **augmenting types you don't own**, most commonly Express's `Request` object:

```ts
// express/index.d.ts (simplified) declares:
// interface Request { body: any; params: ParamsDictionary; ... }

// your own augmentation file, e.g. types/express.d.ts:
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: string }; // added by your auth middleware
    }
  }
}

// now, anywhere in the app:
app.get("/profile", (req, res) => {
  console.log(req.user?.id); // ✅ TypeScript knows about `.user` — it was merged in
});
```

## Merging Function Overloads

An interface describing a callable can be declared multiple times with different call signatures, and TypeScript merges them into one overloaded signature.

```ts
interface Formatter {
  format(value: string): string;
}
interface Formatter {
  format(value: number): string;
}

const fmt: Formatter = {
  format(value: string | number): string {
    return typeof value === "number" ? value.toFixed(2) : value.trim();
  },
};

fmt.format("  hi  "); // resolves to the string overload
fmt.format(3.14159);  // resolves to the number overload
```

## Real-World Merging: Extending Third-Party Types

A very common senior-level task: a library ships a type that's missing one field you need (a plugin option, an environment variable typing, a custom JWT claim), and instead of forking the library you merge into its ambient declaration.

```ts
// jsonwebtoken's JwtPayload is a plain interface
import { JwtPayload } from "jsonwebtoken";

declare module "jsonwebtoken" {
  interface JwtPayload {
    tenantId: string; // your app always adds this custom claim
  }
}

function getTenant(payload: JwtPayload): string {
  return payload.tenantId; // ✅ compiles — merged in via module augmentation
}
```

```ts
// augmenting NodeJS.ProcessEnv so process.env.API_KEY is typed, not `string | undefined` guesswork
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      API_KEY: string;
      DATABASE_URL: string;
    }
  }
}

const key: string = process.env.API_KEY; // now typed as string, not string | undefined
```

`type` aliases **cannot** do any of this — attempting to redeclare a `type` with the same name is a hard compile error, which is precisely why library authors expose their public, augmentable surfaces as `interface`.

## Interfaces vs Type Aliases — The Full Trade-off

| | `interface` | `type` |
|---|---|---|
| Object shapes | ✅ | ✅ |
| Unions / tuples / primitives | ❌ | ✅ |
| Declaration merging | ✅ | ❌ (compile error) |
| `extends` with clear errors | ✅ (checked incrementally, better error messages) | ✅ via `&` (errors can be harder to read) |
| Mapped types (`[K in keyof T]`) | ❌ | ✅ |
| Used in `implements` | ✅ | ✅ (if it resolves to an object shape) |

```ts
// interfaces give cleaner incremental errors when extending
interface Base { id: string; }
interface Derived extends Base {
  name: string;
  id: number; // ❌ clear error: "Interface 'Derived' incorrectly extends interface 'Base'"
}

// the intersection equivalent can produce a harder-to-parse merged type instead of an error
type BaseT = { id: string };
type DerivedT = BaseT & { name: string; id: number };
// DerivedT.id ends up typed as `string & number`, which is `never` —
// no error at the declaration site, just a field that becomes unusable, discovered later
```

Practical rule many teams converge on: **`interface` for public object/class contracts that might need to merge or be extended; `type` for unions, tuples, mapped/conditional types, and one-off shapes that will never need merging.** Performance-wise, for very large, deeply nested object types, `interface` can also type-check slightly faster than an equivalent intersection chain, since the compiler can cache/flatten it more directly — a genuine (if usually minor) reason large codebases prefer interfaces for hot object types.

## Extending Multiple Interfaces: Conflicts

Extending several interfaces at once is allowed, but conflicting field types across the parents is a compile error, caught right at the `extends` clause.

```ts
interface HasStringId { id: string; }
interface HasNumberId { id: number; }

interface Broken extends HasStringId, HasNumberId {
  // ❌ error — id is string in one parent, number in the other, and they're incompatible
}
```

Compare this to an intersection of the same two, which compiles but silently produces a `never` field instead of erroring at the point of composition — one more reason `extends` on interfaces tends to surface design conflicts earlier than `&` does.

```ts
type BrokenT = HasStringId & HasNumberId;
// no error here — BrokenT.id is silently typed `never`,
// and the error only appears later, at whatever line tries to actually assign to `.id`
```

## Structural vs Nominal Typing

TypeScript is **structurally** typed: two types are compatible if their *shapes* match, regardless of name or declared relationship. Languages like Java or C# are **nominally** typed: compatibility is based on explicit declared inheritance, not shape.

```ts
interface Point2D { x: number; y: number; }
interface Vector2D { x: number; y: number; }

function distanceFromOrigin(p: Point2D): number {
  return Math.sqrt(p.x ** 2 + p.y ** 2);
}

const v: Vector2D = { x: 3, y: 4 };
distanceFromOrigin(v); // ✅ works — Vector2D was never declared to "be" a Point2D,
                        // but its shape matches, and that's all TypeScript checks
```

This also means **excess properties are fine through a variable**, but flagged on a fresh object literal (a specific structural-typing wrinkle worth knowing):

```ts
interface Config { timeout: number; }

function connect(config: Config) { /* ... */ }

const extra = { timeout: 5000, retries: 3 };
connect(extra); // ✅ fine — assigned through a variable, structurally compatible

connect({ timeout: 5000, retries: 3 });
// ❌ error — "Object literal may only specify known properties" (excess property check),
// a special stricter check TypeScript applies ONLY to fresh object literals
```

## Faking Nominal Typing in a Structural System

Sometimes structural compatibility is actually undesirable — you don't want a raw `string` accidentally accepted where a validated `UserId` is required. The common workaround is a **branded type**.

```ts
type UserId = string & { readonly __brand: "UserId" };
type OrderId = string & { readonly __brand: "OrderId" };

function makeUserId(id: string): UserId {
  return id as UserId; // the one sanctioned place this cast happens
}

function getUser(id: UserId) { /* ... */ }

const uid = makeUserId("u1");
getUser(uid); // ✅
getUser("u1"); // ❌ error — a plain string isn't assignable to UserId
getUser(makeUserId("u1") as unknown as OrderId); // would need an explicit, ugly cast — the point
```

This pattern gives you nominal-style safety (`UserId` and `OrderId` can't be mixed up even though both are "just strings" at runtime) inside a language that is fundamentally structural.

## Why It Matters

- Declaration merging is *the* mechanism for adding fields to `Express.Request`, augmenting `process.env`, or extending a library's types — not knowing it means resorting to `as any` casts everywhere those custom fields are used.
- Picking `type` for something that later needs merging (e.g. a config interface a plugin system wants to extend) forces a breaking rewrite later.
- Structural typing is why "it compiles" doesn't always mean "it's semantically correct" — two unrelated concepts with the same shape (`UserId` vs `OrderId` as plain strings) can be silently swapped with no compiler complaint unless branding is used.

## Common Mistakes

- Declaring a `type` alias meant for library augmentation, then discovering later it can't be merged, and having to convert the whole surface to `interface`.
- Assuming merged interface declarations are somehow "overridden" rather than combined — a common source of "why does this object have a field I never declared here" confusion when reading a large codebase with augmentation files scattered around.
- Relying on structural compatibility for domain identifiers (`UserId`, `OrderId`) that should never be interchangeable, instead of branding them.
- Extending multiple interfaces with genuinely conflicting field types and being surprised by the `extends` clause error instead of understanding it's flagging a real design conflict.

## Questions to Test Yourself

1. Why does declaring `interface Foo { a: string }` twice in the same scope not produce a duplicate-declaration error, while doing the same with `type Foo = { a: string }` does?
2. How would you add a custom `user` field to Express's `Request` type without editing the library's own `.d.ts` file?
3. Why does `HasStringId & HasNumberId` compile with a `never` field instead of erroring immediately, while `extends HasStringId, HasNumberId` on an interface errors right away?
4. Why can a `Vector2D` object be passed to a function expecting `Point2D` even though neither type was declared to extend the other?
5. What problem does a branded type like `UserId = string & { __brand: "UserId" }` solve that plain structural typing doesn't?
