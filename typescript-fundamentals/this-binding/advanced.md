# `this` Binding — Advanced

The base file covers the day-to-day bug (losing `this` on a passed-around method) and the everyday fixes. This file covers the underlying rules that explain *why* those fixes work, what changes under strict mode, `this` across class inheritance, and where `this` bites you in nested callbacks and framework internals. See [this-binding.md](./this-binding.md) for the basics this builds on.

## Table of Contents

1. [The Four Binding Rules](#the-four-binding-rules)
2. [`this` Under Strict Mode](#this-under-strict-mode)
3. [`this` in Constructors and `new` Binding](#this-in-constructors-and-new-binding)
4. [`this` and Class Inheritance / `super`](#this-and-class-inheritance--super)
5. [`this` Pitfalls in Nested Callbacks](#this-pitfalls-in-nested-callbacks)
6. [`this` in Decorators and DI-Style Frameworks](#this-in-decorators-and-di-style-frameworks)
7. [Why It Matters](#why-it-matters)
8. [Common Mistakes](#common-mistakes)
9. [Questions to Test Yourself](#questions-to-test-yourself)

---

## The Four Binding Rules

Every call to a regular (non-arrow) function resolves `this` using one of four rules, checked in this precedence order:

```text
1. new binding      → `new Fn()`               → this = the newly created object
2. explicit binding → fn.call(obj) / .apply(obj) / .bind(obj) → this = obj
3. implicit binding → obj.fn()                 → this = obj (whatever is left of the dot)
4. default binding  → fn()                     → this = undefined (strict) or globalThis (sloppy)
```

```ts
function show(this: unknown) {
  console.log(this);
}

show();                          // rule 4: default → undefined (strict mode)
show.call({ id: 1 });            // rule 2: explicit → { id: 1 }
const obj = { show };
obj.show();                      // rule 3: implicit → obj
new (show as any)();             // rule 1: new → a fresh object, `this` is that object
```

Arrow functions follow **none** of these rules — they ignore all four and always use the `this` captured lexically at definition time, which is why `.call()`/`.bind()` on an arrow function silently has no effect on its `this`.

```ts
const arrow = () => console.log(this);
arrow.call({ id: 99 }); // still whatever `this` was where `arrow` was defined — the .call() is ignored
```

## `this` Under Strict Mode

Sloppy mode (no `"use strict"`, no ES modules) falls back `this` to the **global object** (`globalThis`/`window`) when a function is called with no receiver. Strict mode (automatic in ES modules, classes, and anywhere you write `"use strict"`) instead leaves `this` as `undefined`.

```ts
// sloppy mode
function sloppyFn() {
  console.log(this); // globalThis — silently succeeds, masking the bug
}
sloppyFn();

// strict mode (default in all TS files, all ES modules, all class bodies)
function strictFn() {
  'use strict';
  console.log(this); // undefined
}
strictFn();
```

This matters because sloppy mode's fallback to the global object *hides* the "lost `this`" bug instead of surfacing it — code might accidentally read/write `globalThis.someProperty` instead of throwing immediately. TypeScript compiles to strict-mode-equivalent module code by default, which is why in practice `this` bugs in TS usually surface loudly (`Cannot read properties of undefined`) rather than silently touching the global object.

## `this` in Constructors and `new` Binding

Calling a function with `new` creates a brand-new object, sets that object as `this` inside the function/constructor, and (unless the function explicitly returns another object) returns it automatically.

```ts
function Product(this: { name: string; price: number }, name: string, price: number) {
  this.name = name;
  this.price = price;
  // no explicit return — `new` automatically returns `this`
}

const p = new (Product as any)('Widget', 9.99);
console.log(p.name, p.price); // "Widget" 9.99
```

Forgetting `new` on an old-style constructor function is a classic bug: without it, rule 4 (default binding) applies instead of rule 1, so `this` becomes `undefined`/`globalThis`, and you silently mutate global state or throw, instead of creating an object. Modern `class` syntax protects against this — calling a class without `new` is a hard `TypeError`, by design.

```ts
class Product2 {
  constructor(public name: string) {}
}

Product2('Widget'); // ❌ TypeError: Class constructor Product2 cannot be invoked without 'new'
```

## `this` and Class Inheritance / `super`

In a subclass, `this` is not usable until `super()` has been called — the base class is responsible for actually creating the instance. This is different from function-based inheritance patterns and trips people up coming from other languages.

```ts
class Animal {
  constructor(public name: string) {}
  speak() {
    return `${this.name} makes a sound.`;
  }
}

class Dog extends Animal {
  constructor(name: string, public breed: string) {
    // console.log(this); // ❌ ReferenceError if placed BEFORE super() — `this` isn't bound yet
    super(name); // must run first — this is what actually initializes `this`
    this.breed = breed; // ✅ now `this` exists
  }

  speak() {
    return `${super.speak()} (${this.breed})`; // super.speak() calls Animal's method
                                                 // with `this` still bound to the Dog instance
  }
}

const d = new Dog('Rex', 'Labrador');
console.log(d.speak()); // "Rex makes a sound. (Labrador)"
```

`super.method()` is not "explicit binding" via `call`/`apply` — it's special syntax that looks up `method` on the parent's prototype but still calls it with the *current* `this` (the subclass instance), so overridden state (like `this.breed`) is visible even inside the parent's method logic if the parent reads `this`.

## `this` Pitfalls in Nested Callbacks

The base file shows the `setTimeout` case. The same rule bites inside array methods and any callback-accepting API when a regular function is used instead of an arrow function.

```ts
class OrderService {
  private validStatuses = ['pending', 'shipped'];

  filterValid(orders: { status: string }[]) {
    // BROKEN — regular function callback, `this` is undefined inside it
    return orders.filter(function (order) {
      return this.validStatuses.includes(order.status); // ❌ TypeError: Cannot read properties of undefined
    });
  }

  filterValidFixed(orders: { status: string }[]) {
    // FIXED — arrow function callback inherits `this` from filterValidFixed's own `this`
    return orders.filter((order) => this.validStatuses.includes(order.status));
  }
}
```

Some array methods (`.map`, `.filter`, `.forEach`, `.find`, etc.) accept an optional second `thisArg` parameter as an alternative fix, but it's rarely used in modern code since arrow functions solve it more clearly:

```ts
orders.filter(function (order) {
  return this.validStatuses.includes(order.status);
}, this); // second argument sets `this` inside the callback — legal but uncommon today
```

## `this` in Decorators and DI-Style Frameworks

Framework-agnostic conceptually: decorators (used heavily in Nest-style dependency injection, ORMs, validation libraries) wrap or register a class method, and the wrapping layer decides how it later invokes your method. If a framework's internal dispatcher calls your decorated method as a plain function reference (rather than `instance.method(...)`), you hit the exact same lost-`this` bug — except now it's hidden inside library internals instead of your own code.

```ts
// conceptual sketch — not a specific framework's real decorator implementation
function Route(path: string) {
  return function (target: any, propertyKey: string) {
    // if the framework later does `registeredHandlers[path]()` instead of
    // `registeredHandlers[path].call(instance)`, `this` inside your handler is lost
  };
}

class UserController {
  @Route('/users')
  index() {
    console.log(this); // depends entirely on how the framework's internal dispatcher invokes this
  }
}
```

This is exactly why most DI/decorator-based frameworks either (a) auto-bind decorated methods to their instance internally, or (b) document that you must use arrow-function class fields for handlers — the underlying mechanism is identical to the plain `setTimeout(obj.method)` bug, just one layer further from your own code, and harder to spot because the call site lives inside a library you didn't write.

## Why It Matters

Nearly every "it works when I call it directly but breaks when the framework calls it" bug report traces back to one of the four binding rules being violated at some invocation site you don't control. Knowing the rules precisely — rather than pattern-matching "add `.bind(this)` somewhere" — lets you diagnose *which* call site broke the binding instead of guessing.

## Common Mistakes

- Assuming `super.method()` uses `call`/`apply` semantics — it doesn't; it's dedicated syntax that still uses the current instance's `this`.
- Reading/writing `this` before calling `super()` in a subclass constructor.
- Relying on sloppy-mode's silent fallback to `globalThis` during debugging, then being surprised when the same code throws in a TS/ESM strict-mode context.
- Assuming a decorator automatically preserves `this` — it depends entirely on how the framework invokes the wrapped method internally.

## Questions to Test Yourself

1. List the four `this`-binding rules in their precedence order. Which one wins if two rules seem to apply at once?
2. Why do arrow functions ignore `.call()` and `.bind()` entirely?
3. Why is accessing `this` before `super()` in a subclass constructor a `ReferenceError`?
4. Why can a `this` bug inside a framework decorator be harder to diagnose than the same bug in your own code?
