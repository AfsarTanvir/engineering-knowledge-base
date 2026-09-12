# Rate Limiting

Rate limiting caps how many requests a client can make in a given window,
protecting a service from being overwhelmed — whether by a genuine traffic
spike, a buggy retry loop, or a deliberate abuse attempt. Which algorithm
you pick determines how strictly "requests per second" is enforced versus
how much burst traffic it tolerates.

## Table of Contents

1. [Fixed Window](#fixed-window)
2. [Sliding Window Log](#sliding-window-log)
3. [Sliding Window Counter](#sliding-window-counter)
4. [Token Bucket](#token-bucket)
5. [Leaky Bucket](#leaky-bucket)
6. [Distributed Rate Limiting](#distributed-rate-limiting)
7. [Where to Enforce It](#where-to-enforce-it)
8. [Responding to Limited Requests](#responding-to-limited-requests)
9. [Quick Reference](#quick-reference)

---

## Fixed Window

Count requests in a fixed time bucket (e.g., "this calendar minute"); reset
the counter to zero when the window rolls over.

```python
def is_allowed(user_id, limit=100, window_seconds=60):
    window = int(time.time() // window_seconds)
    key = f"rate:{user_id}:{window}"

    count = redis.incr(key)
    if count == 1:
        redis.expire(key, window_seconds)

    return count <= limit
```

**Simple and cheap**, but has a boundary problem: a client can send
`limit` requests in the last moment of one window and another `limit`
requests in the first moment of the next — up to **2x the intended rate**
in a short burst spanning the boundary.

```
Window 1 [00:00-00:59]: 100 requests at 00:00:59
Window 2 [01:00-01:59]: 100 requests at 01:00:00
-> 200 requests in ~1 second, despite a "100/min" limit
```

## Sliding Window Log

Fixes the boundary problem by tracking the exact timestamp of every
request within the trailing window, not a fixed bucket:

```python
def is_allowed(user_id, limit=100, window_seconds=60):
    now = time.time()
    key = f"rate:{user_id}"

    redis.zadd(key, {str(now): now})
    redis.zremrangebyscore(key, 0, now - window_seconds)  # drop entries outside the window

    count = redis.zcard(key)
    return count <= limit
```

**Precise** — no boundary burst issue, the window always slides with the
current request. **Trade-off:** stores one entry per request per client,
which gets memory-expensive at high request volumes or many tracked
clients.

## Sliding Window Counter

A practical middle ground: keep fixed-window counters (cheap), but weight
the previous window's count by how much it overlaps with the current
sliding window — approximates the sliding log's accuracy without storing
every timestamp.

```python
def is_allowed(user_id, limit=100, window_seconds=60):
    now = time.time()
    current_window = int(now // window_seconds)
    previous_window = current_window - 1
    elapsed_in_current = now % window_seconds

    current_count = int(redis.get(f"rate:{user_id}:{current_window}") or 0)
    previous_count = int(redis.get(f"rate:{user_id}:{previous_window}") or 0)

    # Weight the previous window by how much of it still overlaps the sliding window
    weighted = previous_count * (1 - elapsed_in_current / window_seconds) + current_count

    if weighted >= limit:
        return False

    redis.incr(f"rate:{user_id}:{current_window}")
    redis.expire(f"rate:{user_id}:{current_window}", window_seconds * 2)
    return True
```

**Good default** for most APIs — much better boundary behavior than fixed
window, far cheaper than storing a full request log.

---

## Token Bucket

A bucket holds up to `capacity` tokens; each request consumes one token;
tokens refill at a steady rate over time. Requests are allowed as long as
a token is available — this naturally allows short bursts (spend
accumulated tokens fast) while enforcing a steady average rate over time.

```python
class TokenBucket:
    def __init__(self, capacity, refill_rate):
        self.capacity = capacity
        self.tokens = capacity
        self.refill_rate = refill_rate  # tokens per second
        self.last_refill = time.time()

    def is_allowed(self):
        now = time.time()
        elapsed = now - self.last_refill
        self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
        self.last_refill = now

        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False

# capacity=100, refill_rate=10/sec -> average 10 req/s, but can burst up to 100 instantly
bucket = TokenBucket(capacity=100, refill_rate=10)
```

**Good for:** APIs that want to tolerate legitimate bursts (a user
loading a dashboard that fires 20 requests at once) while still capping
the sustained average — this is what most public API rate limiters
(Stripe, GitHub) use conceptually.

---

## Leaky Bucket

Conceptually the inverse of token bucket: requests fill a bucket (queue),
and they're processed ("leak out") at a fixed, steady rate regardless of
how bursty the input was. Excess requests beyond bucket capacity are
dropped/rejected rather than processed early.

```python
class LeakyBucket:
    def __init__(self, capacity, leak_rate):
        self.capacity = capacity
        self.queue = collections.deque()
        self.leak_rate = leak_rate  # processed per second
        self.last_leak = time.time()

    def is_allowed(self):
        now = time.time()
        elapsed = now - self.last_leak
        leaked = int(elapsed * self.leak_rate)
        for _ in range(min(leaked, len(self.queue))):
            self.queue.popleft()
        self.last_leak = now

        if len(self.queue) < self.capacity:
            self.queue.append(now)
            return True
        return False
```

**Difference from token bucket:** token bucket allows bursts through
immediately (spend saved-up tokens all at once); leaky bucket smooths
bursts out into a steady output rate regardless of input pattern. Reach
for leaky bucket when the *downstream* system needs a strictly steady
rate (e.g., protecting a fixed-capacity backend); reach for token bucket
when you want to tolerate legitimate burstiness from the client side.

---

## Distributed Rate Limiting

A single server can rate-limit with an in-memory counter. The moment
there's more than one server behind a load balancer, an in-memory counter
is wrong — a client hitting 3 different servers gets 3x their intended
limit, since each server only sees its own slice of traffic.

**Fix: centralize the counter** in a shared store (Redis is the standard
choice) so every server checks and increments the same count:

```python
def is_allowed(user_id, limit=100, window_seconds=60):
    window = int(time.time() // window_seconds)
    key = f"rate:{user_id}:{window}"

    # INCR + EXPIRE must be atomic across concurrent requests from different
    # servers — use a Lua script or Redis's built-in atomicity per command
    count = redis.incr(key)
    if count == 1:
        redis.expire(key, window_seconds)
    return count <= limit
```

For high-throughput systems where a Redis round-trip per request is too
slow, some teams shard the limit across servers (each server gets
`limit / num_servers` locally) — trades strict accuracy for lower latency
and no shared-state dependency, at the cost of the limit being
approximate under uneven traffic distribution.

---

## Where to Enforce It

- **API gateway / load balancer** (e.g., NGINX, Kong, AWS API Gateway) —
  stops abusive traffic before it reaches any application server; the
  right place for a coarse, global limit
- **Application middleware** — needed when the limit depends on
  business logic the gateway doesn't know (per-user plan tier, per-feature
  quotas)
- **Database/downstream-protecting layer** — a stricter internal limit
  protecting a specific expensive resource (e.g., a heavy report-generation
  endpoint), independent of the general API limit

Layering is normal: a generous gateway-level limit catches gross abuse,
while a stricter application-level limit protects specific expensive
operations.

## Responding to Limited Requests

Return `429 Too Many Requests`, and tell the client when to retry —
guessing forces clients into inefficient retry loops that make the
problem worse:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 30
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1717200000
```

`Retry-After` and the `X-RateLimit-*` headers (a de facto standard, not
formally universal) let well-behaved clients back off correctly instead
of hammering the endpoint again immediately.

---

## Quick Reference

| Algorithm               | Burst handling                       | Memory cost                  | Boundary accuracy       |
| :-------------------------- | :----------------------------------------- | :------------------------------- | :--------------------------- |
| Fixed window                 | Can allow up to 2x limit at window edges     | Very low (one counter)              | Poor                           |
| Sliding window log            | Exact                                        | High (one entry per request)         | Perfect                         |
| Sliding window counter        | Close approximation                          | Low (two counters)                   | Good                            |
| Token bucket                  | Allows saved-up bursts through immediately    | Low                                   | Good, burst-friendly             |
| Leaky bucket                  | Smooths bursts to a steady output rate         | Low-medium (queue size)               | Good, burst-suppressing          |

**Bottom line:** fixed window is fine for coarse, low-stakes limits;
sliding window counter is the practical default for most APIs; reach for
token bucket when you want to tolerate legitimate client bursts, and leaky
bucket when a downstream system needs a strictly steady processing rate.
Whatever you pick, centralize the counter in something like Redis the
moment you have more than one server.
