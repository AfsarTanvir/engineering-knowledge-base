# Type Narrowing

Type narrowing is how TypeScript figures out a more specific type within a branch of your code, usually triggered by a runtime check you were probably already writing anyway. Without it, you'd need `as` everywhere just to work with a union or `unknown` value — narrowing is what lets that same code stay both safe and check-free.

## Table of Contents

1. [What Is It?](#what-is-it)
2. [Narrowing with `typeof`](#narrowing-with-typeof)
3. [Narrowing with `instanceof`](#narrowing-with-instanceof)
4. [Narrowing with `in`](#narrowing-with-in)
5. [Narrowing with Equality Checks](#narrowing-with-equality-checks)
6. [Discriminated Union Narrowing with `switch`](#discriminated-union-narrowing-with-switch)
7. [Narrowing by Elimination](#narrowing-by-elimination)
8. [Exhaustiveness Checking](#exhaustiveness-checking)
9. [What Happens Without Narrowing](#what-happens-without-narrowing)
10. [Common Mistakes](#common-mistakes)
11. [Questions to Test Yourself](#questions-to-test-yourself)

---

## What Is It?

```ts
function describe(value: string | number) {
  // here, `value` is string | number — you can only use members common to both
  if (typeof value === "string") {
    return value.toUpperCase(); // here, TypeScript knows value is specifically string
  }
  return value.toFixed(2); // here, TypeScript knows value is specifically number
}
```

Nothing special is "declared" — TypeScript reads the `if (typeof value === "string")` check itself and narrows the type of `value` inside that branch. The same variable has a different, more specific type depending on which branch of the code you're standing in.

## Narrowing with `typeof`

The most common narrowing tool for primitives — `string`, `number`, `boolean`, `undefined`, `function`, `object`, `symbol`, `bigint`.

```ts
function formatValue(value: string | number | undefined): string {
  if (typeof value === "undefined") {
    return "N/A";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return value.toFixed(2); // only number left
}
```

## Narrowing with `instanceof`

Used for class instances — checks the prototype chain at runtime, and TypeScript narrows accordingly.

```ts
class ValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
  }
}

function handleError(error: Error) {
  if (error instanceof ValidationError) {
    console.log(`Invalid field: ${error.field}`); // .field only exists on ValidationError
  } else {
    console.log(`General error: ${error.message}`);
  }
}
```

```ts
function describe(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString(); // narrowed to Date
  }
  return value.toUpperCase(); // narrowed to string
}
```

## Narrowing with `in`

Checks whether a property exists on an object at runtime — useful for narrowing between object shapes that don't share a discriminant field.

```ts
interface Cat { meow(): void; }
interface Dog { bark(): void; }

function makeSound(animal: Cat | Dog) {
  if ("meow" in animal) {
    animal.meow(); // narrowed to Cat
  } else {
    animal.bark(); // narrowed to Dog
  }
}
```

```ts
interface FileUpload { filename: string; buffer: Buffer; }
interface UrlUpload { url: string; }

function processUpload(upload: FileUpload | UrlUpload) {
  if ("buffer" in upload) {
    console.log(upload.filename, upload.buffer.length); // narrowed to FileUpload
  } else {
    console.log(upload.url); // narrowed to UrlUpload
  }
}
```

## Narrowing with Equality Checks

Direct `===`/`!==` comparisons (including against `null`/`undefined`) narrow just as well as `typeof`, and are often the most readable option for literal unions.

```ts
function describe(value: string | number | null) {
  if (value === null) {
    return "nothing"; // narrowed to null
  }
  if (typeof value === "string") {
    return value.toUpperCase(); // narrowed to string
  }
  return value.toFixed(2); // narrowed to number by elimination
}
```

```ts
type Direction = "up" | "down" | "left" | "right";

function move(direction: Direction) {
  if (direction === "up" || direction === "down") {
    console.log("vertical move"); // narrowed to "up" | "down"
  } else {
    console.log("horizontal move"); // narrowed to "left" | "right"
  }
}
```

## Discriminated Union Narrowing with `switch`

The most common real-world pattern: a shared "tag" field, narrowed per `case` in a `switch`.

```ts
interface Circle { kind: "circle"; radius: number; }
interface Square { kind: "square"; side: number; }
interface Rectangle { kind: "rectangle"; width: number; height: number; }
type Shape = Circle | Square | Rectangle;

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius ** 2; // narrowed to Circle
    case "square":
      return shape.side ** 2; // narrowed to Square
    case "rectangle":
      return shape.width * shape.height; // narrowed to Rectangle
  }
}
```

This is how you safely handle multiple shapes of real data — webhook event types, job queue payloads, WebSocket message types — without `any` and without any runtime surprises, since each `case` body only sees the fields that variant actually has.

## Narrowing by Elimination

Once every other possibility in a union has been ruled out by earlier checks, TypeScript narrows the remaining branch automatically — no explicit check on the last type is even needed.

```ts
function process(value: string | number | boolean) {
  if (typeof value === "string") {
    return value.toUpperCase();
  }
  if (typeof value === "number") {
    return value.toFixed(2);
  }
  // nothing left but boolean — TypeScript narrows it here without another typeof check
  return value ? "yes" : "no";
}
```

This works because TypeScript tracks, at each point in the code, exactly which members of the original union are still possible — as branches rule members out, the remaining type shrinks.

## Exhaustiveness Checking

Pairing a `switch` with a `never`-typed default catches the case where a new union member is added later but a handler forgets to cover it — turning a silent runtime gap into a compile error.

```ts
function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius ** 2;
    case "square":
      return shape.side ** 2;
    case "rectangle":
      return shape.width * shape.height;
    default:
      const _exhaustive: never = shape; // ❌ compile error if a case was missed
      throw new Error(`Unhandled shape: ${JSON.stringify(shape)}`);
  }
}
```

If someone later adds `interface Triangle { kind: "triangle"; ... }` to the `Shape` union but forgets to add a `case` here, `shape` in the `default` branch is no longer `never` — it's `Triangle` — and the assignment to `_exhaustive: never` fails to compile, catching the gap immediately instead of at runtime.

## What Happens Without Narrowing

- You'd need `as` to force a type at every use site of a union or `unknown` value, silencing errors instead of proving safety.
- Runtime crashes from calling a method that only exists on one branch of a union, on the branch where it doesn't (`shape.radius` when `shape` is actually a `Square`).
- Adding a new variant to a union later has no compiler support for catching call sites that forgot to handle it, unless you're using exhaustiveness checks.

## Common Mistakes

- Checking `typeof value === "object"` and forgetting that `typeof null === "object"` too — always check for `null` separately.
- Narrowing inside a callback and expecting it to persist — TypeScript can lose narrowing across closures if the variable could have been reassigned in between (use a local `const` copy if needed).
- Using `in` on properties that might exist due to inheritance/prototype pollution rather than the object's own declared shape.
- Skipping exhaustiveness checks on `switch` statements over unions that are likely to grow more variants over time.

## Questions to Test Yourself

1. Why does `typeof value === "string"` change what TypeScript allows you to do with `value` inside that `if` block?
2. When would you use `in` instead of `typeof` or `instanceof` to narrow between two object shapes?
3. How does narrowing by elimination let you skip an explicit check for the last remaining type in a union?
4. What does assigning to a `never`-typed variable in a `switch`'s `default` case actually protect you against?
5. Why might narrowing "not stick" inside a callback function, even though the check happened just before it was defined?
