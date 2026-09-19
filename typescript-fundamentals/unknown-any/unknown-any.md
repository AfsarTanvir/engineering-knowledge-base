# `unknown` vs `any`

Data from outside your program's control — a parsed JSON body, an API response, `JSON.parse` output, user input — has no guaranteed shape until you check it. `any` and `unknown` are TypeScript's two ways of saying "I don't statically know this type," but they behave completely differently: one quietly disables the type checker, the other forces you to prove safety before you can use the value.

## Table of Contents

1. [Why `any` Is Dangerous](#why-any-is-dangerous)
2. [`unknown` — A Safe Placeholder](#unknown--a-safe-placeholder)
3. [Using `unknown` Safely](#using-unknown-safely)
4. [Type Assertions (`as`) and Their Danger](#type-assertions-as-and-their-danger)
5. [`any` Spreads — the Contagion Problem](#any-spreads--the-contagion-problem)
6. [Practical Guidance for External/Untrusted Data](#practical-guidance-for-externaluntrusted-data)
7. [What Happens Without This Discipline](#what-happens-without-this-discipline)
8. [Common Mistakes](#common-mistakes)
9. [Questions to Test Yourself](#questions-to-test-yourself)

---

## Why `any` Is Dangerous

`any` tells TypeScript "stop checking this value" — every property access, method call, and assignment on it is allowed, correct or not.

```ts
function processAny(data: any) {
  console.log(data.toUpperCase()); // no compile error...
}

processAny(42);
// ...but CRASHES at runtime: "data.toUpperCase is not a function"
// TypeScript should have caught this — it didn't, because `any` opted out entirely
```

The entire point of TypeScript is to catch exactly this class of bug at compile time. `any` doesn't just fail to help here — it actively suppresses the error that would otherwise have appeared.

## `unknown` — A Safe Placeholder

`unknown` also means "I don't know the type yet," but unlike `any`, it does not let you do anything with the value until you've proven what it actually is.

```ts
function processUnknown(data: unknown) {
  console.log(data.toUpperCase()); // ❌ compile error — must narrow the type first
}
```

Compare the two directly:

```ts
let a: any = "hello";
let u: unknown = "hello";

a.toUpperCase(); // ✅ compiles (even though it might crash for other inputs)
u.toUpperCase(); // ❌ compile error — Object is of type 'unknown'
```

`unknown` is the type-safe counterpart to `any`: it accepts anything (just like `any` can), but it refuses to let that value be *used* as anything specific without a check first.

## Using `unknown` Safely

Once you narrow an `unknown` value with a runtime check, TypeScript lets you use it as the narrowed type within that branch.

```ts
function processUnknown(data: unknown) {
  if (typeof data === "string") {
    console.log(data.toUpperCase()); // ✅ safe — narrowed to string
  } else if (typeof data === "number") {
    console.log(data.toFixed(2)); // ✅ safe — narrowed to number
  } else {
    console.log("unsupported type");
  }
}
```

For object shapes, you typically pair `unknown` with a validation function or library (e.g. Zod) rather than hand-rolled `typeof` checks:

```ts
interface User {
  id: string;
  name: string;
}

function isUser(value: unknown): value is User {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    typeof (value as User).id === "string" &&
    typeof (value as User).name === "string"
  );
}

function handleResponse(body: unknown) {
  if (isUser(body)) {
    console.log(body.name); // ✅ safely narrowed to User
  } else {
    throw new Error("Unexpected response shape");
  }
}
```

`value is User` is a **type predicate** — it tells TypeScript "if this function returns true, treat `value` as `User` from here on."

## Type Assertions (`as`) and Their Danger

`as` tells the compiler "trust me, treat this value as this type" — it performs **no runtime check at all**. If you're wrong, the mistake surfaces later as a crash, not at the assertion site.

```ts
const data: unknown = JSON.parse('{"id": 1}'); // note: id is a NUMBER here
const user = data as User; // ❌ lies to the compiler — no check actually happens

console.log(user.id.toUpperCase());
// compiles fine (id is "typed" as string)... crashes at runtime:
// "user.id.toUpperCase is not a function"
```

`as` is sometimes legitimate (e.g. narrowing a `unknown` value after you've already validated it some other way, or telling the compiler about a DOM element's specific type), but it should never be used to silence an error you haven't actually resolved.

```ts
// legitimate: you just validated this yourself
if (isUser(data)) {
  const user = data; // already User, no `as` needed — isUser() did the narrowing
}

// illegitimate: papering over a real type mismatch
const brokenUser = { name: "no id field" } as User; // compiles, but user.id is undefined at runtime
```

## `any` Spreads — the Contagion Problem

Once a function returns `any`, everything downstream that touches its result silently loses type safety too — even if every other function involved is fully, carefully typed.

```ts
function fetchConfig(): any {
  return JSON.parse(readFileSync("config.json", "utf-8"));
}

const config = fetchConfig(); // config: any
const timeout = config.timeout; // any — no error even if this field doesn't exist
const doubled = timeout * 2;    // any — still no error, even though timeout could be a string

function startServer(port: number) {
  /* ... */
}
startServer(config.port); // ❌ should be checked, but isn't — config.port is `any`
```

One `any` at the boundary of your system can quietly disable checking across an entire call chain.

## Practical Guidance for External/Untrusted Data

Treat anything that crosses a trust boundary — an HTTP response body, `JSON.parse` output, `process.env`, form input, a message queue payload — as `unknown` until validated.

```ts
async function getUser(id: string): Promise<User> {
  const res = await fetch(`/api/users/${id}`);
  const body: unknown = await res.json(); // never assume the shape

  if (!isUser(body)) {
    throw new Error("Invalid user shape from API");
  }
  return body; // now genuinely, safely typed as User
}
```

In practice, most teams use a validation library (Zod, io-ts, Yup) instead of hand-written type predicates — the library both validates at runtime and derives the TypeScript type from the same schema, so the two can never drift apart.

```ts
import { z } from "zod";

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
});
type User = z.infer<typeof UserSchema>; // type derived from the schema itself

async function getUser(id: string): Promise<User> {
  const res = await fetch(`/api/users/${id}`);
  const body: unknown = await res.json();
  return UserSchema.parse(body); // throws at runtime if the shape is wrong, otherwise typed
}
```

## What Happens Without This Discipline

- `any` at a system boundary means a malformed API response, a schema change on another team's service, or a corrupted message payload flows silently into your business logic and crashes somewhere far from the actual cause.
- `as` used to silence errors hides real bugs — the compiler stops complaining, but the underlying mismatch is still there, waiting to surface at runtime.
- Debugging becomes "which of the 12 functions this `any` passed through introduced the bad value?" instead of a compile error pointing at the exact line.

## Common Mistakes

- Reaching for `any` the moment TypeScript complains about external data, instead of typing it as `unknown` and narrowing.
- Using `as` to make a type error go away without actually checking whether the assertion is true.
- Assuming `JSON.parse()`'s return type (`any` in the standard lib) is safe to use directly without validation.
- Writing a type predicate (`value is User`) that doesn't actually check all the fields it claims to guarantee — a predicate that lies is just as dangerous as `as`.

## Questions to Test Yourself

1. Why does `unknown.toUpperCase()` fail to compile while `any.toUpperCase()` compiles fine, even though neither is proven to be a string?
2. What does a function like `function isUser(value: unknown): value is User` actually do differently from a normal boolean-returning function?
3. Why is `data as User` potentially dangerous even though it makes the compile error go away?
4. Why does one function returning `any` risk disabling type safety for many functions downstream of it?
5. What should the type of a parsed JSON API response be before you've validated its shape, and why?
