# Equality and Coercion — Advanced

The base file covers *when* `==` surprises you and tells you to default to `===`. This file covers *why* those surprises happen — the actual algorithm behind `==` — plus the `+` operator's own coercion rules, the precise differences between `Object.is` and `===`, safe defensive-check patterns, and where TypeScript's type system does (and doesn't) protect you from these bugs. See [equality-and-coercion.md](./equality-and-coercion.md) for the basics this builds on.

## Table of Contents

1. [The Abstract Equality Algorithm](#the-abstract-equality-algorithm)
2. [`+` Operator Coercion Quirks](#-operator-coercion-quirks)
3. [`Object.is` vs `===`: The Edge Cases](#objectis-vs--the-edge-cases)
4. [Safe Defensive Patterns: `??` vs `||`](#safe-defensive-patterns--vs-)
5. [Where TypeScript Catches Coercion Bugs — and Where It Doesn't](#where-typescript-catches-coercion-bugs--and-where-it-doesnt)
6. [Why It Matters](#why-it-matters)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)

---

## The Abstract Equality Algorithm

`==` follows a specific, spec-defined algorithm (ECMA-262 "IsLooselyEqual"). Simplified to the cases you'll actually encounter:

```text
1. If both operands are the same type       → same as ===
2. null == undefined                        → true (and ONLY equal to each other/themselves)
3. number == string                         → convert string to number, then compare
4. boolean == anything                      → convert the boolean to a number first, then re-check
5. number/string == object (array/object)   → convert the object to a primitive first (via toString/valueOf), then re-check
6. NaN == anything (including NaN)          → always false
```

Walking through the base file's examples with this algorithm:

```ts
console.log('' == 0);
// rule 3: string vs number → convert '' to a number → Number('') is 0 → 0 == 0 → true

console.log([] == false);
// rule 4: boolean vs anything → convert false to Number(false) = 0 → now [] == 0
// rule 5: object vs number → convert [] to a primitive → [].toString() = '' → Number('') = 0
// → 0 == 0 → true

console.log([] == '');
// rule 5: object vs string → [].toString() = '' → '' == '' → true

console.log(null == 0);
// rule 2 only covers null == undefined — null is NOT converted to a number for any other comparison
// → false, by a dedicated spec rule that excludes null/undefined from numeric conversion entirely
```

Each step is individually reasonable; the problem is that stacking several of these rules together produces results that don't match intuition unless you trace the whole chain, which almost nobody does in a code review.

## `+` Operator Coercion Quirks

`+` is overloaded: it means numeric addition **or** string concatenation, decided by the operands' types at runtime. If *either* operand is a string, JS converts the other to a string and concatenates instead of adding.

```ts
console.log(1 + 1);       // 2      — both numbers, adds
console.log('1' + 1);     // '11'   — one is a string, concatenates
console.log(1 + '1');     // '11'   — order doesn't matter, still concatenates
console.log(1 + 2 + '3'); // '33'   — left to right: 1+2=3 (number), then 3 + '3' = '33' (string)
console.log('1' + 2 + 3); // '123'  — left to right: '1'+2='12' (string), then '12'+3='123'
```

Arrays and plain objects get converted to primitives first (via their `toString`/`valueOf`), with famously odd results:

```ts
console.log([] + []);   // ''            — both arrays stringify to '', concatenated
console.log([] + {});   // '[object Object]' — [] → '', {} → '[object Object]', concatenated
console.log({} + []);   // '[object Object]' in an expression context (in some parsing contexts,
                         // leading {} is parsed as a block statement, not an object literal —
                         // a well-known parser ambiguity, avoid this shape entirely in real code)
console.log(+[]);       // 0             — unary + coerces [] to a number: '' → 0
console.log(+['5']);    // 5             — ['5'].toString() = '5' → Number('5') = 5
console.log(+['5','6']);// NaN           — ['5','6'].toString() = '5,6' → Number('5,6') = NaN
```

The practical rule: never rely on `+` to "just work" across mixed types. Convert explicitly (`Number(x)`, `String(x)`, `` `${x}` ``) so the operation's intent is visible in the code instead of hidden in coercion rules.

## `Object.is` vs `===`: The Edge Cases

`Object.is` and `===` agree on every value except two specific cases.

```ts
// case 1: NaN
console.log(NaN === NaN);          // false
console.log(Object.is(NaN, NaN));  // true

// case 2: signed zero
console.log(0 === -0);             // true  — === treats them as equal
console.log(Object.is(0, -0));     // false — Object.is distinguishes them
console.log(1 / 0);                // Infinity
console.log(1 / -0);               // -Infinity — proof that -0 is a distinct internal value from 0
```

This matters in code that needs to detect "did this value actually change" with full precision (e.g., a memoization/diffing layer): `===` would say `0` and `-0` are unchanged, which is usually fine, but occasionally wrong if downstream math cares about the sign of zero (e.g. `1 / result` differing between `0` and `-0`).

## Safe Defensive Patterns: `??` vs `||`

`||` returns its right side whenever the left side is **falsy** — which includes `0`, `""`, and `false`, not just `null`/`undefined`. `??` (nullish coalescing) only falls through for `null` or `undefined`, leaving other falsy values alone.

```ts
function getPageSize(configured?: number) {
  return configured || 20; // ❌ BROKEN: if configured is explicitly 0 ("show nothing per page"
                            // as a deliberate setting), this silently replaces it with 20
}

function getPageSizeFixed(configured?: number) {
  return configured ?? 20; // ✅ only falls back for null/undefined, 0 is respected
}

console.log(getPageSize(0));       // 20 — wrong, 0 was a valid explicit value
console.log(getPageSizeFixed(0));  // 0  — correct
console.log(getPageSizeFixed(undefined)); // 20 — correct, nothing was configured
```

Rule of thumb: use `??` for "give me a default only if this is truly absent," and reserve `||` for cases where you genuinely want *every* falsy value (including `0`/`""`) treated as "use the fallback."

## Where TypeScript Catches Coercion Bugs — and Where It Doesn't

TypeScript flags comparisons between operand types that can never overlap, at compile time:

```ts
const status: 'active' | 'inactive' = 'active';
if (status === 'archived') { // ❌ TS error: this comparison appears to be unintentional
  // because 'archived' is not a possible value of `status`'s type
}

const count: number = 5;
// if (count === '5') {} // ❌ TS error: this comparison appears to be unintentional
// because types 'number' and 'string' have no overlap
```

This is real, valuable protection — but it only exists as long as TypeScript knows both operands' precise types. It disappears the moment `any`/`unknown` (or an untyped external boundary, like `JSON.parse`, a form input, or a third-party API response) is involved, because TS can't narrow what it doesn't know.

```ts
function handleWebhookPayload(payload: any) {
  if (payload.amount == '0') { // ✅ compiles fine — `any` disables all of TS's equality checking
    // silently coerces whatever payload.amount actually is (number 0? string '0'? something else?)
  }
}

const parsed: unknown = JSON.parse('{"count": 0}');
// (parsed as any).count == false // would also compile — same escape hatch
```

TypeScript's static checks are a compile-time guarantee about types it can see — they say nothing about runtime coercion once a value has been widened to `any`/`unknown`, or once it crosses a genuinely untyped boundary (external API responses, `JSON.parse`, form fields). At those boundaries, the discipline of using `===`/`??` and validating shapes at runtime (see [unknown-any/advanced.md](../unknown-any/advanced.md) on runtime validation) is what actually protects you — not the type system alone.

## Why It Matters

Coercion bugs are uniquely dangerous because they rarely throw — they silently produce a *plausible-looking* wrong value, which slips through code review and often through tests that only check the happy path. Knowing the actual algorithm (not just "avoid `==`") lets you correctly reason about legacy code that already uses it, and knowing exactly where TS's protection ends tells you where to add runtime checks instead of trusting the compiler.

## Common Mistakes

- Assuming TypeScript's equality-comparison errors protect all runtime coercion — they stop once `any`/`unknown` enters the picture.
- Using `||` for defaulting numeric config values that can legitimately be `0`.
- Relying on `+` for concatenation across mixed types without explicit conversion, especially with arrays/objects.
- Treating `Object.is` as a universal upgrade to `===` — it only differs in the `NaN`/`-0` cases and is not the right default for everyday comparisons.

## Questions to Test Yourself

1. Walk through the abstract equality algorithm to explain why `[] == false` is `true`.
2. Why does `'1' + 1 + 1` produce `'111'` but `1 + 1 + '1'` produces `'21'`?
3. What are the exact two cases where `Object.is` and `===` disagree?
4. Why does `if (payload.amount == '0')` compile without error when `payload` is typed `any`, but the equivalent comparison on a known `number` type would be a compile error?
