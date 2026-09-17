# Destructuring and Spread — Advanced

See [destructuring-and-spread.md](./destructuring-and-spread.md) for the basics. This file covers the parts that actually cause production bugs: typing destructured parameters, destructuring values that might not exist, and the several ways spread quietly does something other than "copy".

## Table of Contents

1. [Typing Destructured Parameters](#typing-destructured-parameters)
2. [Destructuring `undefined` and `null`](#destructuring-undefined-and-null)
3. [Defaults Only Fire on `undefined`](#defaults-only-fire-on-undefined)
4. [Spread Does Not Copy Getters](#spread-does-not-copy-getters)
5. [Spread Loses the Prototype](#spread-loses-the-prototype)
6. [Spread Order and Overwriting `undefined`](#spread-order-and-overwriting-undefined)
7. [Computed and Dynamic Keys](#computed-and-dynamic-keys)
8. [Rest Removes Keys — The Omit Pattern](#rest-removes-keys--the-omit-pattern)
9. [Performance of Spread in Loops](#performance-of-spread-in-loops)
10. [Common Mistakes](#common-mistakes)
11. [Questions to Test Yourself](#questions-to-test-yourself)

---

## Typing Destructured Parameters

The type annotation goes on the **whole pattern**, not on the individual names. This trips people up constantly, because the syntax looks like it should work the other way.

```ts
// ❌ This is not a type annotation — it renames `name` to `string`
function greet({ name: string }) { }

// ✅ Annotate the pattern as a whole
function greet({ name }: { name: string }) {
  console.log(name.toUpperCase());
}

// ✅ Usually better — give the shape a name
interface GreetOptions {
  name: string;
  greeting?: string;
}

function greet({ name, greeting = 'Hello' }: GreetOptions) {
  console.log(`${greeting}, ${name}`);
}
```

For an options object where every field is optional, you also need a default for the object itself, or callers cannot omit the argument entirely:

```ts
interface FetchOptions {
  retries?: number;
  timeoutMs?: number;
}

//                                              ↓ default for the whole object
function fetchData({ retries = 3, timeoutMs = 5000 }: FetchOptions = {}) {
  // ...
}

fetchData();                 // works because of the `= {}`
fetchData({ retries: 5 });
```

Without `= {}`, `fetchData()` throws at runtime — see the next section for why.

## Destructuring `undefined` and `null`

Destructuring reads properties off the value. If the value is `null` or `undefined`, there is nothing to read from, and you get a `TypeError`.

```ts
const user = undefined;
const { name } = user;
// TypeError: Cannot destructure property 'name' of 'user' as it is undefined.
```

This is the single most common destructuring bug, and it usually appears when data comes from somewhere that can legitimately return nothing — an API response, `Array.prototype.find`, a database lookup.

```ts
// ❌ BROKEN — find() returns undefined when nothing matches
const users = [{ id: 1, name: 'Ada' }];
const { name } = users.find(u => u.id === 999);
// TypeError at runtime

// ✅ FIXED — default the whole destructured value
const { name } = users.find(u => u.id === 999) ?? {};
// name is undefined, no throw

// ✅ Usually better — handle the missing case explicitly
const found = users.find(u => u.id === 999);
if (!found) throw new NotFoundError('User not found');
const { name } = found;
```

> **⚠️ Warning:** TypeScript catches this only if the type is honest about being possibly `undefined`. `find()` returns `T | undefined`, so TypeScript will complain — unless `strictNullChecks` is off, or someone used a non-null assertion (`!`) to silence it. An `any` from an untyped API response silences it too. See [unknown-any](../unknown-any/unknown-any.md).

Nested destructuring multiplies the risk, because every level must exist:

```ts
// throws if `user` exists but `user.address` does not
const { address: { city } } = user;

// safer — default the intermediate object
const { address: { city } = {} } = user;
```

## Defaults Only Fire on `undefined`

A destructuring default is used when the value is `undefined` — **not** when it is `null`, `0`, `''`, or `false`.

```ts
function configure({ retries = 3, debug = false } = {}) {
  console.log(retries, debug);
}

configure({ retries: undefined }); // 3     — default applied
configure({ retries: null });      // null  — default NOT applied
configure({ retries: 0 });         // 0     — correct, 0 is a real value
```

The `null` case matters because JSON has `null` but not `undefined`. A payload from an API or a database row will hand you `null`, and your default will not fire.

```ts
// ❌ BROKEN — API returns { timeoutMs: null }, default never applies
const { timeoutMs = 5000 } = await res.json();
setTimeout(fn, timeoutMs); // setTimeout(fn, null) → fires immediately

// ✅ FIXED — ?? treats both null and undefined as "missing"
const raw = await res.json();
const timeoutMs = raw.timeoutMs ?? 5000;
```

This is the same distinction covered in [equality-and-coercion](../equality-and-coercion/equality-and-coercion.md) — `??` handles `null` and `undefined`, `||` handles every falsy value.

## Spread Does Not Copy Getters

Spread reads each property and copies the resulting **value**. A getter is invoked once during the spread, and what lands in the new object is a plain data property holding whatever it returned at that moment.

```ts
const order = {
  items: [{ price: 10 }, { price: 20 }],
  get total() {
    return this.items.reduce((sum, i) => sum + i.price, 0);
  },
};

console.log(order.total); // 30

const copy = { ...order };
copy.items.push({ price: 100 });

console.log(order.total); // 130 — still a live getter
console.log(copy.total);  // 30  — frozen value from spread time
```

The same applies to setters, which are lost entirely. If you need to preserve accessors, copy the property descriptors instead:

```ts
const copy = Object.defineProperties(
  {},
  Object.getOwnPropertyDescriptors(order)
);
```

Spread also skips non-enumerable properties and ignores `Symbol` keys only in some contexts — spread **does** copy enumerable symbol keys, while `Object.assign` behaves the same, but `JSON.stringify` drops them. If you rely on symbol keys, verify rather than assume.

## Spread Loses the Prototype

Spread produces a plain object. Anything that came from the prototype chain — class methods, `instanceof` — does not survive.

```ts
class Invoice {
  constructor(public amount: number) {}
  format() {
    return `$${this.amount}`;
  }
}

const invoice = new Invoice(100);
const copy = { ...invoice };

console.log(invoice.format());        // "$100"
console.log(copy instanceof Invoice); // false
console.log(copy.format);             // undefined — method lives on the prototype
```

This is why spreading a class instance, a `Date`, a `Map`, or a `Set` gives you something broken rather than a copy:

```ts
const d = new Date();
const bad = { ...d };  // {} — Date's internal state is not an own enumerable property

const m = new Map([['a', 1]]);
const alsoBad = { ...m }; // {} — Map entries are internal, not properties
const good = new Map(m);  // proper copy
```

See [prototypes](../prototypes/prototypes.md) for why the methods live where they do, and [objects-and-references](../objects-and-references/advanced.md) for `structuredClone` as the deep-copy option.

## Spread Order and Overwriting `undefined`

Later spreads win. That is the whole rule, and it makes the "merge defaults" pattern work:

```ts
const defaults = { retries: 3, timeoutMs: 5000 };
const config = { ...defaults, ...userOptions };
```

The trap is that an explicit `undefined` still counts as a value and still overwrites:

```ts
const userOptions = { retries: undefined };
const config = { ...defaults, ...userOptions };
console.log(config.retries); // undefined — not 3
```

This bites when options are built programmatically (`{ retries: req.query.retries }` where the query parameter is absent). Strip undefined values first, or set defaults after:

```ts
// ✅ defaults applied last, so they only fill genuine gaps
const config = { ...userOptions };
config.retries ??= 3;
```

## Computed and Dynamic Keys

You can destructure a key whose name is only known at runtime, but you must supply a local name:

```ts
const key = 'name';
const { [key]: value } = user; // value = user.name
```

TypeScript loses precision here unless the key is a literal type. Keeping the key as a `const` (or using `as const`) preserves it:

```ts
const key = 'name' as const;
const { [key]: value } = user; // value: string, not string | number
```

Computed keys in object literals combine with spread for conditional properties:

```ts
const patch = {
  ...(name !== undefined && { name }),
  ...(email !== undefined && { email }),
};
```

This works because spreading `false` contributes nothing, while spreading an object contributes its keys. It is concise, but it is also the kind of cleverness that confuses reviewers — an explicit `if` is often kinder.

## Rest Removes Keys — The Omit Pattern

Rest in object destructuring is the standard way to drop fields, and it is genuinely useful for stripping sensitive data before sending a response:

```ts
const { passwordHash, resetToken, ...safeUser } = user;
return res.json(safeUser);
```

Two cautions. First, this is a **shallow** operation — a nested object still holds a shared reference, so a nested secret is not removed. Second, and more importantly, it is a deny-list: a new sensitive column added by a migration silently appears in the response because nobody updated this line. An allow-list is safer:

```ts
// ✅ allow-list — new columns do not leak by default
const safeUser = {
  id: user.id,
  name: user.name,
  email: user.email,
};
```

Linters will often flag `passwordHash` as an unused variable. Configure the rule to ignore rest siblings rather than renaming it to `_passwordHash`.

## Performance of Spread in Loops

Each spread allocates a new object or array and copies every element. Inside a loop, that turns linear work into quadratic work.

```ts
// ❌ BROKEN — O(n²), copies the whole array on every iteration
let result: number[] = [];
for (const item of items) {
  result = [...result, transform(item)];
}

// ✅ FIXED — O(n)
const result: number[] = [];
for (const item of items) {
  result.push(transform(item));
}
```

The same pattern appears with `reduce`:

```ts
// ❌ allocates a new object per item
items.reduce((acc, item) => ({ ...acc, [item.id]: item }), {});

// ✅ mutate the accumulator you own
items.reduce((acc, item) => {
  acc[item.id] = item;
  return acc;
}, {} as Record<string, Item>);
```

Mutating an object you created inside the function is not the mutation problem that immutability rules are warning about — nobody else holds a reference to it. Reserve the copying for values that came from outside.

> **💡 Tip:** `Math.max(...hugeArray)` can throw a stack-overflow error, because spread passes each element as a separate argument and engines cap argument count. Use a reduce for large arrays.

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| `function f({ name: string })` | Renames the variable, does not type it | `function f({ name }: { name: string })` |
| Destructuring an API result directly | Throws if the value is `null`/`undefined` | `?? {}`, or check first |
| Expecting a default to apply to `null` | Defaults only fire on `undefined` | Use `??` |
| `{ ...classInstance }` | Loses prototype, methods, `instanceof` | Copy descriptors, or a real clone method |
| `{ ...date }` / `{ ...map }` | Produces `{}` | `new Date(d)`, `new Map(m)` |
| `result = [...result, x]` in a loop | O(n²) allocation | `result.push(x)` |
| Rest to strip secrets | Deny-list; new columns leak | Build an explicit allow-list |
| Assuming spread deep-copies | It is one level only | `structuredClone` |

## Questions to Test Yourself

1. Why does `function greet({ name: string })` compile but not do what it looks like it does?
2. What exactly happens when you destructure a value that is `undefined`, and why does `?? {}` fix it?
3. A default is written as `{ timeoutMs = 5000 }`. The API returns `{ "timeoutMs": null }`. What value do you get, and why?
4. After `const copy = { ...order }`, why does `copy.total` stop updating when `order.total` is a getter?
5. Why is `{ ...new Date() }` an empty object?
6. Two objects are merged with `{ ...defaults, ...options }` and a default is being lost. What is the likely cause?
7. Why is `items.reduce((acc, i) => ({ ...acc, [i.id]: i }), {})` a performance problem, and when would it not matter?
8. Why is `const { passwordHash, ...safe } = user` a weaker protection than listing the safe fields explicitly?
