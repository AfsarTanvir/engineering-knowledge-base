# Canary Deployment

A canary deployment routes a small, deliberate slice of real traffic to
a new version — 5%, say — while the rest keeps hitting the stable
version, specifically to catch problems with real production traffic
before committing everyone to the new release. The name comes from
canaries historically used to detect dangerous gas in mines: a small,
expendable exposure that gives early warning before it affects everyone.

## Table of Contents

1. [How It Differs From Rolling Updates](#how-it-differs-from-rolling-updates)
2. [The Traffic-Splitting Mechanism](#the-traffic-splitting-mechanism)
3. [What to Actually Watch](#what-to-actually-watch)
4. [Automated vs Manual Promotion](#automated-vs-manual-promotion)
5. [Canary + Feature Flags](#canary--feature-flags)
6. [Statistical Validity: Don't Trust a Tiny Sample](#statistical-validity-dont-trust-a-tiny-sample)
7. [Quick Reference](#quick-reference)

---

## How It Differs From Rolling Updates

A [rolling update](rolling-updates.md) also has a period where old and
new versions coexist — but it's replacing instances as fast as readiness
checks allow, with the intent of reaching 100% new version quickly. A
canary deliberately *holds* at a small percentage, on purpose, for long
enough to actually observe real-world behavior before deciding whether
to proceed at all.

```
Rolling update: old -> mostly old -> mostly new -> new
                (progresses continuously, intent is to finish)

Canary:         old (95%) + new (5%) -- HOLD here, watch metrics --
                -> decide: promote (increase %) or abort (revert to 0%)
```

The canary percentage is a checkpoint, not just a transient step —
rollout doesn't continue until someone (or some automated check)
explicitly decides the canary looks healthy.

## The Traffic-Splitting Mechanism

At the infrastructure level, this is usually weighted routing at the
load balancer, service mesh, or ingress layer:

```yaml
# Example: Kubernetes with a service mesh (Istio) VirtualService
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: my-app
spec:
  hosts:
    - my-app
  http:
    - route:
        - destination:
            host: my-app-stable
          weight: 95
        - destination:
            host: my-app-canary
          weight: 5
```

```nginx
# Nginx-level weighted routing achieves a similar effect
upstream backend_pool {
    server stable-1.internal:8000 weight=19;
    server canary-1.internal:8000 weight=1;   # ~5% of traffic
}
```

The same underlying mechanism as the weighted load balancing in
[load-balancing.md](../../system-design/foundational/load-balancing.md#load-balancing-algorithms) —
canary deployment is really "weighted routing, applied deliberately as a
release-safety mechanism" rather than a distinct piece of technology.

## What to Actually Watch

The whole point of holding at a small percentage is to compare the
canary against the stable baseline on the metrics that actually matter:

- **Error rate** — is the canary throwing more 5xx responses than stable?
- **Latency** — p50/p95/p99 response time, compared side by side
- **Business metrics, if relevant** — conversion rate, checkout success —
  a canary can be technically "healthy" (no errors) while quietly
  performing worse on an outcome that matters
- **Resource usage** — is the canary consuming disproportionate CPU/
  memory for the same traffic share, suggesting a performance regression

```
Stable: error rate 0.1%, p95 latency 120ms
Canary: error rate 2.5%, p95 latency 400ms
-> clear signal: abort, do not promote
```

A canary is only useful if these are actually being measured and
compared — deploying 5% of traffic to a new version without watching
anything is just a smaller, quieter rolling update with extra steps.

## Automated vs Manual Promotion

- **Manual** — a human reviews the canary's metrics after a defined
  observation window and decides whether to increase the percentage
  (or abort). Simpler to set up, slower, and depends on someone actually
  paying attention.
- **Automated (progressive delivery)** — tooling (Flagger, Argo Rollouts)
  automatically compares canary metrics against stable and
  promotes/aborts based on predefined thresholds, without a human in the
  loop for each step:

```yaml
# Simplified Argo Rollouts canary strategy
spec:
  strategy:
    canary:
      steps:
        - setWeight: 5
        - pause: { duration: 5m }
        - setWeight: 20
        - pause: { duration: 5m }
        - setWeight: 50
        - pause: { duration: 5m }
        - setWeight: 100
      analysis:
        templates:
          - templateName: error-rate-check   # auto-abort if this check fails
```

This turns the "hold and watch" step into a defined, repeatable pipeline
stage rather than a manual judgment call each time — the natural next
step once a team has run enough canary releases to know what "healthy"
actually looks like numerically.

## Canary + Feature Flags

Canary deployment splits traffic at the *infrastructure* level (which
instance handles the request). Feature flags split behavior at the
*application* level (which code path runs, regardless of which instance
handled it) — they solve a similar problem but at different layers, and
often get combined:

```python
if feature_flags.is_enabled("new_checkout_flow", user_id=user.id):
    return new_checkout_flow()
else:
    return old_checkout_flow()
```

A feature flag can target a specific 5% of *users* consistently (same
users see the new behavior every time), whereas infrastructure-level
canary routing typically targets a percentage of *requests* (the same
user might hit stable on one request and canary on the next) — worth
knowing which one you actually need before picking a mechanism.

## Statistical Validity: Don't Trust a Tiny Sample

A canary running at 5% traffic on a low-volume service might only see a
handful of requests during the observation window — not enough to
distinguish "the canary is actually broken" from "we just got unlucky
with a small sample":

```
Low traffic: 5% of 100 requests/hour = ~5 requests in the canary
             -> 1 error out of 5 looks alarming (20%!) but could easily
                be noise, not a real regression
```

**Scale the canary percentage (or the observation window) to the
service's actual traffic volume** — a low-traffic service may need a
much higher canary percentage, or a much longer hold, to gather a
statistically meaningful sample before deciding anything.

---

## Quick Reference

| Question                                                | Answer                                                       |
| :--------------------------------------------------------------- | :-------------------------------------------------------------------- |
| How is this different from a rolling update?                        | Canary deliberately holds at a small % and compares metrics before proceeding |
| How is traffic actually split?                                       | Weighted routing at the load balancer / service mesh / ingress layer     |
| What should be compared between canary and stable?                    | Error rate, latency, and relevant business metrics — not just "is it up"     |
| Manual or automated promotion?                                        | Manual for early adoption; automated (progressive delivery tooling) once thresholds are well understood |
| Is a canary split by request or by user?                                | Infrastructure-level canary = by request; feature flags = can target by user |

**Bottom line:** a canary deployment's value comes entirely from
actually watching the right metrics during the hold — without that, it's
just a slower rolling update. Scale the canary's traffic share to the
service's actual volume so the comparison is statistically meaningful,
not noise.
