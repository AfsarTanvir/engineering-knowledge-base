# Rolling Updates

A rolling update replaces old instances with new ones gradually — a few
at a time — rather than stopping everything and starting the new version
all at once. It's the default deployment strategy in Kubernetes (see
[deployment.md](../kubernetes/deployment.md#rolling-out-a-new-version))
and the most common way to deploy with zero downtime, without needing
the doubled infrastructure that [blue-green](blue-green-deployment.md)
requires.

## Table of Contents

1. [The Alternative: Recreate](#the-alternative-recreate)
2. [How a Rolling Update Actually Proceeds](#how-a-rolling-update-actually-proceeds)
3. [maxUnavailable and maxSurge](#maxunavailable-and-maxsurge)
4. [Why Health Checks Are Non-Negotiable Here](#why-health-checks-are-non-negotiable-here)
5. [The Two-Versions-Live Problem](#the-two-versions-live-problem)
6. [Rollback Mid-Rollout](#rollback-mid-rollout)
7. [Rolling Updates vs Blue-Green vs Canary](#rolling-updates-vs-blue-green-vs-canary)
8. [Quick Reference](#quick-reference)

---

## The Alternative: Recreate

The simplest possible deploy strategy: stop every old instance, then
start every new instance. Simple to reason about, but guarantees
downtime for the gap between "old is stopped" and "new is ready":

```
Recreate: [old][old][old] -> [ ][ ][ ]  <- brief total outage -> [new][new][new]
```

Rolling updates exist specifically to avoid this gap — there's always
some capacity serving traffic throughout the deploy.

## How a Rolling Update Actually Proceeds

```
Start:  [old][old][old]                     (3 replicas, v1.0)

Step 1: [old][old][old][new]                (add 1 new, v2.0 — total 4 briefly)
Step 2: [old][old][new]                     (1 old removed once new is ready — back to 3)
Step 3: [old][old][new][new]                (add another new)
Step 4: [old][new][new]                     (remove another old)
Step 5: [old][new][new][new]
Step 6: [new][new][new]                     (done — fully on v2.0)
```

At every step, the total serving capacity stays roughly at (or slightly
above) the desired replica count — traffic never drops to zero, and
never has to wait for an all-at-once cutover.

## maxUnavailable and maxSurge

Two settings control exactly how aggressive or cautious this process is:

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1    # at most 1 replica can be down at any point during the rollout
      maxSurge: 1            # at most 1 EXTRA replica beyond the desired count, temporarily
```

```
Desired: 3 replicas, maxUnavailable=1, maxSurge=1

This allows the pool size to range from 2 (3 - maxUnavailable)
                                    to 4 (3 + maxSurge)
at any point during the rollout — never below 2, never above 4
```

**`maxSurge: 0`** forces strictly replace-then-add (never exceeding the
original count, useful when there's no spare capacity to run extra
instances temporarily). **`maxUnavailable: 0`** forces strictly add-then-
remove (never dropping below full capacity, at the cost of needing extra
headroom to run the temporary surge instances). Most production configs
allow a small amount of both, balancing rollout speed against resource
headroom.

## Why Health Checks Are Non-Negotiable Here

A rolling update only removes an old instance once a new one is
confirmed **ready** — this entire mechanism depends on
[readiness checks](health-checks.md) being accurate:

```
Step: create 1 new Pod (v2.0)
      -> wait for readiness probe to succeed
      -> ONLY THEN remove 1 old Pod (v1.0)
```

If the new version is actually broken but its readiness check
incorrectly reports healthy, the rollout proceeds to replace *every*
instance with a broken version — the exact failure mode a rolling
update is supposed to prevent. This is why the readiness check needs to
verify real functionality (see
[health-checks.md](health-checks.md#what-a-health-check-should-actually-verify)),
not just "the process started."

## The Two-Versions-Live Problem

For the duration of the rollout, old and new versions are serving
traffic simultaneously — which is fine for a stateless API returning the
same response shape, but a real problem if the versions are
incompatible in ways clients or shared state can observe:

```
During rollout:
  Client request 1 -> routed to an OLD instance -> returns response shape A
  Client request 2 -> routed to a NEW instance -> returns response shape B (breaking change!)
```

**This is why backward-incompatible changes need to be rolled out in
separate steps** — deploy the new version so it can read *both* the old
and new data/response shape, let that fully roll out, then deploy a
follow-up change that drops support for the old shape. Database schema
migrations follow the same principle: additive changes (add a nullable
column) are safe to roll out alongside old code; changes that remove or
repurpose something the old code still expects are not.

## Rollback Mid-Rollout

If a rolling update is discovered to be bad partway through, the same
mechanism runs in reverse — Kubernetes just resumes reconciling toward
the previous ReplicaSet instead of the new one:

```bash
kubectl rollout undo deployment/my-app
```

```
Mid-rollout: [old][old][new][new]     (2 of each, rollout was halfway)
kubectl rollout undo
     -> [old][old][old][new]           (scaling old back up)
     -> [old][old][old]                 (scaling new back down to 0 — fully reverted)
```

Because both ReplicaSets already exist (the old one just scaled down,
not deleted — see [deployment.md](../kubernetes/deployment.md#replicasets-the-layer-you-dont-usually-touch)),
this reversal is fast — no rebuild, no redeploy from scratch.

## Rolling Updates vs Blue-Green vs Canary

- **Rolling update** — gradual replacement, no extra infrastructure, but
  both versions serve real traffic simultaneously during the rollout
  (the two-versions-live problem above)
- **[Blue-green](blue-green-deployment.md)** — full duplicate
  environment, instant cutover, no mixed-version period, but needs
  double the infrastructure temporarily
- **[Canary](canary-deployment.md)** — a small, deliberate percentage of
  traffic on the new version first, specifically to detect problems
  before a full rollout — often layered *on top of* a rolling update or
  blue-green cutover, rather than a separate mechanism entirely

---

## Quick Reference

| Question                                                    | Answer                                                    |
| :------------------------------------------------------------------ | :----------------------------------------------------------------- |
| Does a rolling update cause downtime?                                 | No, by design — capacity is maintained throughout                     |
| Are old and new versions ever live at the same time?                   | Yes — for the duration of the rollout, this is inherent to the strategy |
| What controls rollout speed vs safety margin?                          | `maxUnavailable` and `maxSurge`                                          |
| What happens if the new version is broken but passes health checks?     | It replaces everything — accurate readiness checks are essential          |
| How do I undo a bad rollout?                                            | `kubectl rollout undo` — resumes toward the previous ReplicaSet             |

**Bottom line:** rolling updates give zero-downtime deploys without
doubling your infrastructure, at the cost of a period where old and new
versions both serve traffic — plan backward-compatible changes
accordingly, and never ship a rolling update without a readiness check
that actually verifies the new version works.
