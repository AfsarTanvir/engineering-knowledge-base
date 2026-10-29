# Connecting the Stack

A ticket says: *"Users should sign in, see only their own company's invoices,
and get a clear message when something fails."* You could write every line of
it. You know hashing, sessions, cookies, CORS, error envelopes, correlation ids,
and now components, state, routing and server rendering. What you have never
done is hold both halves in your head at the same moment, and decide where each
part of that sentence actually belongs.

That is the only thing this folder does. The other two folders taught React and
Next.js on their own terms. This one closes the loop: every file starts from
something you already built on the server and shows the browser meeting it.

> **📌 The whole part in one line:** the browser and your API are one system,
> and almost every full-stack bug is a disagreement about which side is allowed
> to be believed.

## Files

1. [01-auth-flow-end-to-end-part-1.md](01-auth-flow-end-to-end-part-1.md) — one
   login from the form to the next authenticated request, where the credential
   lives in the browser, `HttpOnly` versus `localStorage`, CSRF from the
   frontend's side, and CORS with credentials.
2. [01-auth-flow-end-to-end-part-2.md](01-auth-flow-end-to-end-part-2.md) —
   route guards and why a client redirect is not security, reading the current
   user, handling 401 in one place, refresh rotation, logout that really ends a
   session, and auth in server components.
3. [02-loading-error-and-empty-states.md](02-loading-error-and-empty-states.md)
   — the five states every data screen has, consuming your own error envelope
   field by field, one UI behaviour per status code, optimistic updates, and the
   network as it really is.
4. [03-what-belongs-where.md](03-what-belongs-where.md) — the backend owns truth
   and rules, the frontend owns presentation, which duplication is correct and
   which is a bug, shaping the API for real screens, and a checklist for picking
   up a full-stack ticket.

## Read in this order

Straight through. File 01 is the centrepiece and both parts are one argument.
File 02 generalises its 401 handling to every status. File 03 is the closing
file and reads best once the first two have made the boundary concrete.

## What you should be able to do after this part

- Trace a login from the form to the next request and name every piece on the
  way, including the two steps the browser performs by itself.
- Choose where a credential lives and defend it with the XSS and CSRF
  trade-offs, not with habit.
- Diagnose a credentialed CORS failure from the console message alone.
- State without hesitating why a client-side guard protects nothing, and where
  the real check belongs.
- Design all five states of a screen before writing the component, and map each
  status code your API returns to a specific UI behaviour.
- Decide, for any piece of logic in a full-stack ticket, which side owns it and
  whether the other side may duplicate it.

## Where this connects

- [01-react-fundamentals/](../01-react-fundamentals/) — components, state,
  forms and `fetch`, which everything here assumes.
- [02-nextjs-essentials/](../02-nextjs-essentials/) — which machine runs the
  code, the detail behind server-side cookie reading and streamed loading.
- [backend-fundamentals/05-authentication/](../../backend-fundamentals/05-authentication/)
  and [06-authorization/](../../backend-fundamentals/06-authorization/) — the
  server half of file 01.
- [backend-fundamentals/07-error-handling/](../../backend-fundamentals/07-error-handling/)
  and [08-logging-and-observability/](../../backend-fundamentals/08-logging-and-observability/)
  — the error shape and the `request_id` that file 02 renders.
- [doc/career-roadmap.md](../../doc/career-roadmap.md) — the New Ticket
  Checklist that file 03 extends across the wire.
