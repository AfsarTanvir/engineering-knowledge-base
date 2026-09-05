# Health Checks

A health check answers one question a load balancer or orchestrator asks
constantly: "is this instance able to serve traffic right now?" Every
deployment strategy in this folder — [rolling updates](rolling-updates.md),
[blue-green](blue-green-deployment.md), [canary](canary-deployment.md) —
depends entirely on health checks being accurate, because they're the
signal that decides whether traffic shifts forward or a rollout halts.

## Table of Contents

1. [Liveness vs Readiness](#liveness-vs-readiness)
2. [Startup Probes](#startup-probes)
3. [What a Health Check Should Actually Verify](#what-a-health-check-should-actually-verify)
4. [Kubernetes Probe Configuration](#kubernetes-probe-configuration)
5. [Load Balancer Health Checks](#load-balancer-health-checks)
6. [The Cascading Failure Trap](#the-cascading-failure-trap)
7. [Quick Reference](#quick-reference)

---

## Liveness vs Readiness

These answer two different questions, and conflating them is one of the
most common health-check mistakes:

- **Liveness: "is the process still alive/functioning, or should it be
  restarted?"** A failing liveness check means something is broken badly
  enough that a restart is the right fix (deadlock, unrecoverable state).
- **Readiness: "is this instance currently able to handle a new
  request?"** A failing readiness check means "temporarily don't send me
  traffic" — not "restart me." A instance still warming up, or briefly
  overloaded, is unready but not dead.

```
Liveness fails   -> orchestrator restarts the instance
Readiness fails  -> orchestrator/load balancer stops sending it traffic,
                     but leaves the process running (it might recover on its own)
```

**Using a liveness check where you meant readiness is a real production
mistake:** if a liveness probe fails because a downstream dependency
(the database) is briefly slow, restarting the app doesn't fix the
database — it just adds restart churn on top of an already-degraded
dependency, potentially making things worse.

## Startup Probes

Some applications take a while to initialize (loading a large model,
warming a cache) — long enough that a normal liveness check would judge
them dead before they've even finished starting. A startup probe gives
extra grace time specifically for the initial boot, before liveness/
readiness checks even begin evaluating:

```
Container starts
  -> startup probe runs (generous timeout, e.g. up to 5 minutes)
  -> once startup probe succeeds ONCE, liveness/readiness probes take over
```

Without this, a slow-starting app can get killed and restarted
repeatedly before it ever finishes booting — an infinite restart loop
caused entirely by an impatient liveness check, not an actual problem
with the app.

## What a Health Check Should Actually Verify

A health endpoint that only checks "is the process running and able to
respond at all" misses the more common real failure: the process is up,
but a critical dependency isn't reachable.

```python
# Weak: only proves the web server itself is responding
@app.route("/healthz")
def health():
    return "ok", 200

# Better: actually verifies the dependencies this instance needs to function
@app.route("/healthz")
def health():
    if not db.ping():
        return "database unreachable", 503
    if not redis.ping():
        return "cache unreachable", 503
    return "ok", 200
```

**Be careful about scope, though** — a readiness check that fails
whenever *any* downstream dependency is degraded can take down every
single instance simultaneously if that dependency has a shared outage,
even though the instances themselves are fine. Distinguish "a dependency
this specific request path needs is down" from "a dependency literally
nothing works without is down," and only fail readiness for the latter.

## Kubernetes Probe Configuration

```yaml
spec:
  containers:
    - name: app
      image: myapp:1.0
      livenessProbe:
        httpGet:
          path: /healthz/live
          port: 8000
        initialDelaySeconds: 10
        periodSeconds: 10
        failureThreshold: 3       # 3 consecutive failures before restarting

      readinessProbe:
        httpGet:
          path: /healthz/ready
          port: 8000
        periodSeconds: 5
        failureThreshold: 2        # fails faster than liveness — pull from traffic sooner

      startupProbe:
        httpGet:
          path: /healthz/live
          port: 8000
        failureThreshold: 30        # generous — 30 * periodSeconds of startup grace time
        periodSeconds: 10
```

Having **separate endpoints** for liveness and readiness (`/healthz/live`
vs `/healthz/ready`) lets them check genuinely different things — liveness
can be as simple as "is the process not deadlocked," readiness can check
real dependencies, without one implementation trying to serve both
purposes awkwardly.

## Load Balancer Health Checks

The same liveness/readiness distinction shows up as
[load-balancing.md's health check discussion](../../system-design/foundational/load-balancing.md#health-checks) —
an unhealthy target gets pulled from rotation without necessarily being
killed:

```yaml
# AWS ALB target group
health_check:
  path: /healthz/ready
  interval_seconds: 10
  healthy_threshold: 2
  unhealthy_threshold: 3
```

Threshold tuning is the same trade-off in both contexts: too sensitive
pulls an instance over one transient blip; too lax keeps sending traffic
to a genuinely broken instance for too long.

## The Cascading Failure Trap

A readiness check failing under load can create a feedback loop that
makes the outage worse: instance A gets marked unready due to high
latency → traffic shifts to instances B and C → B and C now handle more
load than before → B and C also become slow and unready → eventually
every instance is unready and there's nowhere left to route traffic.

```
Instance A slow -> marked unready -> traffic shifts to B, C
B, C now handle A's share too -> B, C also become slow -> marked unready
-> ALL instances unready -> total outage, caused by the health check
   reacting correctly to a problem that then got worse because of the reaction
```

**Mitigations:** readiness thresholds that account for genuine capacity
limits rather than instantaneous latency spikes, circuit breakers (see
[circuit-breakers-and-retries.md](../../system-design/reliability/circuit-breakers-and-retries.md))
on the calls actually causing the slowness, and enough headroom
(replica count, autoscaling) that losing one instance's capacity doesn't
immediately overload the rest.

---

## Quick Reference

| Question                                                  | Answer                                                  |
| :---------------------------------------------------------------- | :-------------------------------------------------------------- |
| Process is deadlocked/unrecoverable — restart or just skip traffic?  | Liveness — restart it                                              |
| Process is fine but a dependency is temporarily unreachable          | Readiness — skip traffic, don't restart                              |
| App takes a long time to initialize                                  | Startup probe with generous grace time                                |
| What should a readiness check actually verify?                        | Dependencies this instance genuinely can't function without           |
| Load shifting away from a slow instance is making things worse         | Watch for cascading failure — add capacity/circuit breakers, not just stricter thresholds |

**Bottom line:** liveness answers "should this be restarted," readiness
answers "should this get traffic right now" — conflating them causes
either needless restart loops or continued traffic to a broken instance.
Every rollout strategy that follows in this folder relies on readiness
being accurate to decide whether it's safe to proceed.
