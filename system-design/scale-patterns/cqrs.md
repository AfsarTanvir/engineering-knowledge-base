# CQRS (Command Query Responsibility Segregation)

Most systems use the same model to read and write data — one `Order`
table, one `Order` class, one API shape, for both "create this order" and
"show me this order." CQRS splits that in two: a write model optimized
for handling commands correctly, and a separate read model optimized for
serving queries fast. It's a natural pairing with
[event-driven architecture](event-driven-architecture.md), but it's a
distinct decision you can adopt independently.

## Table of Contents

1. [The Core Idea](#the-core-idea)
2. [Why Split Them](#why-split-them)
3. [How the Read Model Stays Updated](#how-the-read-model-stays-updated)
4. [Eventual Consistency Between the Two Sides](#eventual-consistency-between-the-two-sides)
5. [CQRS Without Separate Databases](#cqrs-without-separate-databases)
6. [CQRS With Event Sourcing](#cqrs-with-event-sourcing)
7. [When to Reach for This](#when-to-reach-for-this)
8. [Quick Reference](#quick-reference)

---

## The Core Idea

```
Traditional (one model for both):
  Write: INSERT/UPDATE orders table
  Read:  SELECT ... FROM orders (possibly with joins across other tables)

CQRS (two separate models):
  Write side:  Order aggregate -> validates business rules -> writes to write DB
  Read side:   Denormalized OrderSummary -> pre-joined, pre-computed -> read DB
```

The write side enforces invariants and business logic ("can't ship an
order that hasn't been paid"). The read side is shaped entirely around
what queries actually need to display — often heavily denormalized, with
joins already done ahead of time rather than computed per-request.

## Why Split Them

**Reads and writes have genuinely different needs.** A write needs
strict validation, transactional guarantees, and a normalized model that
avoids duplicate/inconsistent data. A read needs to be fast and shaped
exactly like the UI or API response that will consume it — which is
often *not* how you'd normalize a write model.

```sql
-- Write model: normalized, enforces integrity
orders(id, customer_id, status)
order_items(order_id, product_id, quantity, price)
customers(id, name, email)

-- Read model: denormalized, exactly what the "order summary" screen needs —
-- no joins required at query time, because they were done ahead of time
order_summaries(order_id, customer_name, item_count, total, status)
```

**They can also scale independently.** A product with far more reads
than writes (most consumer apps) can scale out read replicas or a
dedicated read store without that scaling effort touching the write path
at all — see [database-replication.md](../foundational/database-replication.md)
for the read-scaling half of this, which CQRS's read model is often built
on top of.

## How the Read Model Stays Updated

Something has to keep the read model in sync with the write model — this
is almost always done via events, making CQRS a natural fit with
[event-driven architecture](event-driven-architecture.md):

```python
# Write side: handles the command, persists to the write model
def place_order(command):
    order = Order.create(command.customer_id, command.items)
    write_db.save(order)
    event_bus.publish("order_placed", order.to_event())  # see the outbox pattern
                                                            # in event-driven-architecture.md
    return order.id

# Read side: a separate process listens for events and updates its own store
def on_order_placed(event):
    read_db.execute(
        "INSERT INTO order_summaries (order_id, customer_name, item_count, total, status) "
        "VALUES (%s, %s, %s, %s, %s)",
        event.order_id, event.customer_name, len(event.items), event.total, "placed"
    )
```

The read model is essentially a purpose-built cache of the write model's
data, kept current by subscribing to whatever changed — the same "React
to events, update a denormalized view" idea, applied specifically to
keeping a query-optimized store in sync.

## Eventual Consistency Between the Two Sides

Because the read model updates asynchronously in reaction to events, it's
briefly out of date immediately after a write — the same trade-off
covered in
[cap-theorem-and-consistency-models.md](../foundational/cap-theorem-and-consistency-models.md):

```
T=0.00s: Client sends "place order" command -> write model commits, event published
T=0.02s: Client immediately queries "get my orders" -> read model hasn't
         processed the event yet -> new order missing from the response
T=0.15s: Read model catches up -> new order now appears
```

**Common fix:** after a write, either read the write model directly for
that specific just-created entity (bypassing the read model briefly), or
have the client optimistically show the just-submitted data locally
before confirming against the read model — the same read-your-own-writes
pattern from the CAP/consistency doc, applied at the CQRS boundary.

## CQRS Without Separate Databases

CQRS doesn't require two different database *technologies*, or even two
different databases — the core idea is separate *models* for reading and
writing. A lighter version splits the code paths while sharing one
database:

```python
# Write side: a rich domain object enforcing business rules
class Order:
    def cancel(self):
        if self.status != "pending":
            raise InvalidStateError("Can only cancel pending orders")
        self.status = "cancelled"

# Read side: a plain query hitting a SQL view, no domain logic at all
def get_order_summary(order_id):
    return db.query("SELECT * FROM order_summary_view WHERE order_id = %s", order_id)
```

This gets much of CQRS's clarity benefit (write logic and read logic
aren't tangled together) without the operational cost of running and
syncing two separate data stores — a reasonable middle ground before
committing to a fully separate read store.

## CQRS With Event Sourcing

CQRS pairs especially well with event sourcing (storing an entity's
history as a sequence of events rather than current state — see
[event-driven-architecture.md](event-driven-architecture.md#event-sourcing-related-not-required))
because the write side's event stream is *already* exactly the input the
read side needs to build its denormalized views from. But — same as with
event-driven architecture generally — CQRS doesn't require event
sourcing; a plain relational write model publishing change events after
each write (as shown above) is a complete, valid CQRS setup on its own.

## When to Reach for This

**Good fit:**

- Read and write patterns are genuinely very different in shape or scale
  (e.g., simple writes, but reads need heavy joins/aggregation across
  many entities for a dashboard)
- Read load is dramatically higher than write load and needs independent
  scaling
- The write side has complex business rules that get muddied by trying
  to also serve flexible query needs from the same model

**Poor fit:**

- Simple CRUD where the read and write shapes are already basically the
  same — CQRS adds a second model and a sync mechanism to maintain, for
  no real benefit
- A small team/system where the eventual-consistency lag and dual-model
  maintenance cost isn't worth the query-performance gain
- Strong consistency is required on every read immediately after a write
  — CQRS's read side is inherently eventually consistent unless you add
  the read-your-own-writes workaround above

---

## Quick Reference

| Question                                              | Answer                                                  |
| :------------------------------------------------------------ | :------------------------------------------------------------ |
| Do reads and writes need very different data shapes?             | CQRS is worth considering                                        |
| Are reads and writes already similar and low-volume?              | Skip CQRS — one model is simpler                                   |
| How does the read model stay in sync?                             | Subscribing to events published by the write side                   |
| What happens if I query right after writing?                      | Might briefly miss the write — needs a read-your-own-writes fix        |
| Do I need two separate databases for this?                        | No — start with one DB, split write logic from read queries first     |

**Bottom line:** CQRS is worth its complexity when read and write
patterns have genuinely diverged — different scale, different shape, or
business rules that don't belong in a query-optimized model. Start with
the lightweight version (split code paths, one database) before
committing to fully separate data stores kept in sync by events.
