# Prototypes

Every object in JavaScript has methods you never wrote — `.toString()`, `.hasOwnProperty()`, `.valueOf()` — and every `class` you write in TypeScript is, under the hood, still working through this same mechanism. Understanding prototypes explains why inheritance in JS looks the way it does, why some property lookups are "free," and why certain bugs (accidentally shadowing a built-in method, or mutating a shared prototype) affect every instance of a type at once.

## Table of Contents

1. [What Is a Prototype Chain?](#what-is-a-prototype-chain)
2. [`Object.create`](#objectcreate)
3. [How Property/Method Lookup Walks the Chain](#how-propertymethod-lookup-walks-the-chain)
4. [Why Every Object Has `.toString()` for Free](#why-every-object-has-tostring-for-free)
5. [`class` Is Sugar Over Prototypes](#class-is-sugar-over-prototypes)
6. [`Object.getPrototypeOf`](#objectgetprototypeof)
7. [Own Properties vs Inherited Properties](#own-properties-vs-inherited-properties)
8. [What Happens Without Understanding This](#what-happens-without-understanding-this)
9. [Common Mistakes](#common-mistakes)
10. [Questions to Test Yourself](#questions-to-test-yourself)

---

## What Is a Prototype Chain?

Every object in JavaScript has an internal link to another object called its **prototype**. When you access a property that doesn't exist directly on the object, JavaScript looks it up on the prototype — and if it's not there either, on the prototype's prototype, and so on, until it hits `null`.

```ts
const animal = {
  makeSound() {
    return 'some generic sound';
  },
};

const dog = Object.create(animal); // dog's prototype is `animal`
dog.bark = () => 'Woof!';

console.log(dog.bark());       // "Woof!" — own property
console.log(dog.makeSound());   // "some generic sound" — found on the prototype, not on dog itself
console.log(dog.hasOwnProperty('makeSound')); // false — it's inherited, not dog's own
```

This chain of "look here, then look at my prototype, then its prototype..." is the **prototype chain**.

## `Object.create`

`Object.create(proto)` creates a brand-new object whose prototype is explicitly set to `proto`. This is the most direct, intentional way to set up prototypal inheritance without using `class` syntax at all.

```ts
const vehiclePrototype = {
  describe() {
    return `A ${this.type} with ${this.wheels} wheels`;
  },
};

const car = Object.create(vehiclePrototype);
car.type = 'car';
car.wheels = 4;

console.log(car.describe()); // "A car with 4 wheels"
// `describe` doesn't exist on `car` itself — it's found by walking up to vehiclePrototype
```

`Object.create(null)` creates an object with **no** prototype at all — useful for a "pure dictionary" object that shouldn't inherit anything, not even `.toString()`.

```ts
const dict = Object.create(null);
dict.key = 'value';
console.log(dict.toString); // undefined — no Object.prototype in the chain at all
```

## How Property/Method Lookup Walks the Chain

```ts
const base = { greeting: 'hello' };
const middle = Object.create(base);
const top = Object.create(middle);
top.extra = 'own value';

console.log(top.extra);    // "own value" — found directly on `top`
console.log(top.greeting); // "hello" — not on top, not on middle, found on `base`

// the chain, visualized:
// top → middle → base → Object.prototype → null
```

The lookup always starts at the object itself and stops at the **first** match found while walking up — it never continues past that to check for other properties with the same name further up the chain.

```ts
top.greeting = 'overridden'; // adds an OWN property directly on `top`
console.log(top.greeting);   // "overridden" — own property shadows the inherited one
console.log(base.greeting);  // "hello" — base is untouched
```

## Why Every Object Has `.toString()` for Free

Every plain object's prototype chain ends at `Object.prototype`, which defines common methods like `.toString()`, `.valueOf()`, and `.hasOwnProperty()`. That's why you can call `.toString()` on an object you just wrote `{}` for, without ever defining it yourself.

```ts
const obj = { a: 1 };
console.log(obj.toString()); // "[object Object]" — comes from Object.prototype, not obj itself

console.log(Object.getPrototypeOf(obj) === Object.prototype); // true
console.log(Object.getPrototypeOf(Object.prototype)); // null — the chain ends here
```

Arrays, functions, and other built-ins have their own prototypes (`Array.prototype`, `Function.prototype`) that sit *between* the object and `Object.prototype`, which is why arrays additionally get `.map()`, `.filter()`, etc.

```ts
const arr: number[] = [1, 2, 3];
// arr → Array.prototype (map, filter, push...) → Object.prototype (toString...) → null
console.log(arr.map((n) => n * 2)); // [2, 4, 6] — from Array.prototype
console.log(arr.toString());        // "1,2,3" — from Object.prototype (Array overrides it, actually)
```

## `class` Is Sugar Over Prototypes

Modern `class` syntax doesn't introduce a new inheritance model — it's a cleaner syntax on top of the exact same prototype mechanism. Methods you define in a class body are placed on the class's `.prototype` object, shared by every instance.

```ts
class Animal {
  constructor(public name: string) {}
  makeSound() {
    return `${this.name} makes a sound`;
  }
}

const a = new Animal('Generic');

console.log(a.hasOwnProperty('name'));       // true — set in the constructor, own property
console.log(a.hasOwnProperty('makeSound'));  // false — it lives on Animal.prototype, not on `a`
console.log(Object.getPrototypeOf(a) === Animal.prototype); // true

// EVERY instance shares the SAME makeSound function — it's not duplicated per instance
const b = new Animal('Other');
console.log(a.makeSound === b.makeSound); // true — same function reference on the shared prototype
```

This sharing is why methods are memory-efficient (one function per class, not per instance) while instance data (`this.name`) is separate per object.

## `Object.getPrototypeOf`

The standard, safe way to inspect an object's prototype at runtime (as opposed to the legacy `__proto__` accessor — see [advanced.md](./advanced.md)).

```ts
class Vehicle {}
class Car extends Vehicle {}

const car = new Car();

console.log(Object.getPrototypeOf(car) === Car.prototype);         // true
console.log(Object.getPrototypeOf(Car.prototype) === Vehicle.prototype); // true — inheritance chain
console.log(Object.getPrototypeOf(Vehicle.prototype) === Object.prototype); // true — ends here
```

## Own Properties vs Inherited Properties

`hasOwnProperty()` tells you whether a property lives directly on the object, or was found further up the prototype chain. This matters most when iterating over an object's keys.

```ts
const base = { inherited: 'from base' };
const obj = Object.create(base);
obj.own = 'set directly';

for (const key in obj) {
  console.log(key); // logs BOTH "own" AND "inherited" — for...in walks the whole chain
}

for (const key in obj) {
  if (Object.hasOwn(obj, key)) { // modern equivalent of obj.hasOwnProperty(key)
    console.log(key); // logs only "own"
  }
}

console.log(Object.keys(obj)); // ["own"] — Object.keys only returns OWN enumerable properties
```

`Object.keys()`, `Object.values()`, `Object.entries()`, and `JSON.stringify()` all only consider own properties — they don't walk the prototype chain — which is usually what you want.

## What Happens Without Understanding This

- Iterating an object with `for...in` unexpectedly picks up inherited properties, especially from older-style prototype-based libraries, and pollutes what should be "just my object's own data."
- Confusion about why two class instances' methods are `===` to each other but their data properties aren't.
- Mutating a shared prototype method thinking you're changing "this one instance" — every instance is affected, because they all point at the same prototype object.

## Common Mistakes

- Using `for...in` on an object when you actually want only its own properties — use `Object.keys()`/`Object.entries()` or guard with `Object.hasOwn()`.
- Assuming each class instance has its own copy of every method — methods live once on the shared prototype, not per instance.
- Confusing `obj.hasOwnProperty(key)` (works, but historically unsafe if `obj` itself defines a property literally named `hasOwnProperty`) with the safer modern `Object.hasOwn(obj, key)`.

## Questions to Test Yourself

1. If `dog = Object.create(animal)` and `animal` has a `makeSound` method, does `dog.hasOwnProperty('makeSound')` return true or false? Why?
2. Why do two instances of the same class have `a.method === b.method` be `true`, but `a.someDataField === b.someDataField` usually be `false`?
3. What's the difference between what `for...in` iterates over and what `Object.keys()` returns?
4. Where does the prototype chain of a plain `{}` object end, and what happens if you look up a property that isn't found anywhere in the chain?
