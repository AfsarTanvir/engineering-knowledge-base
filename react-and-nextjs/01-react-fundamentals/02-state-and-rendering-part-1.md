# State and Rendering — Part 1

On the server you build a response and send it. The work is finished. In a
browser the screen must keep changing for minutes or hours while the user
clicks, types and waits for your API. Something has to decide what the page
looks like *now*.

React's answer is one sentence, and it is the most important sentence in this
whole track: **the UI is a function of state.** You never reach into the page
and change it. You change a value, and React works out what the page should
look like for that value.

This part explains that model, the `useState` hook that holds the value, what a
re-render really is, and the single bug that catches every backend developer:
changing an object and seeing nothing happen. Part 2 covers derived state,
lifting state up, the updater form, and resetting state deliberately.

> **📌 In one line:** you do not update the DOM, you update state — and the bug
> you will hit first is that React compares state by reference, not by content.

## Table of Contents

1. [The Spreadsheet Cell](#the-spreadsheet-cell)
2. [UI Is a Function of State](#ui-is-a-function-of-state)
3. [useState: Declare, Read, Set](#usestate-declare-read-set)
4. [Why the Variable Still Holds the Old Value](#why-the-variable-still-holds-the-old-value)
5. [What a Re-render Actually Is](#what-a-re-render-actually-is)
6. [BROKEN vs FIXED: the Mutation That Changes Nothing](#broken-vs-fixed-the-mutation-that-changes-nothing)
7. [Updating Nested State Without a Library](#updating-nested-state-without-a-library)
8. [When the Nesting Is Too Deep, Restructure](#when-the-nesting-is-too-deep-restructure)
9. [Common Mistakes](#common-mistakes)
10. [Questions to Test Yourself](#questions-to-test-yourself)
11. [Related](#related)

---

## The Spreadsheet Cell

Open a spreadsheet. Cell `C1` contains `=A1*B1`. It currently shows `40`.

You want it to show `60`. You do not select `C1` and type `60`. You change `A1`
to `6`, and `C1` becomes `60` by itself. You changed an *input*; the sheet
recomputed the *output*.

Now imagine the opposite style. You type `60` directly into `C1`, destroying
the formula. Next time anyone changes `A1`, `C1` does not follow. The sheet is
now inconsistent, and nobody can tell by looking at it.

Direct DOM manipulation is typing into `C1`. React is the formula. Your
component is `=A1*B1`, your state is `A1`, and the screen is whatever the
formula produces.

> **💡 Tip:** whenever you feel the urge to "just change that one element",
> you are typing into `C1`. Ask instead: which state value, when changed, would
> make the formula produce the screen I want?

---

## UI Is a Function of State

Written as code, the whole model is:

```text
screen = component(state, props)
```

That is all. React's job is to call `component` again whenever `state` or
`props` change, and to make the real page match the result.

```mermaid
flowchart LR
    E[User clicks or data arrives] --> S[You call a state setter]
    S --> Q[React schedules a re-render]
    Q --> F[Your component function runs again]
    F --> D[It returns new element objects]
    D --> C[React compares them with the previous ones]
    C --> P[React patches only the DOM nodes that differ]
```

Compare the two styles on a concrete task: marking an invoice as paid.

```text
Imperative (what you would write with plain DOM)
  find the row element
  find the badge inside it
  change its text to "Paid"
  change its CSS class
  find the "Mark paid" button and disable it
  find the unpaid counter and decrease it
  ...and remember every one of these for every other place the invoice shows

Declarative (React)
  setInvoice({ ...invoice, status: 'paid' })
  ...the badge, the button and the counter all describe themselves from status
```

The imperative version has one step per *place on the screen*. The declarative
version has one step per *fact that changed*. Facts are far fewer than places,
and they do not grow when a designer adds a fourth place that shows the status.

> **📌 Remember:** state is the truth. The screen is a view of the truth. If
> those two ever disagree, you changed the screen instead of the truth.

---

## useState: Declare, Read, Set

`useState` is how a component remembers a value between renders.

```tsx
import { useState } from 'react'

function InvoiceFilters() {
  const [status, setStatus] = useState<InvoiceStatus>('all')
  const [search, setSearch] = useState('')

  return (
    <div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} />
      <button onClick={() => setStatus('overdue')}>Only overdue</button>
      <p>Showing {status} invoices matching "{search}"</p>
    </div>
  )
}
```

Three things to notice.

**It returns a pair.** `useState` returns an array of exactly two items, and
the array destructuring gives them names. The names are yours; `[status,
setStatus]` is only a convention. React does not read your variable names.

**The argument is the initial value**, used on the very first render of this
component instance and ignored on every render after. Writing
`useState(props.invoice.status)` does *not* keep the state in sync with the
prop later — a surprise worth remembering.

**TypeScript usually infers the type** from the initial value. `useState('')`
gives `string`. When the initial value does not describe the full type, say it
explicitly: `useState<Task[]>([])`, or `useState<Project | null>(null)`.

> **⚠️ Warning:** never write `const [x, setX] = useState<SomeType>()` and then
> treat `x` as always present. With no argument the type is `SomeType |
> undefined`, and that `undefined` will reach your render on the first paint.

---

## Why the Variable Still Holds the Old Value

This surprises everyone once:

```tsx
function TaskCounter() {
  const [count, setCount] = useState(0)

  function handleClick() {
    setCount(count + 1)
    console.log(count)      // logs 0, not 1 — every single time
  }

  return <button onClick={handleClick}>Done: {count}</button>
}
```

`count` is a `const` inside a function call. Nothing in JavaScript can change a
`const` after it is bound. `setCount` does not reach backwards into the
function that is currently running and rewrite its variable. It cannot.

What `setCount` actually does is tell React: *next time you render this
component, the value is 1*. React then calls your component function **again**,
and in that new call `count` is a different `const` bound to `1`.

So each render is a snapshot. Inside one render, every reference to `count`
means "the value as of this render". That is not a quirk — it is ordinary
closure behaviour, the same thing described in
[Closures](../../typescript-fundamentals/closures/closures.md). Each call of
the component creates a new scope, and the functions defined inside it capture
*that* scope.

```text
render 1:  count = 0   handleClick closes over the 0
  click -> setCount(0 + 1)
render 2:  count = 1   a NEW handleClick closes over the 1
  click -> setCount(1 + 1)
render 3:  count = 2   ...
```

Hold on to this picture. In Part 2 it explains why `setCount(c => c + 1)`
exists, and in [Hooks That Matter — Part
1](03-hooks-that-matter-part-1.md) it explains the single most common
`useEffect` bug.

---

## What a Re-render Actually Is

"Re-render" sounds expensive and frightening. It is neither of those things,
and the fear leads people to add optimisations they do not need.

A re-render is: **React calls your component function again.** That is the
whole definition.

| What happens on a re-render | What does NOT happen |
|---|---|
| Your component function body runs again | The page is not thrown away and rebuilt |
| Its JSX produces new plain objects | No DOM node is recreated unless it must be |
| Child components render too, by default | `useState` values are not reset |
| New handler functions are created | Scroll position, focus and text selection survive |
| `useMemo` / `useEffect` deps are compared | Module-level code does not run again |

After your function returns, React compares the new element objects with the
previous ones and produces a minimal list of DOM operations. If the only change
is one text node, exactly one text node is written.

What triggers a re-render? A short and complete list:

1. A state setter in this component was called **with a different value**.
2. This component's parent re-rendered, so it was called again.
3. A context value this component reads changed.

That is it. Not a mutated object. Not a changed variable outside React. Not a
new value in `localStorage`. Only those three.

> **💡 Tip:** when the screen does not update, you are almost always in case 1
> with "a different value" failing — which is the next section.

---

## BROKEN vs FIXED: the Mutation That Changes Nothing

This is the bug. Every backend developer writes it once.

```tsx
// ❌ BROKEN - the array is changed, but the reference is the same, so nothing renders
function TaskBoard({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<Task[]>([])

  function addTask(task: Task) {
    tasks.push(task)        // mutates the existing array
    setTasks(tasks)         // hands React the SAME reference it already had
  }
  // ...
}
```

The task really is added. `tasks.length` really does grow. Put a
`console.log(tasks)` after the push and you will see it. And the screen shows
nothing new.

React decides whether state changed by comparing the old value and the new
value with `Object.is`, which for objects and arrays means *is this the same
reference?* You pushed into the array and then handed back the identical
reference. React compares, sees the same reference, concludes nothing changed,
and skips the re-render.

This is precisely the material in
[Objects and References](../../typescript-fundamentals/objects-and-references/objects-and-references.md).
A variable holding an array does not hold the array; it holds a reference to
it. `push` changes what is at the end of that reference. It does not create a
new reference.

```tsx
// ✅ FIXED - build a new array; a new reference means React sees a change
function addTask(task: Task) {
  setTasks([...tasks, task])      // new array, same items plus one
}
```

The same rule applies to every mutating operation. The table maps each one to
its non-mutating replacement:

| Mutating (breaks React) | Non-mutating (works) |
|---|---|
| `tasks.push(task)` | `setTasks([...tasks, task])` |
| `tasks.unshift(task)` | `setTasks([task, ...tasks])` |
| `tasks.splice(i, 1)` | `setTasks(tasks.filter((t) => t.id !== id))` |
| `tasks[i].done = true` | `setTasks(tasks.map((t) => t.id === id ? { ...t, done: true } : t))` |
| `tasks.sort(byDueDate)` | `setTasks([...tasks].sort(byDueDate))` |
| `tasks.reverse()` | `setTasks([...tasks].reverse())` |
| `project.name = 'New'` | `setProject({ ...project, name: 'New' })` |
| `delete settings.theme` | `setSettings(({ theme, ...rest }) => rest)` |

`sort` and `reverse` deserve a second look. They are easy to miss because they
*return* the array as well as mutating it, so `setTasks(tasks.sort(fn))` looks
correct and is not. Copy first with `[...tasks]`.

> **⚠️ Warning:** React does not warn you about this. There is no error, no
> console message, no failed type check. The symptom is simply "I clicked and
> nothing happened". Train yourself to suspect a mutation immediately.

---

## Updating Nested State Without a Library

Real state is not always flat. Suppose a project holds notification settings:

```ts
interface ProjectSettings {
  name: string
  notifications: {
    email: { onInvoicePaid: boolean; onTaskAssigned: boolean }
    inApp: { onInvoicePaid: boolean; onTaskAssigned: boolean }
  }
}
```

To change one leaf you must create a new object at **every level from the root
down to the thing you changed**. Levels you did not touch keep their old
references, which is good — React will skip them.

```tsx
// ❌ BROKEN - only the leaf changed; the root reference is untouched
function toggleEmailOnPaid() {
  settings.notifications.email.onInvoicePaid = !settings.notifications.email.onInvoicePaid
  setSettings(settings)
}

// ✅ FIXED - a new object at each level on the path to the change
function toggleEmailOnPaid() {
  setSettings({
    ...settings,
    notifications: {
      ...settings.notifications,
      email: {
        ...settings.notifications.email,
        onInvoicePaid: !settings.notifications.email.onInvoicePaid,
      },
    },
  })
}
```

Read the fixed version as a path: root, then `notifications`, then `email`,
then the field. One spread per step. The `inApp` branch is not copied at all —
the new `notifications` object points at the same `inApp` object as before, and
that is correct and cheap.

This "copy along the path" pattern is the same idea you use for immutable
updates in plain TypeScript; the spread syntax is covered in
[Objects and References](../../typescript-fundamentals/objects-and-references/objects-and-references.md).

---

## When the Nesting Is Too Deep, Restructure

Three spreads is already uncomfortable. Four is a sign that the *state shape*
is wrong, not that you need a cleverer update helper.

Two practical cures, in order:

**1. Flatten and store by id.** Instead of tasks nested inside projects nested
inside a workspace object, keep a lookup table.

```ts
// ❌ BROKEN as state - updating one task means copying three levels
interface WorkspaceState {
  projects: Array<{ id: string; name: string; tasks: Task[] }>
}

// ✅ FIXED as state - one level to update, and no duplicated task objects
interface WorkspaceState {
  projectIds: string[]
  projectsById: Record<string, Project>
  taskIdsByProject: Record<string, string[]>
  tasksById: Record<string, Task>
}

setTasksById({ ...tasksById, [taskId]: { ...tasksById[taskId], done: true } })
```

This is the same normalisation instinct you already have from database design:
store each fact once, and point at it by id. A task appearing in two places on
screen now cannot disagree with itself.

**2. Split one big `useState` into several.** State that changes for unrelated
reasons should not live in one object. `useState` for the filter, `useState`
for the selected row, `useState` for the draft — three small pieces beat one
nested blob, and each update is a one-liner.

When the nesting is genuinely unavoidable — a deeply structured document editor,
for example — a library like Immer lets you write mutating-looking code that
produces a new object underneath. Reach for it then, not before. Everything in
a normal CRUD screen fits in the two cures above.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| `tasks.push(t); setTasks(tasks)` | Same reference, so React skips the render | `setTasks([...tasks, t])` |
| `setTasks(tasks.sort(fn))` | `sort` mutates in place and returns the same array | `setTasks([...tasks].sort(fn))` |
| Reading state right after setting it | The variable is a `const` from this render | Use the value you just computed |
| Mutating one leaf of nested state | The root reference never changes | Copy along the whole path |
| `useState(props.invoice.status)` expecting it to follow the prop | The argument is only used on first render | Derive from the prop, or reset with a `key` |
| `useState<Project>()` with no argument | The type is really `Project \| undefined` | Pass an initial value or handle `undefined` |
| Touching the DOM directly to "fix" the screen | State and screen now disagree | Change the state the screen is built from |
| Four levels of spread in one setter | The state shape is wrong | Flatten by id, or split the state |

---

## Questions to Test Yourself

1. Explain "UI is a function of state" to a backend colleague in two sentences,
   without using the word React.
2. `setCount(count + 1)` then `console.log(count)` logs the old value. Why is
   that not a bug, and what *is* `count` in that moment?
3. List the three things that cause a component to re-render. What is
   deliberately not on the list?
4. A re-render happened. Name three things that did *not* happen as a result.
5. `tasks.push(newTask); setTasks(tasks)` adds the task to the array but shows
   nothing. Explain the mechanism in terms of references and `Object.is`.
6. Why is `setTasks(tasks.sort(byDueDate))` broken in exactly the same way,
   even though it looks like it returns a new array?
7. You must flip `settings.notifications.email.onInvoicePaid`. How many new
   objects does a correct update create, and which existing objects are reused?
8. Your state needs four levels of spread to update. What are the two
   restructuring options, and which database idea do they resemble?

---

> **➡️ Continued in [Part 2](./02-state-and-rendering-part-2.md)** — derived
> state, lifting state up, the updater form and stale closures, batching, and
> resetting a component with `key`.

## Related

- [State and Rendering — Part 2](02-state-and-rendering-part-2.md) — derived
  state, lifting state, the updater form, batching.
- [Objects and References](../../typescript-fundamentals/objects-and-references/objects-and-references.md)
  — the reference-identity rule behind the mutation bug.
- [Closures](../../typescript-fundamentals/closures/closures.md) — why each
  render captures its own `count`.
- [Components and Props — Part 1](01-components-and-props-part-1.md) — the
  function-and-props model this builds on.
