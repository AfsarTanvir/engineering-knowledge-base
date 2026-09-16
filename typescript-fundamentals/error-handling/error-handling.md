# Error Handling

Error handling isn't "wrap everything in try/catch." It's about deciding **where** errors should be caught, **what** should happen when they are (retry? fail the request? log and continue?), and making sure failures never pass silently or crash the whole process unnecessarily.

## Table of Contents

1. [What Is It?](#what-is-it)
2. [Why Do We Care?](#why-do-we-care)
3. [try/catch Basics](#trycatch-basics)
4. [Custom Error Classes](#custom-error-classes)
5. [Catching at the Right Layer](#catching-at-the-right-layer)
6. [Async Error Handling Gotchas](#async-error-handling-gotchas)
7. [Centralized Error Handling (Middleware)](#centralized-error-handling-middleware)
8. [Operational Errors vs Programmer Errors](#operational-errors-vs-programmer-errors)
9. [What Happens Without Proper Error Handling](#what-happens-without-proper-error-handling)
10. [Common Mistakes](#common-mistakes)
11. [Questions to Test Yourself](#questions-to-test-yourself)

---

## What Is It?

```ts
try {
  const data = JSON.parse(rawInput); // might throw if rawInput is invalid JSON
  console.log(data);
} catch (err) {
  console.error("Failed to parse input:", err);
}
```

`try` runs code that might throw. `catch` receives the thrown error and lets you decide what to do — log it, transform it, retry, or re-throw a different error.

## Why Do We Care?

- Every backend has failure modes: bad input, a down database, a third-party API timing out, a null where you expected an object.
- The question isn't "will this fail" — it's "when it fails, what happens to the user, the data, and the logs?"
- Uncaught errors in Node can crash the entire process, taking down every other in-flight request too.

## try/catch Basics

```ts
function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error("Cannot divide by zero");
  }
  return a / b;
}

try {
  const result = divide(10, 0);
  console.log(result);
} catch (err) {
  if (err instanceof Error) {
    console.error("Math error:", err.message);
  }
}
```

## Custom Error Classes

Plain `Error` objects don't tell you *what kind* of failure happened. Custom error classes let calling code react differently based on the error type — a huge deal in real backends.

```ts
class ValidationError extends Error {
  constructor(message: string, public field: string) {
    super(message);
    this.name = "ValidationError";
  }
}

class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

function getUser(id: string) {
  if (!id) throw new ValidationError("id is required", "id");
  const user = database.find(id);
  if (!user) throw new NotFoundError(`User ${id} not found`);
  return user;
}

try {
  getUser("");
} catch (err) {
  if (err instanceof ValidationError) {
    console.log(`400: ${err.message} (field: ${err.field})`);
  } else if (err instanceof NotFoundError) {
    console.log(`404: ${err.message}`);
  } else {
    console.log(`500: unexpected error`);
    throw err; // re-throw anything you don't recognize — don't swallow unknown errors
  }
}
```

This pattern is exactly how an API layer maps errors to correct HTTP status codes.

## Catching at the Right Layer

Don't catch errors where you can't do anything meaningful with them. Let them bubble up to a layer that can (log them, return the right response, alert someone).

```ts
// BAD — catching too early and swallowing the error
async function getOrders(userId: string) {
  try {
    return await db.query("SELECT * FROM orders WHERE user_id = ?", [userId]);
  } catch (err) {
    console.log("something went wrong"); // swallowed — caller has no idea it failed
    return []; // caller thinks the user just has zero orders — WRONG, the query actually failed
  }
}

// GOOD — let it bubble up to a layer that knows what to do with it
async function getOrders(userId: string) {
  return await db.query("SELECT * FROM orders WHERE user_id = ?", [userId]);
  // no try/catch here — the route handler / middleware decides how to respond
}
```

## Async Error Handling Gotchas

```ts
// BROKEN — a rejected promise inside an async route handler with no catch
// crashes the process (or hangs the request) depending on your framework setup
app.get("/user/:id", async (req, res) => {
  const user = await getUser(req.params.id); // if this throws, nothing catches it
  res.json(user);
});

// FIXED — wrap it, or use a framework helper that forwards async errors
app.get("/user/:id", async (req, res, next) => {
  try {
    const user = await getUser(req.params.id);
    res.json(user);
  } catch (err) {
    next(err); // forward to centralized error-handling middleware
  }
});
```

Many frameworks (Express by default, older versions especially) do **not** automatically catch rejected promises thrown inside async route handlers — you have to do it yourself unless the framework explicitly supports it (Express 5+ does; Adonis has its own exception handler).

## Centralized Error Handling (Middleware)

Instead of repeating try/catch in every route, funnel errors to one place that maps error types to HTTP responses.

```ts
// one place that decides how every error becomes an HTTP response
function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message, field: err.field });
  }
  if (err instanceof NotFoundError) {
    return res.status(404).json({ error: err.message });
  }
  console.error("Unhandled error:", err); // log unexpected errors for investigation
  return res.status(500).json({ error: "Internal server error" });
}
```

This is why AdonisJS/NestJS/Express apps have a single "exception handler" — it keeps every route from having to know how to format an error response.

## Operational Errors vs Programmer Errors

```text
Operational errors  → expected failure modes: bad input, DB down, network timeout, not found
                       → handle gracefully, respond appropriately, maybe retry
Programmer errors   → bugs: calling undefined method, wrong argument types, null reference
                       → don't try to "handle" these gracefully — fix the code
```

Trying to catch and "recover" from a programmer error (e.g. wrapping everything in try/catch and returning a fallback) hides real bugs instead of fixing them.

## What Happens Without Proper Error Handling

- One failed database call crashes the entire Node process, killing every other in-flight request.
- Swallowed errors return misleading data (e.g., an empty list) instead of surfacing a real failure — someone debugs a "missing data" issue for hours before realizing the query was actually erroring out the whole time.
- Users get raw stack traces or generic "Internal Server Error" messages with no way to know what actually went wrong on their end (e.g., bad input) vs. your end.

## Common Mistakes

- Catching an error and doing nothing useful with it (`catch (err) { console.log("error") }`).
- Catching too early, before you have enough context to decide what response to send.
- Not distinguishing between "the user did something wrong" (400) and "something broke on our end" (500).
- Not handling promise rejections in async route handlers.
- Catching every error the same way, regardless of type — losing the ability to respond correctly per failure mode.

## Questions to Test Yourself

1. What's the difference between an operational error and a programmer error, and why shouldn't you "handle" programmer errors the same way?
2. Why is `catch (err) { return [] }` around a failed database query worse than not catching it at all?
3. Why do frameworks provide centralized error-handling middleware instead of expecting try/catch in every route?
4. Why might an unhandled rejected promise inside an async Express route handler hang or crash a request, and how do you prevent it?
