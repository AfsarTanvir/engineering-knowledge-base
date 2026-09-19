# `this` Binding

`this` is the single most common source of "works in one place, breaks in another" bugs when moving methods around — passing a controller method as an Express/Adonis route handler, passing `obj.method` to `setTimeout`, or destructuring a method off an object. Unlike most variables, `this` isn't determined by *where a function is written* — it's determined by *how it's called*. Understanding that distinction is the whole topic.

## Table of Contents

1. [What Is It?](#what-is-it)
2. [Why Do We Care?](#why-do-we-care)
3. [`this` in Object Methods vs Standalone Functions](#this-in-object-methods-vs-standalone-functions)
4. [Arrow Functions: Lexical `this`](#arrow-functions-lexical-this)
5. [The Classic Bug: Losing `this` as a Callback](#the-classic-bug-losing-this-as-a-callback)
6. [Fixing It: Arrow Functions, `.bind()`, Class Field Methods](#fixing-it-arrow-functions-bind-class-field-methods)
7. [`call`, `apply`, `bind` Explained](#call-apply-bind-explained)
8. [`this` in Classes](#this-in-classes)
9. [What Happens Without Understanding This](#what-happens-without-understanding-this)
10. [Common Mistakes](#common-mistakes)
11. [Questions to Test Yourself](#questions-to-test-yourself)

---

## What Is It?

`this` is a special keyword whose value is set **at call time**, not at definition time. A regular function's `this` is **dynamic** — it depends entirely on how the function was invoked.

```ts
function whoAmI() {
  console.log(this);
}

whoAmI(); // `this` is undefined (strict mode) or the global object (sloppy mode)

const obj = { name: 'server', whoAmI };
obj.whoAmI(); // `this` is `obj` — because it was called as obj.whoAmI()
```

Same function, same definition — two completely different `this` values, because it was *called* differently.

## Why Do We Care?

- Backend frameworks (Express, Adonis, Nest) constantly pass your class methods around as callbacks (`router.get('/users', userController.index)`) — and that call pattern strips the object context.
- `this` bugs are silent at compile time in plain JS and often silent in TS too (TS won't stop you from passing a method reference around unless you type `this` explicitly).
- It underlies `call`/`apply`/`bind`, which are core tools for explicitly controlling function context (used everywhere in middleware, event emitters, and utility libraries).

## `this` in Object Methods vs Standalone Functions

```ts
const logger = {
  prefix: '[APP]',
  log(message: string) {
    console.log(this.prefix, message); // `this` = logger, because logger.log(...) was the call
  },
};

logger.log('started'); // "[APP] started"

const detachedLog = logger.log;
detachedLog('started'); // ❌ TypeError-ish: this.prefix is undefined, because
                         // detachedLog() was called with no receiving object —
                         // `this` is undefined/global, not `logger`
```

The method didn't change. The *call site* changed, and that's what determines `this`.

## Arrow Functions: Lexical `this`

Arrow functions do **not** have their own `this`. They capture `this` from the **enclosing scope at the time they're defined** — this is called "lexical `this`," and it never changes based on how the arrow function is called.

```ts
const timer = {
  label: 'countdown',
  start() {
    // `this` here is `timer`, because start() was called as timer.start()
    setTimeout(function () {
      console.log(this); // ❌ NOT `timer` — regular function, `this` is undefined/global
    }, 100);

    setTimeout(() => {
      console.log(this.label); // ✅ "countdown" — arrow function captured `this` from start()'s scope
    }, 100);
  },
};

timer.start();
```

This is why arrow functions are the default choice for callbacks nested inside methods.

## The Classic Bug: Losing `this` as a Callback

This is the single most common real-world `this` bug — passing a method as a value instead of calling it.

```ts
// BROKEN
class UserController {
  private users = [{ id: 1, name: 'Ada' }];

  index() {
    console.log(this.users); // relies on `this` being the controller instance
  }
}

const controller = new UserController();

// Express/Adonis-style route registration — this PASSES the function,
// it does not CALL it with `controller` as the receiver
router.get('/users', controller.index);

// When Express later calls it as `handler(req, res)`, it's calling a
// detached function — `this` inside index() is undefined, NOT `controller`.
// Result: "Cannot read properties of undefined (reading 'users')"
```

```ts
setTimeout(controller.index, 100); // same bug — same root cause
```

The method itself is fine in isolation. The bug is entirely about *how it gets called later* — by the time Express or `setTimeout` invokes it, all context about "this came from `controller`" is gone.

## Fixing It: Arrow Functions, `.bind()`, Class Field Methods

**Option 1 — wrap in an arrow function at the call site:**

```ts
router.get('/users', (req, res) => controller.index(req, res));
// the arrow function itself doesn't need `this` — it just calls
// controller.index(...) as a proper method call, so `this` is correct inside index()
```

**Option 2 — `.bind()` the method:**

```ts
router.get('/users', controller.index.bind(controller));
// .bind(controller) returns a NEW function permanently locked to `this = controller`,
// regardless of how it's later called
```

**Option 3 — declare the method as a class field arrow function (most common fix in real codebases):**

```ts
class UserController {
  private users = [{ id: 1, name: 'Ada' }];

  // arrow function assigned as a class field — captures `this` from the
  // constructor's scope (the instance) at creation time, permanently
  index = () => {
    console.log(this.users);
  };
}

const controller = new UserController();
router.get('/users', controller.index); // ✅ works — `this` is already locked in
```

This is why you'll see `index = () => {}` instead of `index() {}` in a lot of real-world controller classes — it trades a tiny bit of memory (one function per instance instead of one per prototype) for never having this bug.

## `call`, `apply`, `bind` Explained

All three let you explicitly set `this` for a function call.

```ts
function greet(this: { name: string }, greeting: string, punctuation: string) {
  console.log(`${greeting}, ${this.name}${punctuation}`);
}

const user = { name: 'Grace' };

// call — invokes immediately, arguments passed individually
greet.call(user, 'Hello', '!'); // "Hello, Grace!"

// apply — invokes immediately, arguments passed as an array
greet.apply(user, ['Hi', '.']); // "Hi, Grace."

// bind — does NOT invoke; returns a new function with `this` locked in
const greetUser = greet.bind(user, 'Hey');
greetUser('?'); // "Hey, Grace?" — can still pass remaining args later
```

Mnemonic: **C**all = **C**omma-separated args. **A**pply = **A**rray of args. **B**ind = **B**uilds a new function for later.

## `this` in Classes

Inside a regular (non-arrow) class method, `this` refers to the instance the method was called on — same dynamic rule as object methods.

```ts
class Counter {
  count = 0;

  increment() {
    this.count++; // `this` = the instance, as long as called as instance.increment()
    return this.count;
  }
}

const c = new Counter();
c.increment(); // 1 — called correctly

const inc = c.increment;
inc(); // ❌ TypeError: Cannot read properties of undefined — detached again
```

## What Happens Without Understanding This

- Route handlers and event callbacks silently blow up with "Cannot read properties of undefined" the moment a method is passed by reference instead of called directly.
- Developers "fix" it by scattering `.bind(this)` everywhere without understanding why, or worse, by making everything a static/global function to sidestep `this` entirely — losing the benefits of instance state.
- Debugging is confusing because the method's *code* looks completely correct in isolation.

## Common Mistakes

- Passing `obj.method` as a callback (`setTimeout(obj.method, 100)`, `arr.map(obj.method)`, `router.get('/x', controller.method)`) without binding it first.
- Assuming arrow functions are "always safer" for object methods — an arrow function as an object literal property does NOT get the object as `this` (it captures `this` from the surrounding scope where the object literal was written, usually the module, not the object itself).
- Forgetting that `.bind()` returns a **new** function — rebinding a method every time you pass it (e.g., inside a render function) creates a new function reference each time, which can break `===` comparisons or React re-render optimizations.

## Questions to Test Yourself

1. Why does `const fn = obj.method; fn();` behave differently from `obj.method()`?
2. Why does an arrow function used as a callback inside a regular method correctly see the outer `this`, but a regular function does not?
3. What are the three common ways to fix a controller method losing its `this` when passed to a router, and what's the trade-off of the class-field-arrow approach?
4. What's the practical difference between `.call()`, `.apply()`, and `.bind()`?
