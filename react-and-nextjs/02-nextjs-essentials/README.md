# Next.js Essentials

You open the frontend repository for the first time. There is no router file
and no obvious entry point. There are folders named `[id]`, files named
`page.tsx`, `layout.tsx` and `route.ts`, and one short line at the top of some
files that says `'use client'`. Nothing tells you where a request enters, or
which of these files runs on a server and which runs in somebody's browser.

That last question is what this folder is built around. You have spent this
whole repository learning to reason precisely about **which machine code runs
on** — what it can read, which secrets it may hold, how it fails. Next.js blurs
that line on purpose: both sides, same language, same folder, sometimes the
same file. Getting your bearings back is most of the work of learning it.

> **📌 The whole part in one line:** in Next.js the first question about any
> file is "which machine runs this?", and routing, rendering, secrets, data
> fetching and failure are all consequences of that one answer.

Everything here assumes the **App Router** — the folder-based model that is the
current default in Next.js. Where the older **Pages Router** differs in a way
that matters for reading an existing codebase, there is a one-line note. This
framework changes fast, so no version numbers are claimed anywhere; check your
version's documentation for exact flags and defaults.

## Files

1. [01-routing-and-project-structure-part-1.md](01-routing-and-project-structure-part-1.md)
   — what a framework adds on top of React, folders as URLs, dynamic segments,
   catch-all routes, route groups, and the special files.
2. [01-routing-and-project-structure-part-2.md](01-routing-and-project-structure-part-2.md)
   — layouts and nesting, `<Link>` versus `<a>`, route-level loading and error
   boundaries, a folder layout that survives growth, and middleware.
3. [02-server-and-client-components-part-1.md](02-server-and-client-components-part-1.md)
   — server by default, what `'use client'` really does, the capability table,
   the error messages you will hit, and the secret-leak risk.
4. [02-server-and-client-components-part-2.md](02-server-and-client-components-part-2.md)
   — composition patterns, serialization across the boundary, whether a server
   component should touch your database, and measuring the client bundle.
5. [03-rendering-strategies-part-1.md](03-rendering-strategies-part-1.md)
   — static, server-rendered, incrementally regenerated and client-rendered,
   a decision table for real pages, and hydration.
6. [03-rendering-strategies-part-2.md](03-rendering-strategies-part-2.md)
   — streaming and Suspense, the caching layers that surprise everyone,
   revalidation, SEO in short, and the cost of rendering per request.
7. [04-data-fetching-and-mutations-part-1.md](04-data-fetching-and-mutations-part-1.md)
   — `async` components, forwarding cookies to your AdonisJS API, request
   waterfalls, and route-level loading and error handling.
8. [04-data-fetching-and-mutations-part-2.md](04-data-fetching-and-mutations-part-2.md)
   — server actions and why they are public endpoints, when to call your own
   API instead, revalidating after a write, and optimistic updates.

## Read in this order

Straight through, 01 to 04, parts in order. File 02 is the spine — read both
parts. Files 03 and 04 assume you can place a component on a machine already.

## What you should be able to do after this part

- Look at any file and say which machine runs it, and what that means for
  secrets, database access and failure.
- Map a URL to the folder that serves it, and a folder to the URL it produces.
- Explain why `useState` in a server component is an error, and fix it without
  marking the whole page `'use client'`.
- Choose a rendering strategy for a page and say what it costs and what it
  forbids.
- Fetch in a server component, forward the user's session to your API, and
  avoid creating a waterfall.
- Decide between a server action and your existing AdonisJS endpoint, and
  defend the choice.

## Where this connects

- [01-react-fundamentals/](../01-react-fundamentals/) — everything here assumes
  components, props, state and the four states of a request.
- [backend-fundamentals/09-application-architecture/](../../backend-fundamentals/09-application-architecture/)
  — the layering ideas you already apply on the server, applied to a frontend.
- [backend-fundamentals/11-api-security/05-secrets-and-configuration-part-1.md](../../backend-fundamentals/11-api-security/05-secrets-and-configuration-part-1.md)
  — the rules that decide which variables may cross into a browser bundle.
- [caching-and-background-jobs/01-caching-in-practice/](../../caching-and-background-jobs/01-caching-in-practice/)
  — Next.js caching is a problem you already solved once, with Redis.
