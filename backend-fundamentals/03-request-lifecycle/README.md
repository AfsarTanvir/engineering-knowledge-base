# Part 3 — Request Lifecycle

Part 1 taught you what an HTTP message looks like on the wire. Part 2 taught
you how to design the set of endpoints your API exposes. This part answers the
question in between: **what actually happens inside your process between the
moment a request arrives and the moment a response leaves?**

Most bugs that feel "magical" live in this gap. A middleware that never calls
`next()` and hangs the request forever. A route that matches the wrong handler
because it was registered in the wrong order. A controller that grew from 8
lines to 200 and now nobody can test it. A deploy that drops every in-flight
request because the process exited immediately on `SIGTERM`.

None of that is magic. It is a pipeline you can draw on paper. Once you can
draw it, you can debug it.

## Files

1. [Anatomy of a Backend App](01-anatomy-of-a-backend-app.md) — the full
   journey of one request through every layer, what "the server is running"
   really means, application bootstrapping, and graceful shutdown.
2. [Routing](02-routing.md) — how a router matches a method and a path to a
   handler, route parameters, matching order and specificity, route grouping,
   and how routers stay fast at scale.
3. [Middleware](03-middleware.md) — the chain model, writing a middleware
   engine from scratch, the two middleware shapes, correct ordering, and the
   bugs that hang requests forever.
4. [Controllers and Request Context](04-controllers-and-request-context.md) —
   what belongs in a controller and what does not, reading input safely, the
   request context object, `AsyncLocalStorage`, and why module-level
   per-request state is a severe bug.

## Read in this order

Read 1 → 4, one file per sitting, in order. Each file is a layer of the same
pipeline, and each one assumes the vocabulary of the previous.

File 1 draws the whole map. Files 2, 3 and 4 zoom into three boxes on that
map. If you read file 3 before file 1 you will not know where middleware sits,
and the order rules will feel arbitrary.

Do not skip the graceful shutdown section in file 1. It is the part that turns
"works on my laptop" into "survives a deploy".

## What you should be able to do after this part

- Draw, from memory, every stage a request passes through in your app, in
  order, and say what each stage is responsible for.
- Explain why `/users/me` must be registered before `/users/:id`, and predict
  what breaks when it is not.
- Write a middleware from scratch, place it at the correct position in the
  stack, and explain in one sentence why it belongs there.
- Look at a 200-line controller and split it into a thin controller plus a
  service, without changing behaviour.
- Explain what happens to in-flight requests during a deploy, and write the
  shutdown code that keeps them safe.
- Name three ways a request can hang forever and how to detect each one.

## Where this connects

- The reverse proxy that sits in front of your process:
  [reverse-proxy](../../system-design/foundational/reverse-proxy.md) and
  [nginx config](../../cloud-devops/nginx/reverse-proxy-config.md).
- The single-threaded engine that runs all of this:
  [event-loop](../../typescript-fundamentals/event-loop/event-loop.md).
- The layering vocabulary (controller, service, repository) gets its own full
  treatment in Part 9 —
  [Application Architecture](../09-application-architecture/).
- Graceful shutdown is the process-side half of
  [rolling-updates](../../cloud-devops/deployment-strategies/rolling-updates.md)
  and [health-checks](../../cloud-devops/deployment-strategies/health-checks.md).

## Next

Part 4 — [Validation & Input Handling](../04-validation-and-input/) takes the
one rule this part keeps repeating — *never trust the input* — and turns it
into a real validation layer.
