# Generics

Generics let you write a single function, interface, or class that works with **many types while preserving the relationship between input and output types**. Without them, you either duplicate code per type or use `any` and throw away type safety entirely — generics are how TypeScript lets you have both reuse and precision.

## Table of Contents

1. [Why Generics Exist](#why-generics-exist)
2. [Generic Functions](#generic-functions)
3. [Generic Interfaces and Types](#generic-interfaces-and-types)
4. [Generic Constraints (`extends`)](#generic-constraints-extends)
5. [Multiple Type Parameters](#multiple-type-parameters)
6. [Default Generic Parameters](#default-generic-parameters)
7. [Generic Classes](#generic-classes)
8. [Real Backend Example: Generic API Response Wrapper](#real-backend-example-generic-api-response-wrapper)
9. [Real Backend Example: Generic Repository Pattern](#real-backend-example-generic-repository-pattern)
10. [What Happens Without Generics](#what-happens-without-generics)
11. [Common Mistakes](#common-mistakes)
12. [Questions to Test Yourself](#questions-to-test-yourself)

---

## Why Generics Exist

```ts
// without generics — duplicated code, one function per type
function firstString(arr: string[]): string {
  return arr[0];
}
function firstNumber(arr: number[]): number {
  return arr[0];
}

// without generics, using `any` — one function, but ALL type safety is gone
function firstAny(arr: any[]): any {
  return arr[0];
}
const x = firstAny([1, 2, 3]);
x.toUpperCase(); // no compile error, but crashes at runtime — x is actually a number
```

Generics solve both problems at once: one implementation, and the compiler still knows the exact type for each call site.

```ts
function first<T>(arr: T[]): T {
  return arr[0];
}

const a = first([1, 2, 3]);       // T inferred as number → a: number
const b = first(["x", "y", "z"]); // T inferred as string → b: string
a.toFixed(2);   // ✅ fine, a is a number
b.toUpperCase(); // ✅ fine, b is a string
```

`T` is a **type variable** — a placeholder filled in per call, the same way a function parameter is a value placeholder filled in per call.

## Generic Functions

Type parameters can be explicit or inferred from the arguments.

```ts
function wrapInArray<T>(value: T): T[] {
  return [value];
}

wrapInArray(5);           // inferred T = number → number[]
wrapInArray("hi");        // inferred T = string → string[]
wrapInArray<boolean>(true); // explicit, in case inference is ambiguous
```

A more realistic example — a generic function that pairs a key extractor with a collection:

```ts
function groupBy<T, K extends string | number>(items: T[], keyFn: (item: T) => K): Record<K, T[]> {
  const result = {} as Record<K, T[]>;
  for (const item of items) {
    const key = keyFn(item);
    (result[key] ??= []).push(item);
  }
  return result;
}

interface Order { id: string; status: "pending" | "shipped"; total: number; }

const orders: Order[] = [
  { id: "1", status: "pending", total: 10 },
  { id: "2", status: "shipped", total: 20 },
];

const grouped = groupBy(orders, (o) => o.status);
// grouped.pending and grouped.shipped are both Order[], fully typed
```

## Generic Interfaces and Types

Interfaces and type aliases can also take type parameters, letting one shape describe many concrete types.

```ts
interface Box<T> {
  value: T;
}

const numberBox: Box<number> = { value: 42 };
const stringBox: Box<string> = { value: "hello" };

type Pair<A, B> = { first: A; second: B };

const pair: Pair<string, number> = { first: "age", second: 30 };
```

This is how library types like `Array<T>`, `Promise<T>`, and `Map<K, V>` are defined — they're just generic interfaces/types the compiler ships with.

## Generic Constraints (`extends`)

Sometimes an unconstrained `T` isn't enough — you need to guarantee the generic type has certain fields before you can safely use them.

```ts
interface HasId {
  id: string;
}

function findById<T extends HasId>(items: T[], id: string): T | undefined {
  return items.find((item) => item.id === id); // safe — every T is guaranteed to have .id
}

interface User { id: string; name: string; }
const users: User[] = [{ id: "1", name: "Afsar" }];

findById(users, "1"); // ✅ works — User satisfies HasId

findById([{ name: "no id field" }], "1");
// ❌ compile error — the object literal doesn't satisfy HasId
```

Without the constraint, `T` would be treated as completely unknown inside the function, and `item.id` wouldn't even compile.

```ts
function badFindById<T>(items: T[], id: string): T | undefined {
  return items.find((item) => item.id === id);
  // ❌ Property 'id' does not exist on type 'T'
}
```

## Multiple Type Parameters

Generics aren't limited to one parameter — you can relate several types to each other in a single signature.

```ts
function merge<T extends object, U extends object>(a: T, b: U): T & U {
  return { ...a, ...b };
}

const merged = merge({ name: "Widget" }, { price: 9.99 });
// merged: { name: string } & { price: number }
console.log(merged.name, merged.price); // both fields known and typed
```

```ts
function mapRecord<K extends string, V, R>(
  record: Record<K, V>,
  fn: (value: V, key: K) => R
): Record<K, R> {
  const result = {} as Record<K, R>;
  for (const key in record) {
    result[key] = fn(record[key], key);
  }
  return result;
}
```

## Default Generic Parameters

A type parameter can have a default, so callers only need to specify it when they want something other than the default.

```ts
interface PaginatedResult<T = unknown> {
  items: T[];
  page: number;
  totalPages: number;
}

// caller must still say what T is if they want type safety on `items`
const usersPage: PaginatedResult<User> = { items: users, page: 1, totalPages: 3 };

// falls back to `unknown` if omitted — forces narrowing before use
const genericPage: PaginatedResult = { items: [1, "x", true], page: 1, totalPages: 1 };
```

Defaults are especially useful for utility types used broadly across a codebase, where most call sites want a sensible default but a few need to override it.

## Generic Classes

Classes can carry type parameters through their entire instance surface — constructor, methods, and fields.

```ts
class Stack<T> {
  private items: T[] = [];

  push(item: T): void {
    this.items.push(item);
  }

  pop(): T | undefined {
    return this.items.pop();
  }

  peek(): T | undefined {
    return this.items[this.items.length - 1];
  }

  get size(): number {
    return this.items.length;
  }
}

const numberStack = new Stack<number>();
numberStack.push(1);
numberStack.push(2);
numberStack.pop(); // 2, typed as number | undefined

const userStack = new Stack<User>();
userStack.push({ id: "1", name: "Afsar" });
userStack.push("not a user"); // ❌ compile error — Stack<User> only accepts User
```

## Real Backend Example: Generic API Response Wrapper

A single response shape reused for every endpoint, with the payload type varying per call.

```ts
interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface Order { id: string; total: number; }

function fetchUser(): ApiResponse<User> {
  return { success: true, data: { id: "1", name: "Afsar" } };
}

function fetchOrders(): ApiResponse<Order[]> {
  return { success: true, data: [] };
}

const userResponse = fetchUser();
console.log(userResponse.data.name); // ✅ TypeScript knows data is User here

const ordersResponse = fetchOrders();
console.log(ordersResponse.data.length); // ✅ TypeScript knows data is Order[] here
```

One interface, reused across every endpoint in the codebase, with full type safety on `data` in every case.

## Real Backend Example: Generic Repository Pattern

A generic repository lets you write CRUD logic once and reuse it for every entity in the system.

```ts
interface Entity {
  id: string;
}

class Repository<T extends Entity> {
  private items = new Map<string, T>();

  save(item: T): void {
    this.items.set(item.id, item);
  }

  findById(id: string): T | undefined {
    return this.items.get(id);
  }

  findAll(): T[] {
    return [...this.items.values()];
  }

  delete(id: string): boolean {
    return this.items.delete(id);
  }
}

interface Product extends Entity { name: string; price: number; }

const productRepo = new Repository<Product>();
productRepo.save({ id: "p1", name: "Widget", price: 9.99 });
const product = productRepo.findById("p1"); // Product | undefined, fully typed

const userRepo = new Repository<User>();
userRepo.save({ id: "u1", name: "Afsar" });
// same Repository implementation, completely different entity type, still type-safe
```

This is exactly how ORMs and data-access layers (TypeORM, Prisma-style wrappers, custom repositories) avoid writing near-identical CRUD code per entity.

## What Happens Without Generics

- You duplicate near-identical functions/classes per type (`firstString`, `firstNumber`, `firstBoolean`, …), and every bug fix has to be applied N times.
- Or you reach for `any`, which silently disables checking everywhere that value flows — a wrong-shape object can travel deep into your codebase before anything catches it.
- Utility code (stacks, queues, repositories, response wrappers) becomes either type-unsafe or copy-pasted per entity.

## Common Mistakes

- Using `any` instead of `<T>` "to make it work" — this defeats the entire purpose and reintroduces runtime crashes generics were meant to prevent.
- Forgetting a constraint and then trying to access a field TypeScript can't guarantee exists (`item.id` on an unconstrained `T`).
- Over-generic-izing simple code that only ever needs one concrete type — adds noise without any real reuse benefit.
- Not naming type parameters meaningfully in complex signatures (`T`, `U`, `V` everywhere) when `TItem`, `TKey` would make the signature self-documenting.

## Questions to Test Yourself

1. Why does `first<T>(arr: T[]): T` preserve type safety in a way that `first(arr: any[]): any` does not?
2. What does `<T extends HasId>` buy you over an unconstrained `<T>` inside the function body?
3. How would you design a generic `Repository<T extends Entity>` so it works for both a `User` and a `Product` without duplicating CRUD logic?
4. When would you give a generic type parameter a default value, and what happens if the caller doesn't supply one?
5. Why is `ApiResponse<T>` a better design than writing a separate response interface per endpoint?
