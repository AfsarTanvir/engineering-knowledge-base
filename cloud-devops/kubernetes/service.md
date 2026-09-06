# Kubernetes Service

Pods are disposable — a [Deployment](deployment.md) replaces them
constantly, and every replacement gets a brand-new IP address. A Service
solves the obvious problem that creates: it gives a stable network
address that always routes to whichever Pods are currently healthy,
regardless of how many times they've been individually replaced.

## Table of Contents

1. [The Problem: Pod IPs Are Not Stable](#the-problem-pod-ips-are-not-stable)
2. [How a Service Finds Its Pods](#how-a-service-finds-its-pods)
3. [Service Types](#service-types)
4. [ClusterIP: The Default](#clusterip-the-default)
5. [NodePort](#nodeport)
6. [LoadBalancer](#loadbalancer)
7. [DNS-Based Service Discovery](#dns-based-service-discovery)
8. [Service + Deployment, Together](#service--deployment-together)
9. [Quick Reference](#quick-reference)

---

## The Problem: Pod IPs Are Not Stable

```
Deployment maintains 3 replicas of my-app

Pod "my-app-abc12" -> IP 10.1.2.3
Pod "my-app-def34" -> IP 10.1.2.4
Pod "my-app-ghi56" -> IP 10.1.2.5

-- Pod "my-app-abc12" crashes, gets replaced --

Pod "my-app-xyz99" -> IP 10.1.2.9   (brand new Pod, brand new IP)
```

Anything that hard-coded `10.1.2.3` as "the app" breaks the moment that
Pod is replaced — which, at any real scale, happens constantly (deploys,
node failures, autoscaling). A Service exists so nothing ever needs to
know an individual Pod's IP at all.

## How a Service Finds Its Pods

A Service doesn't point at specific Pods by name or IP — it uses a label
selector, the same mechanism a Deployment uses to know which Pods it
owns. Any Pod matching the selector, from any source, is automatically
included:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-app-service
spec:
  selector:
    app: my-app          # matches any Pod with this label — same as the
                           # Deployment's template labels from deployment.md
  ports:
    - port: 80             # the Service's own port
      targetPort: 8000       # the port the Pod's container actually listens on
```

```
Client -> Service "my-app-service" (stable IP + DNS name)
             |
             +--> routes to whichever Pods currently match `app: my-app`,
                  updated automatically as Pods come and go
```

Kubernetes maintains this Pod list continuously via an internal component
(kube-proxy) — the Service's own address never changes even as its
backing Pods do.

## Service Types

```yaml
spec:
  type: ClusterIP     # default — internal to the cluster only
  type: NodePort       # exposes a port on every node's own IP
  type: LoadBalancer   # provisions an external cloud load balancer
```

## ClusterIP: The Default

An internal-only virtual IP, reachable from anywhere inside the cluster,
but not from outside it. This is what most Services should be — internal
service-to-service communication (e.g., a web app reaching a backend
API) has no reason to be exposed to the public internet.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend-api
spec:
  type: ClusterIP        # (this is also the default if `type` is omitted)
  selector:
    app: backend-api
  ports:
    - port: 80
      targetPort: 8000
```

## NodePort

Opens a specific port (30000-32767 by default) on *every* node in the
cluster, forwarding traffic on that port to the Service. Mostly used as
a building block for other exposure methods, or in simple/on-prem
setups without a cloud load balancer available:

```yaml
spec:
  type: NodePort
  ports:
    - port: 80
      targetPort: 8000
      nodePort: 30080     # reachable at <any-node-ip>:30080
```

## LoadBalancer

On a cloud provider (AWS, GCP, Azure), this type provisions an actual
external load balancer (see
[load-balancing.md](../../system-design/foundational/load-balancing.md))
that routes public internet traffic into the cluster and to this
Service:

```yaml
spec:
  type: LoadBalancer
  selector:
    app: my-app
  ports:
    - port: 80
      targetPort: 8000
```

```bash
kubectl get service my-app-service
# EXTERNAL-IP column shows the cloud load balancer's public address once provisioned
```

For routing multiple services under different paths/hostnames from one
external entry point, an **Ingress** resource sits on top of Services
(usually backed by an NGINX or cloud-native ingress controller) — the
Kubernetes-native equivalent of the
[reverse proxy/API gateway](../../system-design/foundational/api-gateway.md)
pattern, rather than provisioning a separate LoadBalancer Service per
application.

## DNS-Based Service Discovery

Kubernetes automatically assigns every Service a DNS name, resolvable
from any Pod in the cluster — this is the standard way one service finds
another, instead of hardcoding IPs or even the Service's ClusterIP:

```
<service-name>.<namespace>.svc.cluster.local
```

```python
# From inside any Pod in the same cluster
response = requests.get("http://backend-api.default.svc.cluster.local/health")
# or, within the same namespace, the short form works too:
response = requests.get("http://backend-api/health")
```

## Service + Deployment, Together

The two resources are almost always defined side by side — the
Deployment manages the Pods, the Service gives them a stable address:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app          # <- this label...
    spec:
      containers:
        - name: app
          image: myapp:1.0
---
apiVersion: v1
kind: Service
metadata:
  name: my-app-service
spec:
  selector:
    app: my-app               # <- ...is what this selector matches
  ports:
    - port: 80
      targetPort: 8000
```

---

## Quick Reference

| Need                                                  | Service type                             |
| :------------------------------------------------------------ | :---------------------------------------------- |
| Internal-only communication between services in the cluster       | ClusterIP (default)                                |
| Expose a port on every node directly (simple/on-prem setups)        | NodePort                                             |
| Public internet access via a cloud load balancer                    | LoadBalancer                                         |
| Route multiple services by path/host from one public entry point     | Ingress (built on top of Services)                     |
| Find another service without hardcoding an IP                        | Built-in cluster DNS (`<service>.<namespace>.svc.cluster.local`) |

**Bottom line:** a Service is the stable address layer sitting in front
of a Deployment's constantly-churning Pods — it's what makes Pod
replacement invisible to anything trying to reach the application.
Default to ClusterIP for internal traffic, and reach for LoadBalancer or
Ingress only for what genuinely needs to be reachable from outside the
cluster.
