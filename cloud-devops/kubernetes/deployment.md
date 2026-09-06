# Kubernetes Deployment

A Deployment is a declarative statement: "I want N copies of this Pod
running, always." You don't create or delete Pods by hand — you tell the
Deployment what the desired end state looks like, and a controller
continuously works to make reality match that description, replacing
Pods that die and rolling out changes when you update the desired state.

## Table of Contents

1. [Declarative vs Imperative](#declarative-vs-imperative)
2. [Anatomy of a Deployment](#anatomy-of-a-deployment)
3. [The Reconciliation Loop](#the-reconciliation-loop)
4. [ReplicaSets: The Layer You Don't Usually Touch](#replicasets-the-layer-you-dont-usually-touch)
5. [Rolling Out a New Version](#rolling-out-a-new-version)
6. [Scaling](#scaling)
7. [Rollback](#rollback)
8. [Basic Commands](#basic-commands)
9. [Quick Reference](#quick-reference)

---

## Declarative vs Imperative

**Imperative** (what plain Docker or bare Pods give you): you issue
commands describing *actions* — "start this container," "delete that
one." Nothing keeps happening after the command runs.

**Declarative** (what a Deployment gives you): you describe the *desired
state* — "3 replicas of this Pod spec should exist" — and a controller
running inside Kubernetes continuously reconciles reality toward that
description, indefinitely, without you issuing further commands.

```
Imperative: "start 3 containers" -> if one dies, nothing happens automatically
Declarative: "3 replicas should exist" -> if one dies, the controller notices
             and creates a replacement, automatically, forever
```

## Anatomy of a Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3                    # desired number of Pod copies
  selector:
    matchLabels:
      app: my-app                 # which Pods this Deployment manages
  template:                       # the Pod spec to stamp out N times
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: app
          image: myapp:1.0
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "250m"
              memory: "256Mi"
```

The `template` section is essentially a [Pod](pod.md) spec — a
Deployment's whole job is stamping out `replicas` copies of that
template and keeping that count true over time.

## The Reconciliation Loop

This is the mechanism behind "self-healing" — a continuous background
process, not a one-time action:

```
Every few seconds, the Deployment controller checks:
  "Desired: 3 replicas. Actual: how many matching Pods currently exist?"

  Actual = 3 -> do nothing
  Actual = 2 (one Pod crashed/node died) -> create 1 new Pod
  Actual = 4 (someone manually created an extra Pod with the same labels) -> delete 1
```

This loop runs forever, for the life of the Deployment — it's what makes
"a node failed" a non-event from the application's perspective, as long
as enough capacity exists elsewhere in the cluster to reschedule the
lost Pods.

## ReplicaSets: The Layer You Don't Usually Touch

A Deployment doesn't directly manage Pods — it manages a ReplicaSet,
which is the thing that actually maintains a fixed count of Pods. The
Deployment's extra job on top of a ReplicaSet is managing *transitions
between versions* (the rollout logic below):

```
Deployment "my-app"
  └── ReplicaSet "my-app-7d9f8" (currently active, image: myapp:1.0)
        └── Pod, Pod, Pod (3 replicas)
```

When you update the Deployment's image, it creates a *new* ReplicaSet
(for the new version) and scales the old one down while scaling the new
one up — this transition is what [rolling-updates.md](../deployment-strategies/rolling-updates.md)
covers in detail.

## Rolling Out a New Version

```bash
kubectl set image deployment/my-app app=myapp:2.0
# or: edit the YAML's image field and `kubectl apply -f deployment.yaml`
```

```
Before: ReplicaSet A (myapp:1.0) -> 3 Pods running

During rollout:
  ReplicaSet A (myapp:1.0) -> scaling down: 3 -> 2 -> 1 -> 0
  ReplicaSet B (myapp:2.0) -> scaling up:   0 -> 1 -> 2 -> 3

After: ReplicaSet B (myapp:2.0) -> 3 Pods running
       ReplicaSet A kept around at 0 replicas, for a potential rollback
```

By default this happens gradually (a rolling update), never taking all
replicas down at once — the specific pacing and safety controls
(`maxUnavailable`, `maxSurge`) are covered in
[rolling-updates.md](../deployment-strategies/rolling-updates.md).

## Scaling

```bash
kubectl scale deployment/my-app --replicas=5
```

Or configure the **Horizontal Pod Autoscaler** to adjust replica count
automatically based on observed load, rather than a fixed number:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70   # add replicas if average CPU exceeds 70%
```

This is [horizontal scaling](../../system-design/scale-patterns/horizontal-vs-vertical-scaling.md)
applied automatically — the cluster grows and shrinks the replica count
in response to real load instead of a human adjusting a fixed number.

## Rollback

Because the previous ReplicaSet isn't deleted immediately, undoing a bad
rollout is a single command, not a manual redeploy of the old version:

```bash
kubectl rollout status deployment/my-app     # watch a rollout's progress
kubectl rollout history deployment/my-app     # see past revisions
kubectl rollout undo deployment/my-app        # roll back to the previous revision
kubectl rollout undo deployment/my-app --to-revision=2   # roll back to a specific one
```

## Basic Commands

```bash
kubectl apply -f deployment.yaml       # create or update a Deployment
kubectl get deployments                 # list Deployments and their replica status
kubectl describe deployment my-app       # detailed status, recent events
kubectl delete deployment my-app         # delete the Deployment AND its Pods
```

---

## Quick Reference

| Question                                            | Answer                                                |
| :---------------------------------------------------------- | :----------------------------------------------------------- |
| How do I keep N copies of a Pod running indefinitely?           | A Deployment with `replicas: N`                                  |
| What actually maintains the replica count?                      | A ReplicaSet, managed by the Deployment                            |
| How do I deploy a new version safely?                            | Update the image — the Deployment handles the rolling transition      |
| How do I undo a bad deployment?                                   | `kubectl rollout undo deployment/<name>`                            |
| How do I scale based on real-time load instead of a fixed number?  | Horizontal Pod Autoscaler                                            |

**Bottom line:** a Deployment is the declarative layer that turns "keep
N Pods running" and "roll out this new version safely" into an ongoing,
self-correcting background process instead of a series of manual
commands. It's the standard way to run application Pods in production —
bare Pods (see [pod.md](pod.md)) are the exception, used mainly for
one-off debugging.
