# Event-Driven Architecture

In a request-driven system, services call each other directly and wait
for a response. In an event-driven system, a service announces "this
happened" and moves on — interested services react independently,
whenever they get to it. That shift, from "tell this specific service to
do X" to "announce that Y occurred," is what decouples services enough to
scale and evolve them independently.

## Table of Contents

1. [Request-Driven vs Event-Driven](#request-driven-vs-event-driven)
2. [Events vs Commands](#events-vs-commands)
3. [The Trade-Off: Decoupling for Complexity](#the-trade-off-decoupling-for-complexity)
4. [Event Choreography vs Orchestration](#event-choreography-vs-orchestration)
5. [The Outbox Pattern](#the-outbox-pattern)
6. [Event Sourcing (Related, Not Required)](#event-sourcing-related-not-required)
7. [When to Reach for This](#when-to-reach-for-this)
8. [Quick Reference](#quick-reference)

---

## Request-Driven vs Event-Driven

**Request-driven:** the caller knows exactly who needs to act and calls
them directly, waiting for confirmation.

```
Order Service --(HTTP call, waits)--> Email Service
              --(HTTP call, waits)--> Inventory Service
              --(HTTP call, waits)--> Analytics Service
```

Order Service now depends on all three being up, reachable, and fast —
add a fourth interested service later, and Order Service's code has to
change to call it too.

**Event-driven:** the service that made something happen just publishes
that fact; it doesn't know or care who's listening.

```
Order Service --publish "order_placed"--> [ Topic ]
                                              |
                                    +---------+---------+
                                    v         v         v
                              Email Svc  Inventory  Analytics
                              (each reacts independently)
```

Order Service has zero dependency on Email/Inventory/Analytics being up.
Adding a fourth interested service (say, a fraud-check service) means
that service subscribes — Order Service's code doesn't change at all.
This is built on the pub/sub mechanics covered in
[message-queues/overview.md](../foundational/message-queues/overview.md).

## Events vs Commands

Not every message on a queue is really an "event" in this architectural
sense — the distinction matters for how tightly coupled the sender ends
up being to the receiver:

- **Command:** "do this specific thing" — `SendEmail`, `ChargeCard`. The
  sender expects a specific action to happen and usually cares about the
  outcome.
- **Event:** "this already happened" — `OrderPlaced`, `PaymentFailed`.
  The sender doesn't know or care what (if anything) happens next; it's a
  statement of fact, not an instruction.

```python
# Command — sender is directing a specific outcome
queue.send("send_email", {"to": "user@x.com", "template": "receipt"})

# Event — sender is just recording what happened; anyone can react or not
topic.publish("order_placed", {"order_id": 1020, "total": 49.99})
```

A system built entirely on commands between services is still tightly
coupled (the sender has to know which service handles which command,
same as a direct call) — the decoupling benefit of "event-driven" comes
specifically from favoring events over commands wherever the sender
genuinely doesn't need to direct a specific outcome.

## The Trade-Off: Decoupling for Complexity

Event-driven architecture doesn't remove complexity — it moves it from
"which services does this call and in what order" (visible in one place,
the calling code) to "which services react to this event, and what order
do their side effects happen in" (scattered across every consumer,
nowhere centrally visible).

**Concretely harder problems this introduces:**

- **Debugging a flow spans multiple services' logs** — tracing "why
  didn't the customer get their email" means checking whether the event
  was published, whether the email service's consumer is healthy, and
  whether it processed that specific message — not just reading one
  service's request log.
- **No built-in ordering across different event types** — if `OrderPlaced`
  and `OrderCancelled` for the same order both fire in quick succession,
  a consumer processing them out of order can end up in a wrong state.
- **Eventual consistency, not immediate** — the caller that published
  `OrderPlaced` has no idea when (or if) inventory actually got
  decremented; there's no synchronous confirmation.

This is a real trade — worth it once the number of services caring about
an event outgrows what a direct-call approach can reasonably manage, not
a default to reach for on a two-service system.

## Event Choreography vs Orchestration

**Choreography:** every service knows what it should do when it sees an
event, with no central coordinator. Each service reacts to events from
others and often emits its own events in turn:

```
Order Service: publishes "order_placed"
Inventory Service: sees it, decrements stock, publishes "inventory_reserved"
Shipping Service: sees "inventory_reserved", schedules shipment
```

No single place shows the full flow — you have to read every service's
event handlers to understand the whole process. Scales well
organizationally (teams don't need to coordinate on a central definition)
but gets hard to reason about as the number of steps grows.

**Orchestration:** a central coordinator explicitly calls each step and
tracks the overall process state (often implemented as a saga):

```python
class OrderSaga:
    def run(self, order):
        reserve_inventory(order)      # orchestrator calls each step
        charge_payment(order)
        schedule_shipment(order)
        # on failure at any step, the orchestrator runs compensating actions
        # (e.g., release_inventory) rather than leaving things half-done
```

One place shows the whole flow, including failure/compensation logic —
easier to reason about for complex multi-step processes, at the cost of
a coordinator that now knows about (and depends on) every step.

**Rule of thumb:** choreography for simple, independent reactions (a few
services each doing their own thing on an event); orchestration once a
multi-step process needs explicit failure handling and a clear "what
state is this order in right now" answer.

## The Outbox Pattern

A subtle bug: if a service writes to its database *and* publishes an
event as two separate operations, a crash between them either loses the
event (DB write succeeded, publish never happened) or publishes an event
for a write that then got rolled back.

```python
# Buggy: these two operations aren't atomic together
db.execute("INSERT INTO orders ...")
event_bus.publish("order_placed", order_data)  # crash here = DB has the order, no event ever sent
```

**The outbox pattern** writes the event to an "outbox" table in the
*same* database transaction as the actual data change, then a separate
process reads the outbox and publishes to the real event bus:

```python
with db.transaction():
    db.execute("INSERT INTO orders ...")
    db.execute("INSERT INTO outbox (event_type, payload) VALUES (%s, %s)",
               "order_placed", json.dumps(order_data))
# Both inserts commit together, or neither does — no lost/orphaned events

# Separate poller/CDC process reads the outbox table and publishes to Kafka/SQS/etc,
# marking rows as published once confirmed
```

This guarantees the event is published if and only if the data change
actually committed — the transactional guarantee the database already
gives you, extended to cover the event as well.

## Event Sourcing (Related, Not Required)

Event-driven architecture (services communicating via events) is often
confused with **event sourcing** (storing an entity's state as a sequence
of events, rather than storing current state directly) — they're
related but independent choices. You can build an event-driven system
where each service still stores plain current-state rows in a normal
table; event sourcing is a separate, heavier decision about how a
specific service persists its own data, usually reached for only when
you specifically need a full audit history or the ability to replay/
rebuild state — not a requirement of going event-driven.

## When to Reach for This

**Good fit:**

- Multiple services genuinely need to react independently to the same
  occurrence (order placed → email, inventory, analytics, fraud-check,
  all separately)
- You want to add new reactions to existing events without changing the
  code that publishes them
- Workflows are naturally asynchronous already (a user doesn't need to
  wait for analytics to record their order before seeing "order
  confirmed")

**Poor fit:**

- A simple, synchronous request/response need — "get this user's
  profile" doesn't benefit from being an event
- Two services, one dependency between them — a direct call is simpler
  and easier to debug than standing up a topic for it
- The caller genuinely needs to know the outcome before proceeding
  (that's a command/request, not an event)

---

## Quick Reference

| Question                                             | Answer                                            |
| :---------------------------------------------------------- | :------------------------------------------------------ |
| Sender needs a specific action done, cares about the result   | Command (direct call or task queue)                        |
| Sender is just recording that something happened               | Event (pub/sub)                                             |
| Multi-step process needs explicit failure handling               | Orchestration (saga)                                         |
| Simple independent reactions, no central coordination needed     | Choreography                                                  |
| Need to guarantee an event is published exactly when a DB write commits | Outbox pattern                                          |

**Bottom line:** reach for events instead of direct calls once more than
one or two services need to react independently to the same occurrence —
and expect to trade synchronous simplicity for cross-service debugging
complexity. Use the outbox pattern the moment a published event needs to
be consistent with a database write, and choose orchestration over
choreography once a workflow needs centralized failure handling.
