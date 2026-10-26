# React Fundamentals

A ticket lands on you: *"Add a due date filter to the project task list, and
make the create-task dialog show the validation errors from the API."* The
backend half is an hour of work you could do in your sleep. The frontend half
is where you start guessing — why did that component re-render, why did the
list go blank, why is the error a grey box instead of red text under the field.

This folder removes the guessing. Five topics, each split into two parts, and
each one framed in terms of things you already understand: closures, object
references, promises, and the HTTP API you built yourself.

> **📌 The whole part in one line:** a component is a function from state to a
> description of UI, so every React bug is either "my state did not change
> identity", "my closure captured an old value", or "I forgot one of the four
> states a request can be in".

## Files

1. [01-components-and-props-part-1.md](01-components-and-props-part-1.md) — a
   component is a function, JSX is a function call, and props are its argument.
2. [01-components-and-props-part-2.md](01-components-and-props-part-2.md) —
   conditional rendering, lists, the `key` prop and the bug a wrong key causes.
3. [02-state-and-rendering-part-1.md](02-state-and-rendering-part-1.md) — UI is
   a function of state, what a re-render really is, and the mutation that
   changes nothing.
4. [02-state-and-rendering-part-2.md](02-state-and-rendering-part-2.md) —
   derived state, lifting state up, the updater form, batching and `key` resets.
5. [03-hooks-that-matter-part-1.md](03-hooks-that-matter-part-1.md) — the rules
   of hooks, `useEffect` done properly, stale closures and cleanup.
6. [03-hooks-that-matter-part-2.md](03-hooks-that-matter-part-2.md) — `useRef`,
   `useMemo`, `useCallback`, custom hooks, `useReducer` and `useContext`.
7. [04-forms-and-user-input-part-1.md](04-forms-and-user-input-part-1.md) —
   controlled inputs, a real create-project form, and the double-submit bug.
8. [04-forms-and-user-input-part-2.md](04-forms-and-user-input-part-2.md) —
   showing the field errors your API returns, shared schemas, uploads,
   optimistic updates.
9. [05-talking-to-your-api-part-1.md](05-talking-to-your-api-part-1.md) —
   `fetch` does not reject on a 404, the four states of a request, and the race
   condition.
10. [05-talking-to-your-api-part-2.md](05-talking-to-your-api-part-2.md) —
    writes and invalidation, CORS from the browser, credentials, and why a
    bundle holds no secrets.

## Read in this order

Straight through, 01 to 05, parts in order — each file assumes the one before
it. One exception: [05 part 2](05-talking-to-your-api-part-2.md) stands alone
if you only need its CORS or environment-variable sections today.

## What you should be able to do after this part

- Read a component and say exactly what causes it to re-render, and what a
  re-render does and does not touch.
- Diagnose "I changed the data and nothing happened" in seconds, by reference
  identity rather than by trial and error.
- Write a `useEffect` whose dependency array is honest, with cleanup, and know
  when not to write one at all.
- Build a form that disables its button while submitting and puts each server
  validation error under the right field.
- Handle all four outcomes of a request — loading, success, empty, error — and
  explain why hand-rolled `useEffect` fetching races.
- Say with confidence which values may ship in a frontend bundle and which must
  never leave your server.

## Where this connects

- [typescript-fundamentals/closures](../../typescript-fundamentals/closures/closures.md)
  and [objects-and-references](../../typescript-fundamentals/objects-and-references/objects-and-references.md)
  — the two classic React bugs are these two topics wearing a React costume.
- [backend-fundamentals/01-http-foundations](../../backend-fundamentals/01-http-foundations/)
  — the other end of every `fetch` in this folder.
- [backend-fundamentals/02-rest-api-design/05-error-response-design.md](../../backend-fundamentals/02-rest-api-design/05-error-response-design.md)
  — the error shape the forms file renders field by field.
- [02-nextjs-essentials/](../02-nextjs-essentials/) — next: where this code
  runs, routing, and rendering strategies.
- [03-connecting-the-stack/](../03-connecting-the-stack/) — after that: the
  full auth flow and deciding what belongs on which side.
