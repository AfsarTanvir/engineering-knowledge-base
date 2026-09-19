# Union and Intersection Types

Real-world data isn't uniform — an API can return success or failure, a webhook can carry one of a dozen event types, a form field can be a string or `null`. Union and intersection types let you model that variability precisely instead of loosening everything to `any` or overloading a single object with fields that don't all make sense together.

## Table of Contents

1. [Union Types](#union-types)
2. [Literal Type Unions](#literal-type-unions)
3. [Intersection Types](#intersection-types)
4. [Discriminated Unions](#discriminated-unions)
5. [Combining Unions and Intersections](#combining-unions-and-intersections)
6. [Real Example: API/Data Modeling](#real-example-apidata-modeling)
7. [What Happens Without Them](#what-happens-without-them)
8. [Common Mistakes](#common-mistakes)
9. [Questions to Test Yourself](#questions-to-test-yourself)

---

## Union Types

A union means "this value is one of several possible types," using `|`.

```ts
function formatId(id: string | number): string {
  return typeof id === "string" ? id : id.toString();
}

formatId("abc"); // ✅
formatId(123);   // ✅
formatId(true);  // ❌ compile error — boolean isn't part of the union
```

Unions represent real variability — a value that legitimately can come in more than one form and must be handled for every case:

```ts
function getUser(id: string | null): User | undefined {
  if (id === null) return undefined; // handle the "no id" case explicitly
  return users.find((u) => u.id === id);
}
```

## Literal Type Unions

Instead of a bare `string`, you can restrict a value to a fixed set of exact strings (or numbers) — an enum-like pattern that's often more idiomatic than TypeScript's `enum`.

```ts
type Status = "pending" | "approved" | "rejected";

function handleStatus(status: Status) {
  if (status === "approved") {
    console.log("approved!");
  }
}

handleStatus("shipped"); // ❌ compile error — not one of the allowed literal values
```

```ts
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

function request(method: HttpMethod, url: string) { /* ... */ }

request("get", "/users"); // ❌ compile error — literal unions are case-sensitive
request("GET", "/users"); // ✅
```

The compiler rejects any value outside the allowed set at every call site — a typo like `"aproved"` is caught immediately instead of silently falling through an `if/else` chain at runtime.

## Intersection Types

An intersection combines multiple types into one that must satisfy **all** of them, using `&`. Where a union says "one of," an intersection says "all of, merged together."

```ts
interface Timestamped {
  createdAt: Date;
  updatedAt: Date;
}

interface Named {
  name: string;
}

type Product = Timestamped & Named & {
  price: number;
};

const product: Product = {
  name: "Widget",
  price: 9.99,
  createdAt: new Date(),
  updatedAt: new Date(),
}; // must satisfy ALL three shapes — missing any field is a compile error
```

Intersections are how you compose small, reusable shapes into a bigger one instead of redefining the same fields (`createdAt`, `updatedAt`) on every entity interface by hand.

```ts
interface WithPagination {
  page: number;
  pageSize: number;
}

interface WithSorting {
  sortBy: string;
  sortDirection: "asc" | "desc";
}

type ListQuery = WithPagination & WithSorting;

function listProducts(query: ListQuery) { /* query has all four fields */ }
```

## Discriminated Unions

A discriminated union is a union of object types that all share one common "tag" field with a different literal value per variant — the single most useful pattern for modeling "one of several possible shapes" data.

```ts
type PaymentResult =
  | { success: true; transactionId: string }
  | { success: false; errorCode: string };

function handlePayment(result: PaymentResult) {
  if (result.success) {
    console.log(result.transactionId); // ✅ narrowed — this branch has transactionId
    // console.log(result.errorCode);  // ❌ error — not on this branch
  } else {
    console.log(result.errorCode); // ✅ narrowed to the other branch
  }
}
```

The `success` field is the **discriminant** — checking it lets TypeScript narrow which branch of the union you're in, safely, without any casting.

```ts
interface Circle { kind: "circle"; radius: number; }
interface Square { kind: "square"; side: number; }
type Shape = Circle | Square;

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius ** 2; // narrowed to Circle
    case "square":
      return shape.side ** 2; // narrowed to Square
  }
}
```

This pattern makes illegal states **unrepresentable** — you can never accidentally construct a payment result that has both a `transactionId` and an `errorCode`, because no member of the union allows that combination.

## Combining Unions and Intersections

Real data models frequently need both at once — a union of variants, each of which is itself an intersection of smaller shapes.

```ts
interface BaseEvent {
  id: string;
  timestamp: Date;
}

type WebhookEvent =
  | (BaseEvent & { type: "user.created"; userId: string })
  | (BaseEvent & { type: "user.deleted"; userId: string; reason: string })
  | (BaseEvent & { type: "payment.failed"; orderId: string; errorCode: string });

function handleEvent(event: WebhookEvent) {
  console.log(event.id, event.timestamp); // common fields, always present

  switch (event.type) {
    case "user.created":
      console.log(event.userId);
      break;
    case "user.deleted":
      console.log(event.userId, event.reason); // reason only exists on this variant
      break;
    case "payment.failed":
      console.log(event.orderId, event.errorCode);
      break;
  }
}
```

Each variant intersects the shared `BaseEvent` shape with its own specific fields, and the whole thing is a union so `handleEvent` can accept any of them while still narrowing correctly per case.

## Real Example: API/Data Modeling

```ts
interface SuccessResponse<T> {
  status: "success";
  data: T;
}

interface ErrorResponse {
  status: "error";
  message: string;
  code: number;
}

type ApiResult<T> = SuccessResponse<T> | ErrorResponse;

interface User { id: string; name: string; }

async function callApi<T>(url: string): Promise<ApiResult<T>> {
  const res = await fetch(url);
  const body = await res.json();

  if (!res.ok) {
    return { status: "error", message: "Request failed", code: res.status };
  }
  return { status: "success", data: body as T };
}

const result = await callApi<User>("/api/user/1");
if (result.status === "success") {
  console.log(result.data.name); // narrowed to SuccessResponse<User>
} else {
  console.log(result.message, result.code); // narrowed to ErrorResponse
}
```

This models exactly what a real API interaction looks like: one of two outcomes, checked explicitly, with no field ever accessible unless it's guaranteed present in that branch.

## What Happens Without Them

- A single "kitchen sink" object with every possible field marked optional (`data?`, `error?`, `errorCode?`) — nothing stops you from constructing an object with both `data` and `error` set, an illegal state that now has to be defended against at every call site instead of being impossible by construction.
- Loosely-typed `string` fields where a literal union would catch typos (`"aproved"` vs `"approved"`) at compile time instead of during a support ticket.
- Manual duplication of shared fields (`id`, `createdAt`) across every variant instead of composing them once via intersection.

## Common Mistakes

- Modeling "one of several shapes" data as one object with everything optional, instead of a discriminated union — this allows invalid combinations of fields to exist.
- Forgetting to give every variant of a union the same discriminant field name (`kind` in one, `type` in another) — this breaks narrowing.
- Using `&` (intersection) when a union was actually meant — merging two incompatible shapes (e.g. `{ role: "admin" } & { role: "member" }`) produces a field typed as `never`, since no value can satisfy both literals at once.
- Not handling every branch of a union in a `switch`, silently leaving a case unhandled (pair this with an `exhaustiveness check` via a `never` default case for safety).

## Questions to Test Yourself

1. Why does a discriminated union prevent you from ever constructing an object with both `data` and `error` set?
2. What's the difference between what `|` and `&` do to two object types?
3. Why would `{ role: "admin" } & { role: "member" }` produce a field of type `never`?
4. How do you compose a union of variants that each share some common fields plus their own specific ones?
5. Give a real API scenario where a literal union (e.g. `"pending" | "approved" | "rejected"`) is safer than a plain `string`.
