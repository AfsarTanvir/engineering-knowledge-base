# Objects and References

Primitives (`number`, `string`, `boolean`, `null`, `undefined`) are copied **by value**. Objects, arrays, and functions are copied **by reference**. This single fact explains a huge share of "why did my data change when I didn't touch it" bugs — including most React "state didn't update" bugs.

## Table of Contents

1. [What Is It?](#what-is-it)
2. [Value vs Reference — The Core Rule](#value-vs-reference--the-core-rule)
3. [Function Arguments Follow the Same Rule](#function-arguments-follow-the-same-rule)
4. [Equality: `===` on Objects](#equality--on-objects)
5. [Copying Objects Correctly (Shallow Copy)](#copying-objects-correctly-shallow-copy)
6. [Shallow Copy Isn't Enough for Nested Data](#shallow-copy-isnt-enough-for-nested-data)
7. [Real Bug: Mutating Shared State](#real-bug-mutating-shared-state)
8. [Real Bug: React State Not Updating](#real-bug-react-state-not-updating)
9. [What Happens Without Understanding This](#what-happens-without-understanding-this)
10. [Common Mistakes](#common-mistakes)
11. [Questions to Test Yourself](#questions-to-test-yourself)

---

## What Is It?

```ts
// primitives — copied BY VALUE
let a = 5;
let b = a; // b gets its own independent copy of 5
b = 10;
console.log(a); // 5 — untouched

// objects — copied BY REFERENCE
const obj1 = { count: 5 };
const obj2 = obj1; // obj2 points to the SAME object in memory, not a copy
obj2.count = 10;
console.log(obj1.count); // 10 — obj1 changed too!
```

`obj1` and `obj2` are two different variable names pointing at the **same** underlying object in memory. Changing it through one name changes what the other name sees.

## Value vs Reference — The Core Rule

```text
number, string, boolean, null, undefined, symbol, bigint  →  copied by value
object, array, function, Map, Set, Date, class instance    →  copied by reference
```

`const` on an object does **not** make the object immutable — it only prevents reassigning the variable itself.

```ts
const user = { name: "Afsar" };
user.name = "Someone else"; // ✅ allowed — mutating the object, not reassigning `user`
user = { name: "New object" }; // ❌ TypeError — reassigning a const binding
```

## Function Arguments Follow the Same Rule

```ts
function incrementValue(n: number) {
  n = n + 1; // only changes the local copy
}
let x = 5;
incrementValue(x);
console.log(x); // 5 — unaffected

function addField(obj: { name: string }) {
  obj.name = "modified"; // mutates the object the caller also holds a reference to
}
const person = { name: "original" };
addField(person);
console.log(person.name); // "modified" — the caller's object changed!
```

This is why passing objects into functions requires care: the function can mutate what the caller sees, even without a `return`.

## Equality: `===` on Objects

`===` on objects compares **reference identity**, not contents.

```ts
const p1 = { x: 1, y: 2 };
const p2 = { x: 1, y: 2 };
console.log(p1 === p2); // false — different objects in memory, even though contents match

const p3 = p1;
console.log(p1 === p3); // true — same reference
```

To compare contents, you need a deep-equality check (e.g. `JSON.stringify(p1) === JSON.stringify(p2)` for simple cases, or a library like `lodash.isEqual` for real cases).

## Copying Objects Correctly (Shallow Copy)

```ts
const original = { name: "Afsar", role: "engineer" };

// spread — shallow copy
const copy = { ...original };
copy.role = "senior engineer";
console.log(original.role); // "engineer" — unaffected, top-level fields were copied

// same idea for arrays
const arr = [1, 2, 3];
const arrCopy = [...arr];
arrCopy.push(4);
console.log(arr); // [1, 2, 3] — unaffected
```

## Shallow Copy Isn't Enough for Nested Data

The spread operator only copies **one level deep**. Nested objects/arrays are still shared references.

```ts
const original = {
  name: "Afsar",
  address: { city: "Dhaka" },
};

const copy = { ...original };
copy.address.city = "Chittagong";

console.log(original.address.city); // "Chittagong" — changed! address is a shared reference
```

To truly deep-copy, use `structuredClone(obj)` (built into modern JS/Node) or a deep-clone utility.

```ts
const deepCopy = structuredClone(original);
deepCopy.address.city = "Sylhet";
console.log(original.address.city); // unaffected now
```

## Real Bug: Mutating Shared State

```ts
function getDefaultSettings() {
  return { theme: "light", notifications: true };
}

const defaults = getDefaultSettings();
const userA = defaults; // ❌ userA is the SAME object as defaults, not a copy
userA.theme = "dark";

console.log(defaults.theme); // "dark" — the shared "default" object got corrupted
```

This class of bug is extremely common with configuration objects, cached data, and anything returned from a factory function and then "customized" per caller without copying first.

## Real Bug: React State Not Updating

```ts
// BROKEN — mutating the existing array reference
const [items, setItems] = useState([1, 2, 3]);
function addItem() {
  items.push(4);       // mutates in place
  setItems(items);      // same reference as before → React sees no change → no re-render
}

// CORRECT — create a new array/object reference
function addItem() {
  setItems([...items, 4]); // new array reference → React detects the change → re-renders
}
```

React (and most state libraries) detect changes by comparing references (`===`), not deep contents. Mutating in place keeps the same reference, so the framework thinks nothing changed.

## What Happens Without Understanding This

- Shared "default" or "template" objects get silently corrupted by one caller and affect every other caller.
- React/Vue components stop re-rendering because state was mutated instead of replaced.
- Functions have hidden side effects on their arguments — a caller passes in an object expecting it to be read-only, but it comes back mutated.

## Common Mistakes

- Assuming `const` makes an object immutable.
- Assuming `{...obj}` deep-copies nested data.
- Passing an object into a function and being surprised the caller's object changed.
- Comparing objects with `===` expecting content equality.

## Questions to Test Yourself

1. Why does `const obj = {}` still allow `obj.field = 1`?
2. What's the difference between reassigning a variable and mutating the object it points to?
3. Why does `{ ...original }` fail to protect nested objects from mutation?
4. Why does `setState(sameArrayReference)` sometimes not cause a re-render in React?
5. If a function takes an object parameter and needs to "modify" it without affecting the caller, what should it do instead?
