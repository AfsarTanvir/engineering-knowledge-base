# Blue-Green Deployment

Blue-green deployment runs two complete, identical production
environments — "blue" (currently live) and "green" (the new version) —
and switches all traffic from one to the other in a single, instant
cutover. Unlike a [rolling update](rolling-updates.md), there's never a
period where old and new versions serve traffic simultaneously; the
trade-off is running two full environments at once, even if briefly.

## Table of Contents

1. [How It Works](#how-it-works)
2. [The Cutover Mechanism](#the-cutover-mechanism)
3. [Instant Rollback](#instant-rollback)
4. [Database Migrations: The Hard Part](#database-migrations-the-hard-part)
5. [Cost: Running Double Infrastructure](#cost-running-double-infrastructure)
6. [Blue-Green vs Rolling Update](#blue-green-vs-rolling-update)
7. [Quick Reference](#quick-reference)

---

## How It Works

```
Before cutover:
  [ Load Balancer ] --100%--> [ Blue environment: v1.0 ]  (live)
                               [ Green environment: v2.0 ]  (deployed, idle, being tested)

Cutover:
  [ Load Balancer ] --100%--> [ Green environment: v2.0 ]  (now live)
                               [ Blue environment: v1.0 ]  (idle, kept around briefly for rollback)
```

Green is fully deployed and can be tested (smoke tests, manual QA)
*before* it receives any real user traffic at all — unlike a rolling
update, where new instances start receiving live traffic as soon as
they're individually marked ready.

## The Cutover Mechanism

The switch itself is typically a routing change at the load balancer or
DNS layer — not a redeploy, which is what makes it near-instant:

```nginx
# Before: upstream points at blue
upstream backend {
    server blue-1.internal:8000;
    server blue-2.internal:8000;
}

# Cutover: repoint the same upstream at green
upstream backend {
    server green-1.internal:8000;
    server green-2.internal:8000;
}
```

```bash
# Or, at the DNS level (slower to propagate — see caveats below)
# blue.internal.example.com -> green.internal.example.com
```

**DNS-based cutovers propagate slowly** (client-side and resolver
caching can hold onto the old address for minutes) — a load-balancer-
level switch (repointing which backend pool a proxy or Service targets)
is faster and more predictable, and is the standard mechanism when using
something like the load balancer patterns from
[load-balancing.md](../../system-design/foundational/load-balancing.md)
or a Kubernetes [Service](../kubernetes/service.md) selector.

## Instant Rollback

The other half of the payoff: since blue is still fully running (just
not receiving traffic), reverting a bad green release is the same
routing switch, in reverse — no redeploy needed:

```
Cutover to green -> problem discovered -> switch routing back to blue
-> rollback is complete in the time it takes traffic to re-route,
   not the time it takes to redeploy the old version from scratch
```

This is blue-green's single biggest advantage over a rolling update's
rollback (which has to scale the old ReplicaSet back up — fast, but not
"already running and simply not receiving traffic" fast).

## Database Migrations: The Hard Part

Blue-green's clean, instant cutover story gets much harder the moment
blue and green share a single database — a schema is either compatible
with both versions simultaneously, or the cutover isn't actually safe:

```
If green's code expects a NEW column that doesn't exist yet:
  -> deploying green before the migration runs = green is broken

If the migration RENAMES/DROPS a column blue still reads:
  -> blue breaks the moment the migration runs, even before cutover
```

**The practical fix is the same additive-migration discipline from
[rolling-updates.md](rolling-updates.md#the-two-versions-live-problem):**
schema changes need to be backward-compatible with the version being
phased out — add new columns as nullable, keep old ones until nothing
reads them anymore, and split a genuinely breaking change into multiple
sequential deploys rather than one cutover.

**A cleanly separate database per environment** (blue's own DB, green's
own DB, kept in sync some other way) avoids the shared-schema problem
entirely, but introduces a much harder question: how do you migrate live
user data between two databases at cutover time without losing or
duplicating writes? Most real systems share one database across blue and
green specifically to avoid this, accepting the migration-compatibility
constraint instead.

## Cost: Running Double Infrastructure

For the duration blue and green coexist, you're paying for (roughly)
double the compute — every server, every replica, doubled. This is the
direct cost of blue-green's benefit (a fully-tested, fully-running
standby environment ready for instant cutover and instant rollback):

```
Normal running cost: N servers
During a blue-green deploy: up to 2N servers, until the old environment
                              is torn down after the new one is confirmed stable
```

Teams often keep the old (blue) environment alive for a defined window
after cutover — long enough to be confident nothing's wrong — before
tearing it down and reclaiming that cost.

## Blue-Green vs Rolling Update

| Aspect                             | Blue-Green                                 | Rolling Update                          |
| :-------------------------------------- | :----------------------------------------------- | :--------------------------------------------- |
| Old and new versions live simultaneously   | No — instant, all-or-nothing cutover                | Yes — for the duration of the rollout             |
| Infrastructure cost during deploy           | ~2x (full duplicate environment)                    | Minimal extra (a few surge instances at most)       |
| Rollback speed                              | Instant — just switch routing back                   | Fast, but requires scaling the old ReplicaSet back up |
| Can test the new version before any live traffic hits it | Yes — green is fully deployed and testable pre-cutover | No — new instances start taking traffic as soon as ready |
| Complexity around shared database migrations | High — same constraint as rolling updates, but the all-at-once cutover leaves no partial-rollout buffer | Same underlying constraint, but the gradual nature gives more room to notice issues before 100% is on the new version |

---

## Quick Reference

| Question                                              | Answer                                                     |
| :-------------------------------------------------------------- | :------------------------------------------------------------------ |
| Are old and new versions ever serving traffic at the same time?    | No — the whole point is an instant, all-at-once switch                 |
| How fast is rollback?                                              | Instant — the old environment is still running, just switch back        |
| What's the main cost?                                              | Roughly double infrastructure while both environments coexist            |
| What's the main risk?                                              | Shared-database schema compatibility across both versions at cutover time |
| How does the actual cutover happen?                                | A routing change (load balancer/Service), ideally not DNS (too slow to propagate) |

**Bottom line:** blue-green trades infrastructure cost for the cleanest
possible cutover and rollback story — no mixed-version traffic period,
instant revert. It's most attractive when instant rollback matters more
than infrastructure efficiency, and it inherits the exact same
backward-compatible-migration discipline that rolling updates need.
