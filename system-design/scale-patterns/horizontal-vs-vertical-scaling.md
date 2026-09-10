# Horizontal vs Vertical Scaling

When a system runs out of headroom, there are only two directions to
grow: make each machine bigger (vertical), or use more machines
(horizontal). The choice shapes almost every other architectural decision
downstream — load balancing, data partitioning, state management — so
it's worth being deliberate about which one you're actually doing at any
given point.

## Table of Contents

1. [Vertical Scaling (Scale Up)](#vertical-scaling-scale-up)
2. [Horizontal Scaling (Scale Out)](#horizontal-scaling-scale-out)
3. [The Statelessness Requirement](#the-statelessness-requirement)
4. [Database Scaling Is Different](#database-scaling-is-different)
5. [Cost Curves](#cost-curves)
6. [A Practical Progression](#a-practical-progression)
7. [Quick Reference](#quick-reference)

---

## Vertical Scaling (Scale Up)

Add more CPU, RAM, or faster disks to an existing machine.

```
Before: 1 server, 4 vCPU, 16GB RAM
After:  1 server, 16 vCPU, 64GB RAM   (same server, bigger)
```

**Advantages:**

- No architectural changes needed — the application code, deployment,
  and data model stay exactly as they were
- No new failure modes — you still have exactly one thing that can fail
- Simplest possible first move when a system is genuinely resource-
  constrained (CPU-bound, memory-bound) rather than request-volume-bound

**Limits:**

- **A hard ceiling** — even the largest cloud instance types cap out
  eventually; you cannot vertically scale past what a single machine can
  physically hold
- **Downtime to resize** — most cloud providers require a restart to
  change instance size, meaning a scale-up is a brief outage or requires
  its own failover dance
- **No redundancy gain** — one bigger machine is still one machine; it
  doesn't help you survive a single point of failure

## Horizontal Scaling (Scale Out)

Add more machines running the same workload, and distribute requests
across them (see [load-balancing.md](../foundational/load-balancing.md)).

```
Before: 1 server handling all traffic
After:  4 servers, each handling ~1/4 of traffic, behind a load balancer
```

**Advantages:**

- **No practical ceiling** — need more capacity, add another machine;
  this is how systems scale to thousands of nodes
- **Built-in redundancy** — one server dying doesn't take the whole
  system down, the others keep serving
- **Elastic** — add machines during traffic spikes, remove them when
  load drops, without touching existing running instances

**Limits:**

- **Requires the workload to actually parallelize** — a workload that's
  fundamentally single-threaded or has shared mutable state doesn't
  automatically get faster with more machines
- **Coordination overhead** — load balancing, service discovery, and
  (for stateful systems) data synchronization all become real problems
  the moment there's more than one node
- **More moving parts to operate** — more instances to monitor, patch,
  and deploy to, and more complex debugging (which of the 20 instances
  logged the error?)

---

## The Statelessness Requirement

Horizontal scaling only works cleanly when any request can be handled by
any instance — which means the instance itself can't be the only place
that knows something.

```python
# Breaks horizontal scaling: session lives only in this process's memory
sessions = {}  # in-memory dict

def login(user_id):
    sessions[user_id] = {"logged_in_at": now()}
    # A second request for this user, routed to a DIFFERENT instance,
    # has no idea this session exists
```

```python
# Works with horizontal scaling: session lives in a shared store
def login(user_id):
    redis.set(f"session:{user_id}", json.dumps({"logged_in_at": now()}))
    # ANY instance can look this up — none of them need to be "the one" the user hit before
```

This is the same principle as avoiding sticky sessions in
[load-balancing.md](../foundational/load-balancing.md) — externalize
anything that needs to persist across requests (sessions, uploaded files
mid-processing, local caches of mutable data) into a shared store so
every instance is interchangeable.

---

## Database Scaling Is Different

Application servers are usually the easy case for horizontal scaling —
stateless web/API servers duplicate trivially behind a load balancer.
Databases are the hard case, because the data itself is the state.

- **Vertical scaling a database** — bigger instance, more RAM for
  caching, faster disks — is often the *first* lever pulled, precisely
  because it requires zero application changes.
- **Horizontal scaling a database** means either read replicas (see
  [database-replication.md](../foundational/database-replication.md), for
  read-heavy scaling) or sharding (see
  [database-sharding.md](../foundational/database-sharding.md), for
  write-heavy or storage-heavy scaling) — both add real complexity that
  vertical scaling avoids.

**Practical rule:** exhaust vertical scaling on the database before
reaching for sharding — sharding is a one-way architectural commitment
that's expensive to undo, while resizing an instance is a config change.

---

## Cost Curves

Vertical scaling gets disproportionately expensive at the high end —
doubling a small instance's specs might cost roughly double, but doubling
an already-huge instance's specs (if even available) often costs far
more than double, since you're paying for increasingly rare hardware
tiers.

```
Small -> Medium instance: ~2x cost, ~2x capacity   (roughly linear)
Large -> XLarge instance: ~2x cost, ~2x capacity   (roughly linear)
XLarge -> 2XLarge (near the top tier): cost can jump 3-4x for 2x capacity
```

Horizontal scaling's cost stays roughly linear far longer (10 machines
cost ~10x one machine), which is why large-scale systems lean horizontal
once they outgrow the "just get a bigger box" phase — not because
horizontal is inherently cheaper at small scale, but because it doesn't
hit the same steep cost wall vertical scaling does at the high end.

---

## A Practical Progression

Most systems don't start horizontal — they grow into it:

1. **One server, vertically scaled** as needed — simplest, works fine
   until either the ceiling is hit or redundancy becomes a requirement
2. **Multiple stateless app servers, horizontally scaled**, single
   database — the most common "next step," since app servers are the
   easiest thing to make stateless
3. **Database read replicas added** — read-heavy load spreads out, writes
   still go through one primary (vertically scaled as far as it'll go)
4. **Database sharding, caching layers, CDN** — reached for once the
   single-primary database itself becomes the bottleneck, not before

Jumping straight to step 4 for a system that hasn't outgrown step 1 adds
complexity that isn't earned yet — scale the simplest way that solves the
actual, measured bottleneck.

---

## Quick Reference

| Situation                                            | Lean toward             |
| :---------------------------------------------------------- | :----------------------------- |
| Simple workload, no redundancy requirement yet                | Vertical                        |
| Need to survive a single machine failure                      | Horizontal                       |
| Workload has shared mutable state, hard to parallelize          | Vertical (or redesign for statelessness first) |
| Traffic is spiky/unpredictable, want to scale in and out fast  | Horizontal                       |
| Database is the bottleneck, haven't maxed out instance size yet | Vertical, first                   |
| Database instance is already near the largest tier available    | Horizontal (replicas/sharding)      |

**Bottom line:** vertical scaling is the simpler first move and the right
one for a database until you've actually exhausted it; horizontal scaling
is what gives you both a practical ceiling far above any single machine
and redundancy against failure, but only pays off once the workload (and
its state) is actually designed to be spread across many machines.
