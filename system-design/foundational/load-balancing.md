# Load Balancing

A load balancer sits between clients and a pool of servers, deciding
which server handles each request. The two decisions that matter most:
which layer it operates at (how much it understands about the traffic),
and which algorithm it uses to pick a server. Get either wrong and you
either bottleneck traffic unnecessarily or send requests to servers that
are already overloaded or dead.

## Table of Contents

1. [L4 vs L7 Load Balancing](#l4-vs-l7-load-balancing)
2. [Load Balancing Algorithms](#load-balancing-algorithms)
3. [Health Checks](#health-checks)
4. [Session Affinity (Sticky Sessions)](#session-affinity-sticky-sessions)
5. [Where the Load Balancer Itself Lives](#where-the-load-balancer-itself-lives)
6. [Quick Reference](#quick-reference)

---

## L4 vs L7 Load Balancing

**Layer 4 (transport layer)** — routes based on IP address and port only,
without looking at the actual request content. Fast, because it doesn't
need to parse anything above TCP/UDP.

```
Client -> [L4 LB] -> routes based on TCP connection (IP:port) -> Server
          (never inspects HTTP headers, paths, or cookies)
```

**Layer 7 (application layer)** — understands the actual protocol (HTTP,
gRPC), so it can route based on URL path, headers, cookies, or request
content. Slower per-request (has to parse the request), but far more
flexible:

```
Client -> [L7 LB] -> reads request: GET /api/orders, Host: api.example.com
                   -> routes to the "orders-service" pool specifically
                   -> a request to /api/users would route elsewhere
```

```nginx
# L7 example: routing by path (NGINX)
location /api/orders/ {
    proxy_pass http://orders-service-pool;
}
location /api/users/ {
    proxy_pass http://users-service-pool;
}
```

**Use L4** when you just need raw throughput across identical backends
(e.g., a TCP-level database proxy, or when every server can handle any
request identically). **Use L7** the moment routing needs to depend on
what the request actually contains — microservice path-based routing,
A/B testing by cookie, or blue/green deploys by header.

---

## Load Balancing Algorithms

**Round robin** — cycle through servers in order, one request each:

```
Request 1 -> Server A
Request 2 -> Server B
Request 3 -> Server C
Request 4 -> Server A (cycle repeats)
```

Simple, and fine when all servers have equal capacity and requests are
roughly equal cost. Breaks down when either assumption is false — a
server that's twice as powerful gets the same share as a weaker one.

**Weighted round robin** — same idea, but servers with more capacity get
proportionally more requests:

```python
servers = [("A", weight=3), ("B", weight=1)]
# A receives 3 requests for every 1 that B receives
```

**Least connections** — route to whichever server currently has the
fewest active connections. Adapts to uneven request duration
automatically — a server stuck on a few slow requests naturally receives
fewer new ones:

```python
def pick_server(servers):
    return min(servers, key=lambda s: s.active_connections)
```

**IP hash** — hash the client's IP to consistently pick the same server
for that client (a simple form of session affinity — see
[consistent-hashing.md](../reliability/consistent-hashing.md) for the
version of this that handles pool resizing gracefully):

```python
server_index = hash(client_ip) % len(servers)
```

**Least response time** — route to the server with the best combination
of low active connections and low recent response latency; more adaptive
than least-connections alone, at the cost of needing to track latency
metrics per server.

**Random (with two choices)** — pick two servers at random and route to
whichever has fewer active connections. Surprisingly close to full
least-connections accuracy with far less coordination overhead — a
common choice in very large pools where checking every server's load
per-request doesn't scale.

---

## Health Checks

An algorithm is only as good as its view of which servers are actually
alive. Load balancers periodically probe each backend and stop routing
to ones that fail:

```yaml
# Example: AWS ALB target group health check config
health_check:
  path: /healthz
  interval_seconds: 10
  timeout_seconds: 5
  healthy_threshold: 2     # 2 consecutive successes to mark healthy
  unhealthy_threshold: 3   # 3 consecutive failures to mark unhealthy
```

**Passive health checks** infer health from real traffic (e.g., a server
that's returned 5xx for the last N requests gets pulled), avoiding extra
probe traffic but reacting slightly slower since it needs real requests
to fail first.

**A `/healthz` endpoint should check real dependencies**, not just "is the
process running" — a server that's up but can't reach its database is
not actually healthy, and returning 200 anyway sends live traffic into a
guaranteed failure.

```python
@app.route("/healthz")
def health_check():
    if not db.ping():
        return "unhealthy", 503
    return "ok", 200
```

**Threshold tuning matters:** too sensitive (1 failure = unhealthy) pulls
servers over a single transient blip; too lax (10 failures) keeps sending
traffic to a genuinely dead server for too long.

---

## Session Affinity (Sticky Sessions)

Some applications store session state in server memory rather than a
shared store — if a client's second request lands on a different server,
that server has no idea who they are. Sticky sessions pin a client to the
same server for the duration of their session:

```nginx
# NGINX: cookie-based sticky sessions
upstream backend {
    server server_a.internal;
    server server_b.internal;
    hash $cookie_session_id consistent;
}
```

**Trade-off:** sticky sessions undermine even load distribution (a server
holding many long-lived "sticky" clients can't shed that load to others)
and complicate scaling (removing a server strands its stuck clients).

**Prefer externalizing session state** (Redis, a shared cache — see
[caching-strategies.md](caching-strategies.md)) over sticky sessions where
possible — it lets any server handle any request, which is what makes
load balancing actually work as intended.

---

## Where the Load Balancer Itself Lives

A single load balancer is a single point of failure — if it dies, so does
routing to the entire pool behind it. Production setups typically run:

- **DNS-based distribution** across multiple load balancer instances
  (e.g., Route 53 weighted/failover routing to multiple ALBs)
- **A floating/virtual IP** (keepalived, VRRP) that fails over to a
  standby load balancer if the active one goes down
- **A managed load balancer service** (AWS ALB/NLB, GCP Load Balancer)
  where the provider handles the load balancer's own redundancy — the
  practical default for most teams, since building this yourself
  duplicates what the cloud provider already solved

---

## Quick Reference

| Need                                                | Choice                                  |
| :------------------------------------------------------- | :------------------------------------------- |
| Route based on IP/port only, maximum throughput             | L4                                            |
| Route based on URL path, headers, cookies                    | L7                                            |
| All servers equal capacity, equal-cost requests               | Round robin                                    |
| Servers have different capacities                            | Weighted round robin                            |
| Requests vary a lot in processing time                       | Least connections                               |
| Very large pool, minimal per-request coordination             | Random with two choices                         |
| Need the same client to always hit the same server            | IP hash, or sticky sessions (prefer avoiding this) |

**Bottom line:** default to L7 with least-connections for most HTTP
services — it adapts well to uneven request cost without extra
configuration. Reach for L4 when you need raw speed and backends are
truly interchangeable, and avoid sticky sessions in favor of externalized
session state whenever you can.
