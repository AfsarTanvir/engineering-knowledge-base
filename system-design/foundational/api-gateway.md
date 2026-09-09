# API Gateway

An API gateway is a [reverse proxy](reverse-proxy.md) purpose-built for
APIs — specifically, for the case where clients (mobile apps, frontends,
third parties) need to talk to a system built from multiple backend
services without knowing or caring how many there are. It's the single
front door that owns cross-cutting API concerns so individual services
don't each have to reimplement them.

## Table of Contents

1. [Why Not Just Call Services Directly?](#why-not-just-call-services-directly)
2. [Core Responsibilities](#core-responsibilities)
3. [Authentication at the Gateway](#authentication-at-the-gateway)
4. [Request Routing](#request-routing)
5. [Rate Limiting Per Client](#rate-limiting-per-client)
6. [Request/Response Transformation](#requestresponse-transformation)
7. [The Backend-for-Frontend (BFF) Variant](#the-backend-for-frontend-bff-variant)
8. [The Single Point of Failure Risk](#the-single-point-of-failure-risk)
9. [Quick Reference](#quick-reference)

---

## Why Not Just Call Services Directly?

In a [microservices](monolith-vs-microservices.md) architecture, a
mobile app rendering one screen might need data from 5 different
services. Without a gateway, the client either makes 5 separate calls
(exposing internal architecture to every client, and forcing every
service to individually handle auth, CORS, rate limiting, TLS) or every
service reimplements the same cross-cutting concerns independently.

```
Without a gateway:
  Mobile App -> Orders Service    (auth check #1, rate limit #1)
             -> Inventory Service (auth check #2, rate limit #2)
             -> Users Service     (auth check #3, rate limit #3)
  -- client needs to know all 3 addresses; each service duplicates auth/rate-limit logic

With a gateway:
  Mobile App -> [ API Gateway ] -> Orders Service
                                 -> Inventory Service
                                 -> Users Service
  -- client only knows the gateway; auth/rate-limit/routing handled once, centrally
```

## Core Responsibilities

- **Single entry point** — clients only need one address; the gateway
  knows how to reach every backend service
- **Authentication/authorization** — verify the caller's identity and
  permissions once, at the edge, rather than in every service
- **Routing** — direct each request to the correct backend service based
  on path, host, or version
- **Rate limiting** — enforce per-client, per-API-key limits (see
  [rate-limiting.md](rate-limiting.md)) centrally instead of per-service
- **Request/response transformation** — reshape data between what
  clients expect and what backend services actually return
- **Observability** — a single place to log, trace, and monitor every
  API request, instead of stitching logs together across services

## Authentication at the Gateway

Rather than every backend service independently validating a JWT or API
key, the gateway validates it once and forwards a trusted, already-
verified identity downstream:

```
Client --(request + JWT)--> [ API Gateway: validates JWT signature/expiry ]
                                    |
                                    v
                          Orders Service (trusts a header the gateway added,
                                           e.g., X-User-Id: 1020 —
                                           doesn't re-verify the JWT itself)
```

```yaml
# Example: Kong gateway plugin config
plugins:
  - name: jwt
    config:
      key_claim_name: kid
      secret_is_base64: false
```

**This only works if backend services are unreachable except through the
gateway** — if a service is also directly reachable on the network, an
attacker can skip the gateway's auth check entirely. Network policy
(private subnets, service mesh mTLS) needs to enforce that the gateway is
genuinely the only path in.

## Request Routing

Route by path, version, or even gradually shift traffic between old and
new service versions — the same routing job a reverse proxy does, but
usually with API-specific conventions like path-based versioning:

```yaml
routes:
  - path: /v1/orders
    service: orders-service-v1
  - path: /v2/orders
    service: orders-service-v2       # new version, different backend
  - path: /users
    service: users-service
```

This is also the mechanism behind the
[strangler fig migration pattern](monolith-vs-microservices.md#the-strangler-fig-pattern) —
the gateway incrementally redirects specific paths from an old monolith
to newly extracted services, entirely transparent to the client.

## Rate Limiting Per Client

A gateway can enforce limits scoped to the actual caller (API key,
authenticated user, IP) rather than a single global limit — the practical
place to apply the per-client rate limiting algorithms from
[rate-limiting.md](rate-limiting.md):

```yaml
plugins:
  - name: rate-limiting
    config:
      minute: 100          # 100 requests/minute per consumer
      policy: redis         # shared counter across gateway instances
```

Centralizing this at the gateway means a single misbehaving client is
capped consistently across every backend service it might call, instead
of each service tracking its own (possibly inconsistent) limit for that
client.

## Request/Response Transformation

Clients (especially older or third-party ones) sometimes need a shape
different from what the backend naturally returns — the gateway can
adapt without changing the backend service itself:

```yaml
# Example: strip an internal field before it reaches external clients
plugins:
  - name: response-transformer
    config:
      remove:
        json: ["internal_debug_id"]
```

Useful for backward compatibility (an old API version's shape, while the
backend has moved on) or for hiding internal implementation details from
external API consumers specifically (as opposed to internal callers).

## The Backend-for-Frontend (BFF) Variant

Instead of one generic gateway serving every client type identically,
a BFF is a dedicated gateway *per client type* (mobile, web, public API),
each shaped around that specific client's needs:

```
Mobile App  -> [ Mobile BFF ]  -> aggregates/shapes data for mobile screens
Web App     -> [ Web BFF ]     -> aggregates/shapes data for web screens
3rd-party   -> [ Public API Gateway ] -> generic, versioned, stable contract
```

Worth it when different client types have genuinely divergent needs
(mobile wants a small, pre-aggregated payload to save bandwidth; a
public API needs strict versioning and backward compatibility) that a
single one-size-fits-all gateway config can't cleanly serve.

## The Single Point of Failure Risk

Every request now passes through the gateway — if it goes down, every
client-facing API goes down with it, regardless of whether the backend
services themselves are healthy. This makes the gateway's own
reliability disproportionately important:

- Run multiple gateway instances behind a load balancer (see
  [load-balancing.md](load-balancing.md)) — never a single gateway
  instance in production
- Keep the gateway itself simple and fast — heavy logic (complex
  aggregation, slow transformations) in the gateway becomes a latency
  and failure multiplier for every single request in the system
- Apply [circuit breakers](../reliability/circuit-breakers-and-retries.md)
  at the gateway for calls to backend services, so one failing service
  doesn't exhaust the gateway's own resources handling doomed requests

---

## Quick Reference

| Need                                                     | Gateway responsibility                          |
| :-------------------------------------------------------------- | :----------------------------------------------------- |
| One address for clients, regardless of backend service count       | Single entry point + routing                              |
| Verify identity once, not in every service                          | Centralized auth/authz                                     |
| Cap abusive clients consistently across all services                 | Per-client rate limiting                                    |
| Different client types need different response shapes                 | Backend-for-Frontend (BFF)                                    |
| Migrate a monolith to services incrementally                          | Path-based routing (strangler fig)                            |
| Gateway itself must never be the weak link                            | Multiple instances behind a load balancer, circuit breakers      |

**Bottom line:** reach for an API gateway once clients need to talk to
more than a couple of backend services and cross-cutting concerns (auth,
rate limiting, routing) start getting duplicated across them. Keep the
gateway itself thin and highly available — it becomes critical
infrastructure the moment it's the only path into the system.
