# Headers

Headers are the labels on the envelope. They describe the message without being
the message: who sent it, what format it is in, how long it may be cached, who
is allowed to read it.

Almost every clever thing HTTP does — authentication, caching, compression,
redirects, rate limit signalling, tracing — happens in headers. If you only look
at request bodies, you are reading half the protocol.

> **📌 In one line:** the body is *what* you are sending; the headers are
> everything a machine needs to know *about* it.

## Table of Contents

1. [Labels on the Envelope](#labels-on-the-envelope)
2. [Request Headers the Client Sends](#request-headers-the-client-sends)
3. [Response Headers the Server Sends](#response-headers-the-server-sends)
4. [Headers You Will Set Yourself](#headers-you-will-set-yourself)
5. [The Ones Worth Knowing Well](#the-ones-worth-knowing-well)
6. [Caching with ETag and 304](#caching-with-etag-and-304)
7. [Custom Headers](#custom-headers)
8. [Headers Behind a Proxy](#headers-behind-a-proxy)
9. [Advanced Details](#advanced-details)
10. [Security Headers](#security-headers)
11. [Common Mistakes](#common-mistakes)
12. [Questions to Test Yourself](#questions-to-test-yourself)
13. [Related](#related)

---

## Labels on the Envelope

A courier handles a parcel. On the outside there are stickers: FRAGILE, "deliver
before Friday", the sender's address, a tracking number. The courier never opens
the box — every routing decision comes from the stickers.

HTTP headers are those stickers. Proxies, CDNs, caches and load balancers read
them and act, often without your server ever being involved. A `Cache-Control` header can
mean your server is not called at all for the next hour.

```text
┌───────────────────────────────────────────────┐
│ GET /api/projects/42 HTTP/1.1                 │
│ Host: app.acme.com            ← which site    │
│ Authorization: Bearer eyJ...  ← who I am      │
│ Accept: application/json      ← what I want   │
│ If-None-Match: "a1b2c3"       ← what I have   │  headers
│ Accept-Encoding: gzip         ← what I decode │
├───────────────────────────────────────────────┤
│                                               │  blank line
│ (no body for GET)                             │
└───────────────────────────────────────────────┘
```

---

## Request Headers the Client Sends

| Header | Meaning | Example |
|---|---|---|
| `Host` | Which domain is being asked for | `app.acme.com` |
| `User-Agent` | Which software is calling | `Mozilla/5.0 ...` |
| `Accept` | Formats the client can handle | `application/json` |
| `Authorization` | Credentials | `Bearer eyJhbGciOi...` |
| `Content-Type` | Format of the body being sent | `application/json` |
| `If-None-Match` | "I already have this version" | `"a1b2c3"` |
| `Origin` | Which site the browser script came from | `https://app.acme.com` |
| `X-Request-Id` | Correlation ID supplied by the caller | `7f1c9b2e-...` |

---

## Response Headers the Server Sends

| Header | Meaning | Example |
|---|---|---|
| `Content-Type` | Format of the response body | `application/json; charset=utf-8` |
| `Cache-Control` | Who may cache this, and for how long | `private, max-age=60` |
| `ETag` | Version fingerprint of this resource | `"a1b2c3"` |
| `Location` | Where to go, or where the new thing lives | `/api/projects/42` |
| `Retry-After` | How long to wait before trying again | `60` |
| `Vary` | Which request headers change this response | `Accept-Encoding, Authorization` |

---

## Headers You Will Set Yourself

These are the ones you will actually write in your handlers:

| Header | Set it when | Value |
|---|---|---|
| `Location` | Returning `201`, `301` or `302` | The URL of the new or target resource |
| `Retry-After` | Returning `429` or `503` | Seconds, or an HTTP date |
| `Cache-Control` | Any response that should or should not be cached | `no-store` for private data |
| `ETag` | A resource clients poll often | A hash of the content |
| `Content-Type` | Returning something other than JSON | `text/csv`, `application/pdf` |
| `X-Request-Id` | Always, via middleware | A UUID echoed into every log line |
| `Allow` | Returning `405` | The methods that *are* supported |

```ts
// A small middleware that gives every request a traceable ID.
export default class RequestIdMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    // Reuse the caller's ID if they sent one, so traces span services.
    const id = ctx.request.header('x-request-id') ?? crypto.randomUUID()
    ctx.request.id = id
    ctx.response.header('X-Request-Id', id)
    return next()
  }
}
```

Every log line in that request should include `id`. When a customer reports an
error, you ask for the request ID shown on the error page and find every related
log line instantly. This is the cheapest observability win available.

---

## The Ones Worth Knowing Well

### Content-Type and Accept

`Content-Type` describes the body I am sending. `Accept` describes what I want
back. Both can appear on a request; only `Content-Type` appears on a response.
Full detail in [request-and-response](02-request-and-response.md).

### Authorization

Carries credentials. Two common schemes:

```text
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Authorization: Basic YWRtaW46c2VjcmV0MTIz
```

`Basic` is just `base64(user:password)` — encoded, **not** encrypted. Anyone who
sees it can decode it instantly. Acceptable only over HTTPS, and a token is
better even then.

```ts
const header = request.header('authorization')
// Never trust the shape. Parse defensively.
const token = header?.startsWith('Bearer ') ? header.slice(7) : null
if (!token) return response.unauthorized({ error: 'authentication_required' })
```

### User-Agent

Free text the client chooses. Useful for analytics and for blocking obvious
bots. Never use it for security: anyone can set it to anything.

### Host

One IP address can serve hundreds of domains. `Host` is how the server knows
which site you meant. It is required in HTTP/1.1.

> **⚠️ Warning:** `Host` is attacker-controlled. If you build password-reset
> links from it (`https://${req.headers.host}/reset?token=...`), an attacker can
> send a forged `Host` and receive the victim's reset link. Build absolute URLs
> from configuration, never from the request.

### Cache-Control

Says who may store this response, and for how long.

| Value | Meaning |
|---|---|
| `no-store` | Never write this to any cache. Use for private data |
| `no-cache` | May store, but must revalidate before reusing |
| `private, max-age=60` | Only the browser may cache it, for 60 seconds |
| `public, max-age=31536000, immutable` | Anyone may cache it for a year (hashed assets) |

```ts
// Anything user-specific must not be cached by a shared proxy.
response.header('Cache-Control', 'no-store')
return response.ok(await user.related('invoices').query())
```

Strategy for the server-side half of caching lives in
[caching-strategies](../../system-design/foundational/caching-strategies.md) and
[cdn-and-edge-caching](../../system-design/scale-patterns/cdn-and-edge-caching.md).

### Location

Two jobs, depending on the status code: with `201 Created` it is where the new
resource now lives; with `301` / `302` it is where the client should go instead.

### Retry-After

Seconds to wait, or an HTTP date. Sent with `429` and `503`. Without it clients
guess, and during an overload they usually guess "immediately" — which makes the
overload worse.

### Vary

Tells caches which request headers change the answer. Forget it, and a shared
cache can serve one user's data to another.

```ts
// The response depends on who is asking, so caches must key on that.
response.header('Vary', 'Authorization, Accept-Encoding')
```

---

## Caching with ETag and 304

An `ETag` is a fingerprint of a response's content. The client stores it and
sends it back on the next request. If nothing changed, the server replies `304
Not Modified` with **no body** — saving bandwidth and serialisation time.

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    participant D as Database

    C->>S: GET /api/projects/42
    S->>D: select project 42
    D-->>S: row (updated_at, version)
    S-->>C: 200 OK, ETag "a1b2c3", body 12 KB

    Note over C: stores body + ETag

    C->>S: GET /api/projects/42<br/>If-None-Match: "a1b2c3"
    S->>D: select project 42
    D-->>S: row unchanged
    S-->>C: 304 Not Modified (no body)
    Note over C: reuses its cached copy
```

```ts
async show({ params, request, response }: HttpContext) {
  const project = await Project.findOrFail(params.id)

  // Any value that changes when the content changes works as a fingerprint.
  const etag = `"${project.id}-${project.updatedAt.toMillis()}"`
  response.header('ETag', etag)

  if (request.header('if-none-match') === etag) {
    return response.status(304)   // no body: the client already has it
  }
  return response.ok(project)
}
```

Note what this saves and what it does not. The database query still runs; you
save serialisation and network transfer — most of the cost for a large response
over a mobile connection.

---

## Custom Headers

Sometimes you need to send something HTTP has no header for: a tenant ID, a
feature flag, a pagination cursor.

**The `X-` prefix is discouraged.** RFC 6648 deprecated it in 2012, for a
practical reason: `X-Forwarded-For` and `X-Request-Id` became so widely used
that they are effectively standard, and the `X-` is now a permanent lie about
their status. Renaming a header after adoption breaks every client.

Modern practice: prefix with your product name instead.

```text
Acme-Tenant-Id: 7
Acme-Api-Version: 2025-03-01
Acme-Feature-Flags: new-billing,dark-mode
```

Use a custom header when the value is **metadata about the message**, not for
data that belongs in the body or the URL.

| Good custom header | Belongs elsewhere |
|---|---|
| API version selector | The project's name → body |
| Tenant identifier | A filter like `status=open` → query string |
| Idempotency key | The resource ID → URL path |

> **💡 Tip:** if a browser script needs to read your custom response header, you
> must list it in `Access-Control-Expose-Headers`. Otherwise CORS hides it and
> your frontend sees `null` while `curl` sees the value. See
> [CORS](../11-api-security/03-cors.md).

---

## Headers Behind a Proxy

This is where a real, common production bug lives.

Your app runs behind nginx or a load balancer. The client's TCP connection ends
at the proxy, and a **new** connection goes from the proxy to your app. So
`req.ip` is the proxy's address — identical for every user on earth.

```text
 Real user            Load balancer          Your Node app
 203.0.113.7  ──────▶  10.0.1.5      ──────▶  10.0.2.9:3333
                       adds:                   sees connection
                       X-Forwarded-For:        from 10.0.1.5
                         203.0.113.7           (not the user!)
```

Proxies preserve the original information in headers:

| Header | Carries |
|---|---|
| `X-Forwarded-For` | The original client IP, plus each proxy it passed through |
| `X-Forwarded-Proto` | The original scheme — `https`, even though your app got `http` |

`X-Forwarded-For` is a comma-separated list, appended to at every hop:

```text
X-Forwarded-For: 203.0.113.7, 10.0.1.5
                 └── real user   └── inner proxy
```

### BROKEN vs FIXED

```ts
// ❌ BROKEN — rate limiting by req.ip behind a load balancer.
// Every user shares one IP: the proxy's. One busy user locks out everybody.
async handle(ctx: HttpContext, next: NextFn) {
  const key = `rate:${ctx.request.ip()}`     // always 10.0.1.5
  const count = await redis.incr(key)
  if (count > 100) return ctx.response.tooManyRequests()
  return next()
}
```

The naive "fix" is worse:

```ts
// ❌ ALSO BROKEN — trusting the header blindly.
// The header is client-supplied. An attacker sends a random value each request
// and never hits the limit. Worse, they can frame another user's IP.
const ip = ctx.request.header('x-forwarded-for') ?? ctx.request.ip()
```

```ts
// ✅ FIXED — tell the framework which proxies to trust, then use its API.
// config/app.ts
export const http = defineConfig({
  // Trust only your own load balancer's private range. Never trust everything.
  trustProxy: proxyAddr.compile(['10.0.0.0/8', '172.16.0.0/12']),
})
```

```ts
// Now request.ip() walks X-Forwarded-For from the right and returns the first
// address that is NOT a trusted proxy — the real client.
async handle(ctx: HttpContext, next: NextFn) {
  const key = `rate:${ctx.request.ip()}`     // 203.0.113.7
  const count = await redis.incr(key)
  if (count > 100) {
    ctx.response.header('Retry-After', '60')
    return ctx.response.tooManyRequests({ error: 'rate_limit_exceeded' })
  }
  return next()
}
```

Express has the same mechanism: `app.set('trust proxy', '10.0.0.0/8')`. The rule
is identical everywhere — trust a **specific list** of proxy addresses.

> **⚠️ Warning:** `trustProxy: true` on an app that can be reached directly from
> the internet lets anyone forge their IP address. That defeats rate limiting,
> IP allowlists, geo-blocking and audit logs at once.

`X-Forwarded-Proto` matters too. If your app checks "is this HTTPS?" from the
connection, it always sees `http` behind a TLS-terminating proxy — which causes
infinite redirect loops when you force HTTPS. See
[https-and-tls](06-https-and-tls.md).

---

## Advanced Details

### Case-insensitivity

Header names are case-insensitive: `Content-Type` and `content-type` are the
same header. Node lowercases all incoming names, so read them lowercase:

```ts
request.header('x-request-id')   // works
request.header('X-Request-Id')   // frameworks normalise, but be consistent
```

In HTTP/2 and HTTP/3, lowercase is mandatory on the wire.

### Multi-value headers

Some headers may appear more than once, or carry a comma-separated list:

```text
Set-Cookie: session_id=8f3c; HttpOnly
Set-Cookie: theme=dark
Accept-Encoding: gzip, br, deflate
```

`Set-Cookie` is the special one: it must be repeated, never comma-joined. In
Node it comes back as an array while most headers come back as a string.

### Size limits

The specification sets no limit, but every server does — typically **8 KB total**
for all headers. Exceed it and you get `431 Request Header Fields Too Large`, or
`400` from nginx. The usual cause is cookies: they are sent on every request to
the domain, so a fat session cookie slows every request and eventually breaks
them.

> **💡 Tip:** keep the session cookie to an ID. Store the actual session data
> server-side, for example in [redis](../../system-design/foundational/redis.md).

### Why secrets belong in headers, not URLs

A token in a header stays reasonably private. The same token in a URL does not.

| Where the URL goes | Who can read it |
|---|---|
| Server, proxy and CDN access logs | Anyone with log access, forever |
| Browser history | Anyone using that machine |
| `Referer` header | Every third-party site you link to |

Both are encrypted in transit under HTTPS. The difference is what happens *after
arrival*: URLs are logged everywhere by default, headers are not.

```text
❌ GET /api/projects?api_key=sk_live_9f2c8a...
✅ GET /api/projects
   Authorization: Bearer sk_live_9f2c8a...
```

---

## Security Headers

A separate family of response headers tells the browser to enforce protections:
`Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`,
`Referrer-Policy`, and others.

They do not defend your server. They instruct the browser to defend the user
against cross-site scripting, clickjacking, and downgrade to HTTP. Cheap to add,
and worth adding by default.

Full treatment in [security headers](../11-api-security/04-security-headers.md).
`Strict-Transport-Security` specifically is covered in
[https-and-tls](06-https-and-tls.md).

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Using `req.ip` behind a proxy | Every user looks like the load balancer | Configure trusted proxies, then use the framework's IP accessor |
| `trustProxy: true` on a public app | Anyone can forge their IP | Trust a specific private CIDR range |
| Building URLs from the `Host` header | Attacker-controlled; enables reset-link hijacking | Build from configuration |
| Putting a token in the query string | Ends up in logs, history and `Referer` | Use the `Authorization` header |
| Caching a user-specific response without `Vary` | A shared cache can serve one user's data to another | `Cache-Control: no-store`, or set `Vary` |
| Storing session data inside the cookie | Sent on every request; blows the 8 KB header limit | Store an ID; keep the data server-side |
| Reading a custom response header in the browser without exposing it | CORS hides it; you get `null` | Add `Access-Control-Expose-Headers` |
| New custom headers named `X-Something` | The `X-` convention was deprecated in 2012 | Prefix with your product name |

---

## Questions to Test Yourself

1. Your rate limiter blocks all users at once after a deploy behind a new load
   balancer. What is the cause, and what is the fix that does **not** introduce
   a spoofing hole?
2. Why is `trustProxy: true` dangerous, and what should you set instead?
3. A password-reset email sends users to a domain you do not own. Which header
   did the code trust, and what should it have used?
4. Explain the `ETag` / `If-None-Match` flow in your own words. What does a
   `304` save, and what does it not save?
5. Both a token in a header and a token in a URL are encrypted by HTTPS. Why is
   the URL still far more dangerous?
6. What does `Vary: Authorization` prevent? Describe the bug you get without it.
7. Why was the `X-` prefix convention abandoned, and what do you use now?
8. Your frontend reads `response.headers.get('Acme-Tenant-Id')` and gets `null`,
   but `curl` shows the header clearly. What is missing?

---

## Related

- [Request and Response](02-request-and-response.md) — where headers sit in the
  raw message.
- [Status Codes](04-status-codes.md) — which headers pair with which code.
- [HTTPS and TLS](06-https-and-tls.md) — `X-Forwarded-Proto` and HSTS.
- [security headers](../11-api-security/04-security-headers.md) — the browser
  protection family.
- [CORS](../11-api-security/03-cors.md) — why the browser hides some headers
  from your script.
- [caching-strategies](../../system-design/foundational/caching-strategies.md) —
  the server-side half of `Cache-Control`.
- [reverse-proxy](../../system-design/foundational/reverse-proxy.md) — the
  machine that adds the `X-Forwarded-*` headers.
- [redis](../../system-design/foundational/redis.md) — where session data belongs
  instead of inside a cookie.
