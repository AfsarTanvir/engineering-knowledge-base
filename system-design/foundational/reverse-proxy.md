# Reverse Proxy

A reverse proxy sits in front of one or more backend servers and forwards
client requests to them, returning the backend's response back to the
client as if the proxy itself had handled it. The client never talks to
the backend directly — it only ever sees the proxy. A load balancer (see
[load-balancing.md](load-balancing.md)) is one specific job a reverse
proxy can do; a reverse proxy does several others too.

## Table of Contents

1. [Reverse Proxy vs Forward Proxy](#reverse-proxy-vs-forward-proxy)
2. [What a Reverse Proxy Actually Does](#what-a-reverse-proxy-actually-does)
3. [TLS Termination](#tls-termination)
4. [Request Routing](#request-routing)
5. [Hiding and Protecting the Origin](#hiding-and-protecting-the-origin)
6. [Reverse Proxy vs Load Balancer vs API Gateway](#reverse-proxy-vs-load-balancer-vs-api-gateway)
7. [Common Implementations](#common-implementations)
8. [Quick Reference](#quick-reference)

---

## Reverse Proxy vs Forward Proxy

The direction of "who it's hiding" is the whole distinction:

```
Forward proxy: hides the CLIENT from the server
  [ Client ] -> [ Forward Proxy ] -> [ Server ]
  (server sees the proxy's IP, not the client's — e.g., a corporate proxy,
   or a VPN)

Reverse proxy: hides the SERVER from the client
  [ Client ] -> [ Reverse Proxy ] -> [ Backend Server ]
  (client sees the proxy's address, never talks to the backend directly)
```

A forward proxy works on behalf of clients reaching out to many
destinations; a reverse proxy works on behalf of servers receiving
requests from many clients. Nearly everything a client-facing web
application uses in front of its backend is a reverse proxy.

## What a Reverse Proxy Actually Does

A single reverse proxy commonly handles several distinct jobs at once —
worth naming separately even though one piece of software (NGINX,
HAProxy, Envoy) usually does all of them together:

- **TLS termination** — decrypt HTTPS at the proxy, talk plain HTTP to
  the backend
- **Load balancing** — distribute requests across multiple backend
  instances (see [load-balancing.md](load-balancing.md) for the
  algorithms)
- **Request routing** — send different paths/hosts to different backend
  services
- **Caching** — serve a cached response without hitting the backend at
  all (see [caching-strategies.md](caching-strategies.md))
- **Compression** — gzip/brotli responses before sending them to the
  client, offloading that CPU work from the backend
- **Security filtering** — block malicious requests, rate-limit abusive
  clients, hide backend server details from the outside world

## TLS Termination

Handling HTTPS certificates and encryption/decryption at every backend
instance is repetitive and operationally annoying — centralizing it at
the reverse proxy means backends just speak plain HTTP internally:

```nginx
server {
    listen 443 ssl;
    ssl_certificate     /etc/ssl/certs/example.com.crt;
    ssl_certificate_key /etc/ssl/private/example.com.key;

    location / {
        proxy_pass http://backend_pool;   # plain HTTP from here on
    }
}
```

```
Client --(HTTPS, encrypted)--> [ Reverse Proxy: decrypts here ] --(plain HTTP)--> Backend
```

This is safe within a trusted internal network (a private VPC, a
sandboxed cluster network) — it's not safe if that internal hop crosses
an untrusted network, in which case you'd re-encrypt for that segment too
(sometimes called TLS re-encryption, common inside a service mesh).

## Request Routing

Route different paths or hostnames to entirely different backend
services — the same mechanism used to incrementally migrate a monolith
(see [monolith-vs-microservices.md](monolith-vs-microservices.md#the-strangler-fig-pattern)):

```nginx
location /api/orders/ {
    proxy_pass http://orders-service;
}
location /api/users/ {
    proxy_pass http://users-service;
}
location / {
    proxy_pass http://legacy-monolith;   # everything else still goes to the old app
}
```

```nginx
# Route by hostname instead of path
server {
    server_name api.example.com;
    location / { proxy_pass http://api-backend; }
}
server {
    server_name admin.example.com;
    location / { proxy_pass http://admin-backend; }
}
```

## Hiding and Protecting the Origin

Since clients only ever see the proxy, the actual backend server's IP
address, software version, and internal topology stay hidden — an
attacker probing your public-facing address learns nothing about what's
actually running behind it:

```nginx
proxy_hide_header X-Powered-By;    # strip identifying headers before responding
proxy_hide_header Server;

# Cap request size to blunt large-payload abuse before it reaches the backend
client_max_body_size 10M;
```

This is also where a first layer of abuse protection typically lives —
basic rate limiting (see [rate-limiting.md](rate-limiting.md)) or
connection limits at the proxy stop a lot of naive abuse before it ever
reaches application code:

```nginx
limit_req_zone $binary_remote_addr zone=basic:10m rate=10r/s;
location / {
    limit_req zone=basic burst=20;
    proxy_pass http://backend_pool;
}
```

---

## Reverse Proxy vs Load Balancer vs API Gateway

These three terms overlap heavily in practice because the same software
often implements all three — but they describe different *concerns*:

- **Reverse proxy** — the general concept: sits in front of backends,
  forwards requests, hides the origin. The umbrella term.
- **Load balancer** — a reverse proxy specifically distributing requests
  across *multiple interchangeable instances* of the same service, using
  an algorithm (round robin, least connections, etc.)
- **API gateway** — a reverse proxy specifically for APIs, adding
  API-level concerns (auth, per-client rate limiting, request/response
  transformation, routing to *different* services by capability, not
  just distributing load across copies of one). See
  [api-gateway.md](api-gateway.md) for the full breakdown.

A single NGINX config can do plain reverse-proxying, load balancing
across a pool, and basic routing all at once — the distinction is about
which specific job a given config block is doing, not which separate
piece of software you need for each.

## Common Implementations

| Tool          | Notes                                                            |
| :---------------- | :-------------------------------------------------------------------- |
| NGINX               | Most common general-purpose reverse proxy; also does load balancing, caching |
| HAProxy             | Focused heavily on load balancing and high-throughput TCP/HTTP proxying    |
| Envoy               | Built for microservices/service-mesh use; strong observability, retries, circuit breaking built in |
| Traefik             | Auto-discovers backend services (e.g., via Docker/Kubernetes labels), popular in containerized setups |
| Cloud-managed (ALB, Cloud Load Balancing) | Handles TLS termination, routing, and scaling as a managed service |

---

## Quick Reference

| Need                                                     | Feature                                    |
| :-------------------------------------------------------------- | :------------------------------------------------ |
| Decrypt HTTPS once instead of on every backend instance             | TLS termination                                     |
| Send different paths/hosts to different services                     | Request routing                                      |
| Spread requests across multiple copies of the same service           | Load balancing (a specific reverse-proxy job)          |
| Hide backend server details from the public internet                  | Header stripping, no direct backend exposure            |
| Block abusive traffic before it reaches application code               | Rate limiting / connection limits at the proxy layer     |

**Bottom line:** almost every production web service sits behind a
reverse proxy, usually without a team explicitly deciding to add one —
TLS termination and basic routing alone justify it. Load balancing and
API gateway functionality are specific jobs layered on top of the same
underlying reverse-proxy pattern.
