# `unknown` vs `any` — Advanced

The base file establishes the core discipline: treat untrusted data as `unknown`, narrow it before use, and avoid letting `any` leak through your system. The advanced layer is about *enforcing* that discipline at the level of a whole codebase and team — locking down `any` with compiler and lint settings, understanding exactly what a type assertion does and doesn't check, and using validation libraries (Zod, io-ts) to bridge the gap between "the compiler trusts this shape" and "this shape was actually verified at runtime."

See [unknown-any.md](./unknown-any.md) for the basics — why `any` is dangerous, how `unknown` forces narrowing, and the contagion problem.

## Table of Contents

1. [Type Assertions vs Type Guards — The Real Difference](#type-assertions-vs-type-guards--the-real-difference)
2. [`as const`](#as-const)
3. [Runtime Validation Libraries: Zod and io-ts](#runtime-validation-libraries-zod-and-io-ts)
4. [Locking Down `any` with the Compiler](#locking-down-any-with-the-compiler)
5. [Locking Down `any` with ESLint](#locking-down-any-with-eslint)
6. [Tracing and Fixing `any` Propagation](#tracing-and-fixing-any-propagation)
7. [Why It Matters](#why-it-matters)
8. [Common Mistakes](#common-mistakes)
9. [Questions to Test Yourself](#questions-to-test-yourself)

---

## Type Assertions vs Type Guards — The Real Difference

An assertion (`as T`, or `<T>value`) is a **compile-time-only instruction to the compiler**: it changes zero runtime behavior and performs zero checks. A type guard is **actual runtime code** the compiler is taught to trust because it genuinely inspects the value.

```ts
interface User { id: string; name: string; }

// ASSERTION — pure compiler bookkeeping, no check happens
function unsafeToUser(value: unknown): User {
  return value as User; // compiles no matter what `value` actually is
}

const fake = unsafeToUser({ nothing: "here" });
console.log(fake.name.toUpperCase()); // compiles... crashes at runtime, `name` is undefined

// TYPE GUARD — real runtime logic, the compiler trusts it BECAUSE it actually checks
function isUser(value: unknown): value is User {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as any).id === "string" &&
    typeof (value as any).name === "string"
  );
}

function safeToUser(value: unknown): User {
  if (!isUser(value)) throw new Error("Not a User");
  return value; // genuinely proven to be User at this point
}
```

The `as any` *inside* `isUser` is fine and intentional — it's confined to reading properties for the purpose of checking them, never escapes the function, and every property read is guarded by a `typeof` check before being trusted.

`asserts` functions (covered in [type-narrowing/advanced.md](../type-narrowing/advanced.md)) are the "throw instead of return false" sibling of `is` predicates — same underlying idea, different control flow shape.

## `as const`

`as const` is a different kind of assertion — instead of lying about a type, it narrows a literal to its most specific possible form and makes it deeply `readonly`. It's a safe, honest assertion because it doesn't reduce type safety, it increases precision.

```ts
// without as const — widened to the general types
const config1 = { role: "admin", retries: 3 };
// { role: string; retries: number }

// with as const — kept as exact literals, and made readonly
const config2 = { role: "admin", retries: 3 } as const;
// { readonly role: "admin"; readonly retries: 3 }

config2.role = "member"; // ❌ compile error — readonly
```

This matters enormously for deriving literal unions from a single array, instead of maintaining the array and the union type separately:

```ts
const ROLES = ["admin", "member", "guest"] as const;
// readonly ["admin", "member", "guest"] — each element kept as its own literal, not widened to string

type Role = typeof ROLES[number]; // "admin" | "member" | "guest"

function checkRole(role: Role) { /* ... */ }
checkRole("admin"); // ✅
checkRole("owner"); // ❌ — not in ROLES, caught at compile time

// without `as const`, ROLES would be string[], and typeof ROLES[number] would just be `string`
```

## Runtime Validation Libraries: Zod and io-ts

TypeScript types vanish at compile time — nothing stops a malformed payload from an external API, a message queue, or `JSON.parse` from flowing through your code with a type annotation that is simply a lie the compiler was told to believe. Validation libraries close this gap by deriving the TypeScript type **from the same schema used to validate at runtime**, so the two can never drift apart.

```ts
import { z } from "zod";

const OrderSchema = z.object({
  id: z.string(),
  total: z.number().positive(),
  status: z.enum(["pending", "shipped", "delivered"]),
  items: z.array(z.object({ sku: z.string(), qty: z.number().int().positive() })),
});

type Order = z.infer<typeof OrderSchema>; // the TS type IS the schema's shape — always in sync

async function fetchOrder(id: string): Promise<Order> {
  const res = await fetch(`/api/orders/${id}`);
  const body: unknown = await res.json();
  return OrderSchema.parse(body); // throws with a detailed error if the shape is wrong
}

// .safeParse for non-throwing validation
const result = OrderSchema.safeParse(body);
if (!result.success) {
  console.error(result.error.issues); // structured, field-level validation errors
} else {
  console.log(result.data.total); // fully typed Order
}
```

`io-ts` (older, more functional-style, common in fp-ts-based codebases) follows the same core idea with a different API shape:

```ts
import * as t from "io-ts";

const OrderCodec = t.type({
  id: t.string,
  total: t.number,
});

type Order2 = t.TypeOf<typeof OrderCodec>; // same derive-the-type-from-the-schema idea

const decoded = OrderCodec.decode(body); // returns an Either<Errors, Order2>, not a throw
```

The architectural rule this enables: **only the boundary layer (API client, message consumer, env var loader) ever touches `unknown`.** Everything past that boundary works with a fully-typed, runtime-verified value — the validation happens exactly once, at the edge.

## Locking Down `any` with the Compiler

`any` isn't always written explicitly — it frequently sneaks in implicitly, and `tsconfig` has a dedicated flag to catch that.

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,           // enables noImplicitAny among other checks
    "noImplicitAny": true,    // untyped parameters/variables are errors, not silent `any`
  }
}
```

```ts
// with noImplicitAny: false (or no strict mode) — this silently compiles
function processItems(items) { // `items` implicitly typed `any`
  return items.map(i => i.value); // no error, even though `.value` might not exist
}

// with noImplicitAny: true
function processItems(items) {
  // ❌ Parameter 'items' implicitly has an 'any' type
}
```

`strict: true` is the single highest-leverage setting in any real TypeScript project — turning it on for a large legacy codebase after the fact is painful, but turning it off (or never turning it on) means `any` accumulates invisibly.

## Locking Down `any` with ESLint

The compiler stops *implicit* `any` under `strict`, but does nothing about *explicit* `any` (`function f(x: any)`) — that requires a lint rule.

```jsonc
// .eslintrc.json
{
  "plugins": ["@typescript-eslint"],
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unsafe-assignment": "error", // flags assigning an `any`-typed value to a typed variable
    "@typescript-eslint/no-unsafe-member-access": "error", // flags property access on an `any`-typed value
    "@typescript-eslint/no-unsafe-call": "error" // flags calling an `any`-typed value as a function
  }
}
```

```ts
function handleWebhook(payload: any) {
  // ❌ no-explicit-any: Unexpected any. Specify a different type.
}

const config = fetchConfig(); // returns `any` from an untyped legacy function
const port = config.port;     // ❌ no-unsafe-member-access: accessing `.port` on an `any` value
```

When `any` is genuinely unavoidable (some untyped third-party library, or a deliberately dynamic escape hatch), the convention is an explicit, reviewable suppression rather than silent tolerance:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy lib has no types, tracked in JIRA-1234
function legacyBridge(value: any) { /* ... */ }
```

The disable comment forces a human decision and a paper trail, instead of `any` blending invisibly into normal code.

## Tracing and Fixing `any` Propagation

Because `any` is contagious (any value it touches also becomes `any`), the fix is always to plug the leak at its *origin*, not at every downstream site where it causes a problem.

```ts
// origin of the leak
function fetchConfig(): any {
  return JSON.parse(readFileSync("config.json", "utf-8"));
}

// the FIX is here, not at every call site downstream
const ConfigSchema = z.object({
  port: z.number(),
  timeout: z.number(),
});
type Config = z.infer<typeof ConfigSchema>;

function fetchConfig2(): Config {
  const raw: unknown = JSON.parse(readFileSync("config.json", "utf-8"));
  return ConfigSchema.parse(raw); // validated once, typed everywhere downstream
}
```

A useful debugging technique for a large codebase: enable `no-unsafe-*` ESLint rules temporarily (even just locally) and let them light up every place an existing `any` has already spread — that list of lint errors *is* the propagation trace.

## Why It Matters

- A type assertion that's wrong doesn't fail where it's written — it fails somewhere downstream, disguised as an unrelated crash, which makes assertions far more expensive to debug than a narrowing check that fails loudly and immediately.
- `as const` is what makes "derive a union type from a single array/object" possible — without it, teams end up maintaining the runtime list and the TypeScript union as two separate, driftable sources of truth.
- Validation libraries are the only real fix for the fact that TypeScript types are erased at runtime — a `.ts` annotation on parsed JSON is a promise, not a guarantee, until something actually checks it.
- `noImplicitAny` plus `no-explicit-any` together are what actually prevent `any` from being the path of least resistance on a team with more than one engineer.

## Common Mistakes

- Reaching for `as T` to silence a type error from external data instead of writing (or generating, via Zod) an actual validator.
- Treating `as const` as just "make it readonly" and missing its more valuable effect — locking literal values to their exact type instead of the widened general type.
- Enabling `no-explicit-any` but not `no-unsafe-member-access`/`no-unsafe-call`, which still lets `any` leak in through untyped third-party function returns even though no one wrote `any` explicitly.
- Fixing an `any` propagation bug by adding a type assertion at the crash site instead of tracing back to where the untyped value entered the system.
- Deriving a schema's TypeScript type by hand instead of with `z.infer`/`t.TypeOf`, recreating the exact "two sources of truth can drift" problem the validation library was meant to solve.

## Questions to Test Yourself

1. Why does `value as User` compile even when `value` is provably not a `User`-shaped object, while a proper `isUser` type guard would catch the same mismatch?
2. What does `as const` change about `{ role: "admin" }` that a plain `readonly` annotation on the same object would not?
3. Why does deriving `type Order = z.infer<typeof OrderSchema>` prevent a whole class of bugs that hand-writing an `Order` interface alongside a separate validator does not?
4. What's the difference between what `noImplicitAny` catches and what `@typescript-eslint/no-explicit-any` catches?
5. If `fetchConfig()` returns `any` and three functions downstream each do something unsafe with the result, where should the actual fix be applied, and why?
