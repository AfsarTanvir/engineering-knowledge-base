# Monolith vs Microservices

A monolith deploys one codebase as one unit. Microservices split that
same functionality into independently deployable services. Neither is
the "modern" or "legacy" choice by default — the trade-off is real and
symmetric: microservices trade simplicity for independent scaling and
team autonomy, and plenty of large, successful systems run as a monolith
by deliberate choice.

## Table of Contents

1. [What Each Actually Means](#what-each-actually-means)
2. [What Microservices Actually Buy You](#what-microservices-actually-buy-you)
3. [What Microservices Cost You](#what-microservices-cost-you)
4. [The Distributed Monolith Anti-Pattern](#the-distributed-monolith-anti-pattern)
5. [The Modular Monolith](#the-modular-monolith)
6. [The Strangler Fig Pattern](#the-strangler-fig-pattern)
7. [How to Actually Decide](#how-to-actually-decide)
8. [Quick Reference](#quick-reference)

---

## What Each Actually Means

**Monolith:** one deployable unit. Every module runs in the same process,
calls between modules are in-process function calls, and the whole thing
is deployed together.

```
[ Single Application ]
  ├── Orders module
  ├── Inventory module
  ├── Users module
  └── Payments module
-> one deploy, one process, one database (typically)
```

**Microservices:** each capability is its own deployable service, with
its own process, typically its own database, communicating over the
network (HTTP, gRPC, or events — see
[message-queues/overview.md](message-queues/overview.md)).

```
[ Orders Service ] --network call--> [ Inventory Service ]
       |
   own database
[ Payments Service ] (own database, own deploy, own scaling)
```

## What Microservices Actually Buy You

- **Independent deployment** — ship a fix to the payments service without
  redeploying (or risking) the entire application
- **Independent scaling** — [scale](../scale-patterns/horizontal-vs-vertical-scaling.md)
  only the service that's actually under load (e.g., checkout during a
  sale) instead of scaling the whole monolith
- **Team autonomy** — different teams own different services, choose
  their own tech stack per service, and deploy on their own schedule
  without coordinating a shared release
- **Fault isolation (if done right)** — a crash in the recommendations
  service doesn't necessarily take down checkout, if the dependency
  between them is asynchronous or has a fallback

## What Microservices Cost You

- **Network calls replace function calls** — every cross-service
  interaction now has latency, can time out, and can fail independently
  — needing the patterns in
  [circuit-breakers-and-retries.md](../reliability/circuit-breakers-and-retries.md)
  and [idempotency.md](../reliability/idempotency.md) that a monolith's
  in-process calls never needed
- **Data consistency gets harder** — a transaction that used to be one
  database `COMMIT` across several tables now spans services with their
  own databases; see [cap-theorem-and-consistency-models.md](cap-theorem-and-consistency-models.md) —
  you're choosing eventual consistency across service boundaries, often
  without realizing it up front
- **Operational overhead multiplies** — more services to deploy, monitor,
  log, and debug; tracing a single user request across 8 services requires
  distributed tracing infrastructure a monolith never needs
- **Testing gets harder** — integration tests now need multiple services
  running together (or extensive mocking) instead of one process

## The Distributed Monolith Anti-Pattern

The worst outcome: services are split apart physically, but still
coupled as tightly as a monolith's internal modules — deploying Service A
requires Service B to deploy in lockstep, or a chain of synchronous calls
means any one service being down takes the whole chain down anyway.

```
Service A --(synchronous call, must succeed)--> Service B
                                                      --(synchronous call, must succeed)--> Service C
-- Service C being down still breaks the entire request chain,
-- exactly like a monolith, but now with network latency and more failure points added
```

This is what happens when a team splits a monolith along the wrong
boundaries (or without changing the *communication pattern*, just the
*deployment* pattern) — you inherit every microservices cost with none of
the actual benefits. Favor asynchronous, event-driven communication (see
[event-driven-architecture.md](../scale-patterns/event-driven-architecture.md))
between services that don't need an immediate answer, specifically to
avoid this trap.

## The Modular Monolith

A middle ground: keep one deployable unit, but enforce strict module
boundaries in code (separate packages/modules, no direct cross-module
database access, clear internal APIs between them) — most of
microservices' organizational clarity, none of the network/deployment
overhead:

```
[ Single Application, One Deploy ]
  ├── orders/       (own internal API, doesn't reach into inventory's tables directly)
  ├── inventory/     (own internal API)
  ├── users/
  └── payments/
```

If module boundaries are already clean, splitting into real
microservices later is a more mechanical extraction — the hard, valuable
work (defining where one capability ends and another begins) is already
done. Many teams get the most practical value from getting this part
right before ever splitting into separate deployments at all.

## The Strangler Fig Pattern

The common path for a team that decides a monolith genuinely needs to
become microservices — not a rewrite, but incrementally extracting one
capability at a time while the monolith keeps running:

```
Step 1: [ Monolith handles everything ]

Step 2: [ Monolith ] --(routes /payments/* elsewhere)--> [ New Payments Service ]
        (a reverse proxy / API gateway routes specific paths to the new service)

Step 3: [ Monolith, now smaller ] + [ Payments Service ] + [ Orders Service ] + ...
        (repeat extraction, one capability at a time, until the monolith is gone
         or reduced to whatever doesn't need extracting)
```

Named after the way a strangler fig plant grows around a host tree,
gradually replacing it — the monolith keeps serving traffic throughout,
with a [reverse proxy or API gateway](reverse-proxy.md) incrementally
redirecting specific routes to newly extracted services. This avoids the
high-risk "rewrite everything, cut over on one day" approach.

## How to Actually Decide

**Start with a monolith (ideally modular) unless you have a specific,
concrete reason not to.** The organizational and operational costs of
microservices are real and paid immediately; the benefits (independent
scaling, team autonomy) only matter once you actually have the scale or
team size that needs them.

**Signals that genuinely justify splitting a service out:**

- One specific part of the system has wildly different scaling needs
  than the rest (e.g., image processing needs GPU instances, the rest
  doesn't)
- Multiple teams are stepping on each other deploying the same codebase,
  and clean internal module boundaries alone aren't solving it
- A part of the system has a genuinely different reliability or compliance
  requirement (e.g., payments needs isolation and audit trails the rest
  of the app doesn't)

**Not good enough reasons on their own:** "microservices are what
[well-known company] uses," "it feels more modern," or "we might need to
scale this differently someday" — these describe an aspiration, not a
measured, current bottleneck.

---

## Quick Reference

| Situation                                              | Lean toward                  |
| :------------------------------------------------------------ | :--------------------------------- |
| Small team, early-stage product, unclear scaling needs           | Monolith (modular)                   |
| One component has distinctly different scaling/reliability needs  | Extract that one service              |
| Multiple teams blocked on each other's deploys                    | Split along team/module boundaries      |
| Services split but still communicate via required synchronous calls | Distributed monolith — fix the coupling, not just the deployment |
| Migrating an existing monolith to services                        | Strangler fig — extract incrementally    |

**Bottom line:** a monolith with clean internal module boundaries is the
right starting point for most systems — it defers the real costs of
microservices (network failure handling, data consistency across
services, operational overhead) until there's a concrete, measured
reason to pay them.
