# React & Next.js — Enough, Not Mastery

The roadmap is deliberate about this one:

> **React/Next.js — enough, not mastery.** Just enough to be dangerous:
> component, props, state, hooks, forms, API calls, server/client concepts,
> routing, SSR vs CSR, data fetching, auth flow. Go deeper later.

You are a backend engineer. You are not trying to become a frontend specialist,
and this track will not try to make you one. The goal is narrower and more
useful: **be able to work confidently on the frontend half of your own
features** — wire a form to your API, understand why a page re-rendered, read a
colleague's component without guessing, and know which problems belong on which
side of the wire.

> **📌 The whole track in one line:** React is a function from state to UI, and
> Next.js decides where that function runs — once those two sentences mean
> something concrete, the rest is detail you can look up.

## Roadmap

| # | Folder | What it answers |
|---|---|---|
| 1 | [react-fundamentals/](01-react-fundamentals/) | Components, state, hooks, forms, and calling your API |
| 2 | [nextjs-essentials/](02-nextjs-essentials/) | Routing, server vs client, rendering strategies, data fetching |
| 3 | [connecting-the-stack/](03-connecting-the-stack/) | Auth end to end, loading and error states, what belongs where |

## Written for someone who already knows the backend

This track leans on what you already have rather than starting from zero:

- You know HTTP, status codes, cookies and CORS — so the frontend's side of
  those is framed as "the other end of what you built" and links back to
  [backend-fundamentals/](../backend-fundamentals/) instead of re-explaining.
- You know sessions and JWTs — so the auth folder is about where the token
  lives in a browser and why, not what a token is.
- You know JavaScript properly — closures, references, `async`/`await` — so
  hooks are explained in those terms, linking
  [typescript-fundamentals/](../typescript-fundamentals/). The classic React
  bugs (stale closures, a mutated state object that does not re-render) are
  closure and reference bugs you have already studied.

## Status

- [x] 01 — React fundamentals — 10 files
- [x] 02 — Next.js essentials — 8 files
- [x] 03 — Connecting the stack — 4 files

## What this track deliberately skips

Named so you know they exist and that skipping them is a choice, not an
oversight: CSS and styling systems, animation, component libraries, state
managers (Redux, Zustand, Jotai), React Native, build tooling internals,
accessibility in depth, and performance profiling. Each is a real discipline.
None of them is what "enough to be dangerous" means for you this year.

## What you should be able to do after this track

- Read a React component and say what causes it to re-render.
- Build a form that submits to your API, shows a loading state, and displays
  field errors returned by your validation layer.
- Explain the difference between a server component and a client component, and
  why putting `useState` in the wrong one is an error.
- Choose between rendering on the server and in the browser, and say what each
  costs.
- Follow a login from the form, through your API, to the cookie, to the next
  request.
- Decide whether a given piece of logic belongs in your frontend or your backend.
