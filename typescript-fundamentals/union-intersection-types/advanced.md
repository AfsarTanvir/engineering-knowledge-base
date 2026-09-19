# Union and Intersection Types — Advanced

The base file covers discriminated unions and composing shapes with `&`. At scale — a Redux-style action system, a state machine, an event bus with dozens of message types — the interesting questions become: how do conditional types behave when applied to a whole union at once, how do you *guarantee* every branch was handled (not just hope you remembered), and how do you structure a large discriminated union so it stays maintainable as it grows to 30+ variants.

See [union-intersection-types.md](./union-intersection-types.md) for the basics — unions, literal unions, intersections, and discriminated unions.

## Table of Contents

1. [Distributive Conditional Types Over Unions](#distributive-conditional-types-over-unions)
2. [Exhaustiveness Checking with `never` — In Depth](#exhaustiveness-checking-with-never--in-depth)
3. [Discriminated Unions as State Machines](#discriminated-unions-as-state-machines)
4. [Redux-Style Action Unions at Scale](#redux-style-action-unions-at-scale)
5. [Deriving Types from a Union Instead of Duplicating](#deriving-types-from-a-union-instead-of-duplicating)
6. [Why It Matters](#why-it-matters)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)

---

## Distributive Conditional Types Over Unions

When a conditional type's checked value is a bare type parameter, TypeScript applies the condition to **each member of a union separately** and unions the results back together — it doesn't treat the union as one opaque blob.

```ts
type NonNullableCustom<T> = T extends null | undefined ? never : T;

type Result = NonNullableCustom<string | null | number | undefined>;
// distributes over each member:
//   string extends null|undefined ? never : string   → string
//   null   extends null|undefined ? never : null      → never
//   number extends null|undefined ? never : number    → number
//   undefined extends null|undefined ? never : undefined → never
// unioned back together, `never` members vanish:
// Result = string | number
```

This is exactly how the built-in `NonNullable<T>` works, and it's why filtering `never` out of a union is "free" — a union containing `never` as one of its members simplifies to the union without that member, since nothing can ever actually be a `never`.

```ts
type ActionType<A> = A extends { type: infer T } ? T : never;

interface Login { type: "login"; username: string; }
interface Logout { type: "logout"; }
type Action = Login | Logout;

type Types = ActionType<Action>; // "login" | "logout" — distributed across both variants
```

You can suppress distribution deliberately by wrapping both sides in a tuple (`[T] extends [U]`), which forces TypeScript to treat the union as a single value rather than iterating its members — useful when you specifically want to ask "is this whole union assignable to X," not "check each member individually."

## Exhaustiveness Checking with `never` — In Depth

The base file introduced this pattern briefly; the mechanism deserves a closer look because it's the single most valuable compile-time safety net for a growing union.

```ts
interface CreateAction { type: "create"; payload: { name: string } }
interface UpdateAction { type: "update"; payload: { id: string; changes: object } }
interface DeleteAction { type: "delete"; payload: { id: string } }
type Action = CreateAction | UpdateAction | DeleteAction;

function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}

function reduce(state: unknown, action: Action) {
  switch (action.type) {
    case "create":
      return { ...state, /* ... */ };
    case "update":
      return { ...state, /* ... */ };
    case "delete":
      return { ...state, /* ... */ };
    default:
      return assertNever(action); // if every case is handled, `action` here IS `never`
  }
}
```

The value of `assertNever` as a *named, reusable* helper (rather than an inline `const _exhaustive: never = x`) is that it also throws a genuinely useful runtime error if this code path is somehow reached despite the compile-time guarantee (e.g. bad data crossing a serialization boundary) — belt and suspenders.

```ts
// six months later, someone adds a new action variant:
interface ArchiveAction { type: "archive"; payload: { id: string } }
type Action2 = CreateAction | UpdateAction | DeleteAction | ArchiveAction;

// reduce() above, if not updated, now fails to compile:
// default: return assertNever(action);
// ❌ Argument of type 'ArchiveAction' is not assignable to parameter of type 'never'
// — the compiler itself tells you exactly which reducer forgot the new case
```

This is the difference between a runtime bug discovered by a user report ("archiving does nothing") and a compile error discovered in your editor before the code ships.

## Discriminated Unions as State Machines

A state machine is really just a discriminated union of "states," each carrying only the data valid for that state, plus a function that maps (state, event) → next state. This makes invalid states genuinely unrepresentable, not just avoided by convention.

```ts
type FetchState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: string };

function render<T>(state: FetchState<T>): string {
  switch (state.status) {
    case "idle":
      return "Not started";
    case "loading":
      return "Loading...";
    case "success":
      return `Got: ${JSON.stringify(state.data)}`; // .data ONLY exists here
    case "error":
      return `Failed: ${state.error}`; // .error ONLY exists here
  }
}
```

Compare this to the common but weaker alternative — one flat object with everything optional — which allows nonsensical states like `{ status: "loading", data: {...}, error: "x" }` that the type system does nothing to prevent:

```ts
// WEAK — allows illegal combinations, e.g. loading AND having stale error/data at once
interface FetchStateFlat<T> {
  status: "idle" | "loading" | "success" | "error";
  data?: T;
  error?: string;
}
```

Transitions themselves can also be typed, so an invalid transition (e.g. "loading" directly to "idle" without going through "success"/"error") is a compile error rather than a runtime inconsistency:

```ts
function transition<T>(state: FetchState<T>, event:
  | { type: "FETCH" }
  | { type: "RESOLVE"; data: T }
  | { type: "REJECT"; error: string }
): FetchState<T> {
  switch (event.type) {
    case "FETCH":
      return { status: "loading" };
    case "RESOLVE":
      return { status: "success", data: event.data };
    case "REJECT":
      return { status: "error", error: event.error };
  }
}
```

## Redux-Style Action Unions at Scale

Real applications end up with dozens of action types. The pattern that keeps this maintainable is deriving the union automatically from a map of action creators, instead of hand-writing (and manually keeping in sync) a giant union of interfaces.

```ts
// action creators, the source of truth
const actionCreators = {
  login: (username: string) => ({ type: "login" as const, username }),
  logout: () => ({ type: "logout" as const }),
  updateProfile: (id: string, changes: Partial<{ name: string; bio: string }>) =>
    ({ type: "updateProfile" as const, id, changes }),
};

// derive the action union directly from the creators — never hand-write it, never drifts
type ActionCreatorsMap = typeof actionCreators;
type AppAction = ReturnType<ActionCreatorsMap[keyof ActionCreatorsMap]>;
// AppAction = { type: "login"; username: string }
//           | { type: "logout" }
//           | { type: "updateProfile"; id: string; changes: Partial<{...}> }

function reducer(state: unknown, action: AppAction) {
  switch (action.type) {
    case "login":
      return { ...state, user: action.username };
    case "logout":
      return { ...state, user: null };
    case "updateProfile":
      return { ...state /* apply action.changes */ };
  }
}
```

Adding a new action means adding one entry to `actionCreators` — `AppAction` and every exhaustiveness check downstream automatically pick it up, and any reducer that forgot to handle it fails to compile.

## Deriving Types from a Union Instead of Duplicating

A frequent senior-level skill: extracting a subset of a large union's variants by their discriminant, without manually re-listing their fields.

```ts
type Extract2<T, U> = T extends U ? T : never; // this is exactly how built-in Extract<T,U> works

type WriteActions = Extract2<AppAction, { type: "login" | "updateProfile" }>;
// { type: "login"; username: string } | { type: "updateProfile"; id: string; changes: ... }
// "logout" is excluded — it didn't match the filter
```

```ts
// pull just the discriminant values out of a union, as a literal union of strings
type ActionTypeNames = AppAction["type"]; // "login" | "logout" | "updateProfile"
```

This lets downstream code (analytics tagging, permission checks, a UI switch that only cares about a subset of actions) stay derived from the single source of truth instead of re-declaring overlapping unions that can silently drift out of sync.

## Why It Matters

- Exhaustiveness checking is the single highest-leverage TypeScript pattern for any codebase where a union of variants (actions, events, states) grows over time — it turns "someone forgot to update a handler" from a production incident into a build failure.
- Modeling application state as a discriminated union instead of a flat optional-everything object eliminates entire categories of "how did we end up in this impossible state" bugs.
- Deriving action unions from action creators (rather than hand-maintaining a parallel union) keeps large Redux/reducer-style codebases from drifting.

## Common Mistakes

- Adding a new variant to a large discriminated union and not running the compiler before assuming all reducers/handlers were updated — the whole point of exhaustiveness checks is to let the compiler catch this instead of a human remembering to.
- Hand-writing an action union in parallel with action creator functions, so the two definitions silently diverge over time.
- Using a flat "everything optional" object for a state machine instead of a proper discriminated union, permitting impossible combinations of fields.
- Forgetting that distributive conditional types only distribute over a *bare* type parameter — wrapping it in something (`[T]`) or using a non-generic condition changes the behavior entirely.

## Questions to Test Yourself

1. Walk through why `NonNullableCustom<string | null | number>` ends up as `string | number` instead of `never` — what happens to the `null` branch specifically?
2. Why does adding a `throw new Error(...)` inside `assertNever` matter even though the compiler is supposed to prevent that branch from ever executing?
3. What specific bug does modeling `FetchState<T>` as a discriminated union prevent that a flat `{ status; data?; error? }` object does not?
4. How would you derive an `AppAction` union automatically from a map of action-creator functions instead of writing it by hand?
5. Why is `Extract2<AppAction, { type: "login" | "updateProfile" }>` able to filter a large union down to just two variants without re-declaring their fields?
