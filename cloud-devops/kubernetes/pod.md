# Kubernetes Pod

A Pod is the smallest deployable unit in Kubernetes — not a container
itself, but a wrapper around one or more containers that need to run
together, share the same network address, and be scheduled onto the same
node as a single unit. You almost never create a bare Pod directly in
production; understanding what it actually is makes
[Deployment](deployment.md) and [Service](service.md) make sense.

## Table of Contents

1. [Why Not Just Run Containers Directly?](#why-not-just-run-containers-directly)
2. [What's Inside a Pod](#whats-inside-a-pod)
3. [Multi-Container Pods](#multi-container-pods)
4. [Pods Are Ephemeral](#pods-are-ephemeral)
5. [Resource Requests and Limits](#resource-requests-and-limits)
6. [Basic Commands](#basic-commands)
7. [Quick Reference](#quick-reference)

---

## Why Not Just Run Containers Directly?

Docker runs individual containers ([image-vs-container.md](../docker/image-vs-container.md)
covers what a container actually is). Kubernetes needed a unit one level
up — because some containers genuinely need to be scheduled and scaled
together, always on the same machine, sharing network and storage. The
Pod is that unit.

```
Pod
  ├── Container: app          (the main application)
  └── Container: log-shipper   (reads app's logs, ships them elsewhere)
  -- both always scheduled on the same node, share the same IP/localhost,
     and can share mounted volumes
```

Most Pods have exactly one container — the multi-container case (below)
is the exception, not the default.

## What's Inside a Pod

- **One or more containers**, sharing the Pod's network namespace — they
  can reach each other over `localhost`, and the Pod itself gets one IP
  address shared by every container in it
- **Shared storage** (if configured) — volumes defined at the Pod level
  that any of its containers can mount
- **A single scheduling decision** — Kubernetes places the whole Pod on
  one node; you can't split a Pod's containers across different nodes

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-app
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
        limits:
          cpu: "500m"
          memory: "512Mi"
```

```bash
kubectl apply -f pod.yaml
kubectl get pods
kubectl describe pod my-app
kubectl logs my-app
```

## Multi-Container Pods

Multiple containers belong in the same Pod specifically when they're
tightly coupled and need to be co-located — common patterns:

- **Sidecar** — a helper container extending the main one (a log
  shipper, a metrics exporter reading from the main app)
- **Ambassador** — a proxy container handling network communication on
  behalf of the main app (e.g., a local proxy to a remote database,
  simplifying the app's own connection logic)
- **Init container** — runs to completion *before* the main containers
  start, for one-time setup (e.g., waiting for a dependency to be ready,
  running a database migration)

```yaml
spec:
  initContainers:
    - name: wait-for-db
      image: busybox
      command: ['sh', '-c', 'until nc -z db 5432; do sleep 1; done']
  containers:
    - name: app
      image: myapp:1.0
    - name: log-shipper
      image: fluentd:latest
```

If two containers *don't* need to share a network namespace or scale
together, they generally belong in separate Pods, not bundled into one —
bundling unrelated containers removes Kubernetes' ability to scale or
restart them independently.

## Pods Are Ephemeral

A Pod is not meant to be durable — it can be deleted and rescheduled
(a new Pod, a new IP, a new name) for many reasons: a node fails, the
Pod is evicted for resource pressure, or you deploy a new version. This
is exactly why you don't manage Pods directly in production — you use a
[Deployment](deployment.md) to declare "I want N of these running," and
let Kubernetes handle creating replacement Pods as needed, and a
[Service](service.md) to give a stable address that survives any
individual Pod being replaced.

```
Pod "my-app-7d9f8-x2k1p" dies (node failure)
-> Deployment notices the replica count dropped below desired
-> Deployment creates a NEW Pod: "my-app-7d9f8-m8j2q" (different name, different IP)
-> Service automatically routes to the new Pod — clients never knew the old one existed
```

## Resource Requests and Limits

Every container should declare what it needs (`requests`, used for
scheduling decisions) and the maximum it's allowed to use (`limits`,
enforced at runtime):

```yaml
resources:
  requests:
    cpu: "250m"       # 0.25 CPU core — the scheduler won't place this Pod
    memory: "256Mi"    # on a node that can't guarantee this much is available
  limits:
    cpu: "500m"        # hard cap — throttled if it tries to use more
    memory: "512Mi"     # hard cap — the container is OOM-killed if it exceeds this
```

**Omitting these is a common production mistake** — without limits, one
misbehaving Pod can starve every other Pod on the same node of CPU/memory.
Without requests, the scheduler has no basis for deciding which node has
room for a new Pod, and can overpack a node.

## Basic Commands

```bash
kubectl get pods                       # list Pods in the current namespace
kubectl get pods -o wide                # include node and IP info
kubectl describe pod <name>              # detailed status, events, recent errors
kubectl logs <name>                      # view a Pod's container logs
kubectl logs <name> -c <container_name>  # for multi-container Pods, specify which one
kubectl exec -it <name> -- bash          # shell into a running Pod's container
kubectl delete pod <name>                # delete — a Deployment will recreate it if managed by one
```

---

## Quick Reference

| Question                                              | Answer                                              |
| :------------------------------------------------------------ | :--------------------------------------------------------- |
| What's the smallest deployable unit in Kubernetes?               | The Pod (not a bare container)                                 |
| Do containers in the same Pod share a network address?           | Yes — same IP, reachable via `localhost` to each other            |
| Can a Pod's containers run on different nodes?                    | No — always scheduled together, on one node                         |
| Should I create Pods directly in production?                       | No — use a [Deployment](deployment.md) to manage them                |
| How do I give a Pod a stable network address?                       | Use a [Service](service.md) — Pod IPs change when Pods are replaced   |

**Bottom line:** a Pod wraps one or more containers that must be
scheduled, networked, and scaled as a single unit — usually just one
container. Pods are disposable by design; Deployments and Services exist
specifically to make that disposability invisible to whoever's actually
using the application.
