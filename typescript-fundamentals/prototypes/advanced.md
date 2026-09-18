# Prototypes — Advanced

The base file covers what a prototype chain is and how `class` sits on top of it. This file covers the performance cost of long chains, why `__proto__` is discouraged in favor of `Object.create`/`Object.setPrototypeOf`, mixins built via prototype composition, how TypeScript's structural type system relates to this runtime mechanism, and the specific pitfall of accidentally shadowing a prototype method. See [prototypes.md](./prototypes.md) for the basics this builds on.

## Table of Contents

1. [Performance Implications of Long Prototype Chains](#performance-implications-of-long-prototype-chains)
2. [`__proto__` vs `Object.setPrototypeOf` vs `Object.create`](#__proto__-vs-objectsetprototypeof-vs-objectcreate)
3. [Mixins via Prototype Composition](#mixins-via-prototype-composition)
4. [TypeScript's Structural Typing vs the Runtime Prototype Chain](#typescripts-structural-typing-vs-the-runtime-prototype-chain)
5. [Common Pitfall: Shadowing a Prototype Method](#common-pitfall-shadowing-a-prototype-method)
6. [Why It Matters](#why-it-matters)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)

---

## Performance Implications of Long Prototype Chains

Every property lookup that isn't found directly on an object has to walk the chain link by link until it's found (or the chain ends at `null`). For a normal 2-3 level class hierarchy this cost is negligible — V8 and other engines heavily optimize this with "hidden classes"/inline caches. But an artificially deep chain (many layers of `Object.create`, or deep inheritance hierarchies) makes every miss more expensive, and it also makes engine optimizations less effective because the shape of the chain is harder to predict.

```ts
// constructing an artificially deep chain to illustrate the cost
let proto: any = { value: 'deepest' };
for (let i = 0; i < 1000; i++) {
  proto = Object.create(proto);
}
const deep = Object.create(proto);

console.log(deep.value); // still works — but this lookup walks ~1000 links to find it
```

In practice this is rarely the actual bottleneck in real applications — algorithmic issues and I/O dominate almost always — but it's a real reason to prefer flat composition (a handful of mixed-in methods) over deep chains of inheritance layered purely for code reuse.

## `__proto__` vs `Object.setPrototypeOf` vs `Object.create`

`__proto__` is a legacy accessor property, originally a non-standard browser extension that got retroactively standardized (as "Annex B", the spec section for legacy-but-required-for-web-compatibility features) only for backward compatibility — it's not meant for new code.

```ts
// legacy, discouraged
const obj: any = {};
obj.__proto__ = { greet: () => 'hi' };

// modern, explicit, and doesn't rely on a "magic" property name
const obj2: any = {};
Object.setPrototypeOf(obj2, { greet: () => 'hi' });

// best when creating a NEW object — set the prototype at creation time
const obj3 = Object.create({ greet: () => 'hi' });
```

Reasons `__proto__` is discouraged:
- It's a property access, which means it can be shadowed or overridden by a poorly-named data property in some environments, causing confusing bugs.
- `Object.setPrototypeOf` and `Object.create` are explicit function calls that clearly signal intent and can't be confused with regular property assignment.
- Changing an object's prototype *after* creation (whether via `__proto__` or `Object.setPrototypeOf`) is a de-optimization in most engines — they've already committed to an internal shape/hidden class assuming a stable prototype. Prefer setting the prototype once, at creation, via `Object.create`.

## Mixins via Prototype Composition

JavaScript doesn't support multiple inheritance (a class can only `extends` one other class), but you can compose behavior by copying methods from multiple source objects onto a prototype — a "mixin."

```ts
const CanFly = {
  fly() {
    return `${(this as any).name} is flying`;
  },
};

const CanSwim = {
  swim() {
    return `${(this as any).name} is swimming`;
  },
};

class Duck {
  constructor(public name: string) {}
}

// mix both behaviors onto Duck's prototype
Object.assign(Duck.prototype, CanFly, CanSwim);

interface Duck extends CanFlyType, CanSwimType {} // TS declaration merging so the type system knows about the mixed-in methods (see interfaces/advanced.md)
type CanFlyType = typeof CanFly;
type CanSwimType = typeof CanSwim;

const duck = new Duck('Donald');
console.log((duck as any).fly());  // "Donald is flying"
console.log((duck as any).swim()); // "Donald is swimming"
```

This is genuinely how a lot of real-world composition works under the hood (it's effectively what many "trait" or "behavior" libraries do) — copy or link functions onto a shared prototype so every instance can use them without duplicating the function per instance.

## TypeScript's Structural Typing vs the Runtime Prototype Chain

TypeScript's type system is **structural** — it decides whether a value satisfies a type by checking the shape (does it have the right properties/methods), not by checking whether it descends from a particular prototype at runtime. This can diverge from the actual prototype chain.

```ts
interface HasName {
  name: string;
}

class Person {
  constructor(public name: string) {}
}

const plainObject = { name: 'Ada' }; // never went through `new Person(...)`, no relation to Person.prototype at all

function greet(entity: HasName) {
  console.log(`Hello, ${entity.name}`);
}

greet(new Person('Grace')); // ✅ fine
greet(plainObject);         // ✅ ALSO fine — TS only checks the shape, not the prototype chain

console.log(plainObject instanceof Person); // false at runtime — no prototype relationship exists
```

`instanceof` is a **runtime** check that walks the actual prototype chain looking for `Person.prototype`; TypeScript's structural type-checking is a **compile-time** check based purely on the declared shape. A value can structurally satisfy an interface while having a completely unrelated (or absent) prototype chain — the two mechanisms are related in spirit (both about "does this look like a Person") but operate independently, one at compile time on types, one at runtime on actual objects.

## Common Pitfall: Shadowing a Prototype Method

Defining an own property with the same name as an inherited prototype method silently shadows it — the own property always wins during lookup, which can break code (including built-ins) that expected the original method's behavior.

```ts
const obj: any = { a: 1 };

// accidentally naming a data property the same as a well-known Object.prototype method
obj.hasOwnProperty = 'oops, this is now a string, not a function';

console.log(obj.hasOwnProperty); // "oops, this is now a string, not a function" — shadowed
// obj.hasOwnProperty('a'); // ❌ TypeError: obj.hasOwnProperty is not a function
```

This is the actual reason `Object.hasOwn(obj, key)` (a static method, immune to being shadowed by a rogue own property) is now preferred over calling `obj.hasOwnProperty(key)` directly — user-controlled data (e.g., an object built from untrusted JSON) could contain a key literally named `hasOwnProperty` or `toString` and silently break code that assumes those methods are still callable.

```ts
const untrustedData = JSON.parse('{"toString": "gotcha", "value": 42}');
// console.log(untrustedData.toString()); // ❌ TypeError — toString is now a string, not a function
console.log(Object.hasOwn(untrustedData, 'value')); // true — unaffected by shadowing, since it's a static call
```

## Why It Matters

Understanding that prototype chains are real, mutable, walkable objects (not a fixed compile-time relationship) explains several categories of bugs: performance cliffs from deep or frequently-reshaped chains, `instanceof` disagreeing with what "looks like" the right type, and data silently breaking method calls by shadowing them. It also demystifies mixin-based composition, which shows up in some real backend/frontend framework internals even when the code you write day-to-day is all `class`-based.

## Common Mistakes

- Mutating an object's prototype after creation via `__proto__` or `Object.setPrototypeOf`, causing engine de-optimizations, instead of setting it once via `Object.create`.
- Expecting `instanceof` to succeed for any object that "looks like" the right shape — it only checks the actual prototype chain, unrelated to TypeScript's structural typing.
- Building an object from untrusted external data and calling a method on it (`.hasOwnProperty()`, `.toString()`) without accounting for the possibility that the data shadowed that method with a plain value.
- Building deep inheritance hierarchies purely for code reuse when a flatter mixin/composition approach would be simpler and cheaper.

## Questions to Test Yourself

1. Why is mutating an object's prototype after creation (via `__proto__` or `Object.setPrototypeOf`) worse for performance than setting it once via `Object.create`?
2. Two objects both have a `.name: string` property but only one was created via `new Person(...)`. Does `entity: HasName` accept both under TypeScript? Does `instanceof Person` accept both at runtime? Why the difference?
3. How would a JSON payload from an untrusted source break a naive call to `obj.hasOwnProperty(key)`, and what's the safer alternative?
4. What real-world problem do mixins solve that single-parent `class extends` cannot?
