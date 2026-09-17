# Equality and Coercion

`==` silently converts types before comparing, which produces results that look like bugs even when the language is behaving "correctly." This single habit — reaching for `==` instead of `===`, or writing `if (value)` without thinking about which falsy values are actually valid — causes some of the most confusing production bugs, especially around the number `0` and the empty string `""` being valid data that gets treated as "nothing."

## Table of Contents

1. [What Is It?](#what-is-it)
2. [Why `===` Should Be Your Default](#why--should-be-your-default)
3. [Surprising `==` Results](#surprising--results)
4. [`NaN` and Why `NaN === NaN` Is False](#nan-and-why-nan--nan-is-false)
5. [`Object.is` vs `===`](#objectis-vs-)
6. [Truthy and Falsy Values](#truthy-and-falsy-values)
7. [The Real Bug: `if (value)` with Valid Falsy Data](#the-real-bug-if-value-with-valid-falsy-data)
8. [What Happens Without Understanding This](#what-happens-without-understanding-this)
9. [Common Mistakes](#common-mistakes)
10. [Questions to Test Yourself](#questions-to-test-yourself)

---

## What Is It?

`==` ("loose equality") converts operands to a common type before comparing. `===` ("strict equality") compares both value *and* type, with no conversion.

```ts
console.log(1 == '1');   // true  — '1' is converted to the number 1 first
console.log(1 === '1');  // false — different types, no conversion, straightforwardly false

console.log(0 == false); // true  — false is converted to 0 first
console.log(0 === false); // false — number vs boolean, no conversion
```

## Why `===` Should Be Your Default

`===` is predictable: same type + same value = true, anything else = false. `==`'s conversion rules are numerous and not something most developers have memorized, which means every `==` comparison is a small bet that you remembered the rule correctly.

```ts
// with ==, you have to know the coercion table by heart to predict the result
console.log('' == 0);          // true
console.log('' == '0');        // false
console.log(null == undefined); // true
console.log(null == 0);        // false — null is special-cased, doesn't coerce to a number here

// with ===, every one of these is simply false — different types, done
console.log('' === 0);          // false
console.log(null === undefined); // false
```

TypeScript actively helps here: comparing values of genuinely incompatible types with `==`/`===` is a compile error in TS (e.g. comparing a `string` to a `number` variable), which catches a class of these bugs before runtime — see [advanced.md](./advanced.md) for where that protection stops.

## Surprising `==` Results

```ts
console.log('' == 0);        // true  — '' converts to number 0
console.log(' ' == 0);       // true  — ' ' trims to '' then converts to 0
console.log([] == false);    // true  — [] converts to '' (via toString), then to 0; false converts to 0
console.log([] == ![]);      // true  — ![] is false first, then same as above
console.log('0' == false);   // true  — '0' converts to number 0; false converts to 0
console.log(null == undefined); // true — special case, they only equal each other and themselves
console.log(null == 0);      // false — null does NOT coerce to 0 for ==
console.log(NaN == NaN);     // false — see below
```

These aren't random — each follows the abstract equality algorithm (see [advanced.md](./advanced.md)) — but the practical takeaway is: you should not need to hold that algorithm in your head to read everyday code, and `===` removes the need entirely.

## `NaN` and Why `NaN === NaN` Is False

`NaN` ("Not a Number") is the one value in JavaScript that is never equal to itself, by IEEE 754 floating-point specification (this isn't a JS quirk — it's the same in most languages that use this float standard).

```ts
console.log(NaN === NaN); // false
console.log(NaN == NaN);  // false — coercion doesn't help, this isn't a type issue

const result = Number('not a number'); // NaN
if (result === NaN) {
  // ❌ this branch NEVER runs — this is a real, common bug
}

// correct ways to check for NaN:
console.log(Number.isNaN(result)); // true — the reliable check
console.log(Object.is(result, NaN)); // true — also works
```

## `Object.is` vs `===`

`Object.is` behaves like `===` for almost everything, but differs in exactly two cases: `NaN` and the sign of zero.

```ts
console.log(Object.is(NaN, NaN));   // true  — unlike === and ==
console.log(NaN === NaN);           // false

console.log(Object.is(0, -0));      // false — treats +0 and -0 as different
console.log(0 === -0);              // true  — === treats them as the same
```

In everyday code, `===` is still what you reach for. `Object.is` matters in specific cases like implementing memoization/comparison utilities (React's internals use it for exactly this reason) where `NaN` or `-0` need to be told apart correctly.

## Truthy and Falsy Values

Every value in JS is either "truthy" or "falsy" when used in a boolean context (`if`, `&&`, `||`, `!value`, ternaries). There are **exactly eight** falsy values — everything else is truthy, including `"0"`, `"false"`, `[]`, and `{}`.

```ts
// the complete falsy list — memorize this, it's short and exhaustive
false
0
-0
0n        // BigInt zero
""        // empty string
null
undefined
NaN
```

```ts
if ([]) console.log('arrays are truthy, even empty ones'); // runs
if ({}) console.log('objects are truthy, even empty ones'); // runs
if ('0') console.log('the STRING "0" is truthy'); // runs — only the falsy list above counts
```

## The Real Bug: `if (value)` with Valid Falsy Data

This is the single most common real-world consequence of not knowing the falsy list precisely: treating `0` or `""` as "no value" when they are legitimate data.

```ts
// BROKEN
function applyDiscount(discountPercent: number) {
  if (discountPercent) {
    // apply discount
    console.log(`Applying ${discountPercent}% off`);
  } else {
    console.log('No discount'); // ❌ WRONG when discountPercent is legitimately 0
  }
}

applyDiscount(0); // intends "explicitly no discount configured, that's fine"
                   // but 0 is falsy, so it silently falls into the "no discount" branch
                   // — which might be correct here, but becomes a bug the moment
                   // "0" and "not provided" need to be treated differently

// BROKEN — same shape, with a string
function greetUser(name: string) {
  if (name) {
    console.log(`Hello, ${name}`);
  } else {
    console.log('Hello, stranger');
  }
}
greetUser(''); // '' is falsy, so an intentionally blank name is treated the same as "no name given"
```

```ts
// FIXED — explicitly check for the actual "missing" values instead of relying on truthiness
function applyDiscountFixed(discountPercent: number | null | undefined) {
  if (discountPercent !== null && discountPercent !== undefined) {
    console.log(`Applying ${discountPercent}% off`); // now 0 correctly goes down this path
  } else {
    console.log('No discount configured');
  }
}

applyDiscountFixed(0); // ✅ "Applying 0% off" — correctly distinguishes "0" from "not set"
```

## What Happens Without Understanding This

- Valid data (`0`, `""`, `false`) gets silently treated as "missing" or "empty," causing wrong branches to execute with no error or warning.
- `==` comparisons pass code review because they "look right" in the happy path, then fail on an edge case type nobody tested (comparing a number field to a string from a query parameter, for example).
- `NaN` checks using `=== NaN` silently never match, so error-handling code for invalid numeric input never triggers.

## Common Mistakes

- Using `==` out of habit, especially when comparing against `null`/`undefined` (`value == null` is actually a common *intentional* idiom — it matches both `null` and `undefined` in one check — but it should be a deliberate choice, not a default habit).
- Writing `if (value)` to mean "is this set" when `value` can legitimately be `0`, `""`, or `false`.
- Comparing against `NaN` with `===`/`==` instead of `Number.isNaN()`.
- Assuming `Object.is` is a drop-in upgrade for `===` everywhere — it isn't; its only two differences (`NaN`, `-0`) rarely matter outside of comparison utilities.

## Questions to Test Yourself

1. Why does `[] == false` evaluate to `true`, and why does `[] === false` evaluate to `false`?
2. Why is `if (value === NaN)` always false, no matter what `value` is, and what should you use instead?
3. List all eight falsy values from memory. Is `"0"` (the string) on that list?
4. Given `function setPage(page?: number) { if (page) {...} }`, what real bug appears if `page` can legitimately be `0`, and how would you fix the check?
