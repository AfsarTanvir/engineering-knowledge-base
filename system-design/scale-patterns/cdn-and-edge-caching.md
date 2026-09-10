# CDN & Edge Caching

A CDN (Content Delivery Network) puts copies of your content on servers
physically close to users, all over the world — so a request from Tokyo
doesn't have to round-trip to your origin server in Virginia. It's the
same caching idea as [caching-strategies.md](../foundational/caching-strategies.md),
just applied at the network edge instead of inside your application.

## Table of Contents

1. [Why Distance Matters](#why-distance-matters)
2. [What Belongs on a CDN](#what-belongs-on-a-cdn)
3. [Cache-Control Headers](#cache-control-headers)
4. [Cache Keys and Vary](#cache-keys-and-vary)
5. [Invalidation: Purging the Edge](#invalidation-purging-the-edge)
6. [Edge Compute](#edge-compute)
7. [Origin Shielding](#origin-shielding)
8. [Quick Reference](#quick-reference)

---

## Why Distance Matters

Physical distance between a user and your server is a hard latency floor
— light (and the electrical signals in fiber) only travels so fast.
Round-trip time from Tokyo to a us-east server is on the order of 150ms+
*before your server does any actual work.*

```
Without a CDN:
  Tokyo user -> [ 150ms ] -> Origin server (Virginia) -> [ 150ms ] -> Tokyo user
  Total: 300ms+ just for network transit, every request

With a CDN:
  Tokyo user -> [ 5ms ] -> Edge node (Tokyo) -> serves cached copy -> [ 5ms ] -> Tokyo user
  Total: ~10ms, if the edge node already has it cached
```

A CDN doesn't make your origin server faster — it makes most requests
never need to reach the origin at all.

## What Belongs on a CDN

**Great fit — static, identical for every user:**

- Images, videos, fonts, CSS, JS bundles
- Static HTML (marketing pages, docs)
- Any file-based asset that doesn't change per-request

**Good fit with care — dynamic but cacheable:**

- API responses that are the same for all (or most) users for a short
  window (a public leaderboard, product listings)
- Server-rendered pages that don't contain per-user data

**Poor fit:**

- Truly personalized responses (a user's own dashboard, account balance)
  — unless split so the personalized part loads separately via an
  uncached call
- Anything requiring strong consistency the instant it changes (see
  [cap-theorem-and-consistency-models.md](../foundational/cap-theorem-and-consistency-models.md) —
  CDN caching is inherently an availability/staleness trade-off)

## Cache-Control Headers

The origin server tells the CDN (and the browser) how to cache a response
via HTTP headers — this is the actual mechanism, not something configured
only in a CDN dashboard:

```
Cache-Control: public, max-age=31536000, immutable
```

- `public` — cacheable by any cache (CDN, browser), not just the
  requesting user's own browser
- `max-age=31536000` — cache for up to 1 year (seconds)
- `immutable` — tells the browser this exact URL's content will never
  change, skip revalidation entirely

```
Cache-Control: private, no-store
```

- `private` — only the end user's own browser may cache it, not a shared
  CDN edge (use for per-user data)
- `no-store` — don't cache at all, anywhere

**The common static-asset pattern:** version the filename or query string
(`app.a1b2c3.js` or `app.js?v=a1b2c3`) and set a long `max-age` +
`immutable`. Since the URL changes whenever the content changes, you get
maximum caching with zero staleness risk — a new deploy simply produces a
new URL that nobody has cached yet.

```
# CDN-specific header, honored by most CDNs (Cloudflare, Fastly, CloudFront)
Surrogate-Control: max-age=3600
# Lets you set a DIFFERENT cache duration for the CDN vs the browser,
# e.g. cache at the edge for an hour but tell browsers not to cache at all
```

## Cache Keys and Vary

By default, a CDN typically caches by URL alone — two requests for the
same URL get the same cached response, even if something else about the
request differs (language, device type, logged-in state via a cookie).

`Vary` tells the cache which request headers create a *separate* cached
copy per distinct value:

```
Vary: Accept-Language
```

```
Request A: Accept-Language: en -> cached separately
Request B: Accept-Language: ja -> cached separately from A
```

**Be deliberate about `Vary`** — each additional header you vary on
multiplies the number of distinct cached copies, which can shred your
cache hit rate if the header has many possible values (varying on a
full `User-Agent` string, for instance, is usually a mistake — normalize
to a smaller set of categories first).

## Invalidation: Purging the Edge

Sometimes content needs to change before its `max-age` expires — a typo
fix, an urgent price correction. CDNs offer an explicit purge/invalidate
API for this:

```bash
# Cloudflare example
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {token}" \
  -d '{"files": ["https://example.com/pricing.html"]}'
```

Purging is not instant globally — it propagates across edge nodes, which
takes some time. For content that changes on a predictable schedule,
prefer setting an appropriately short `max-age` over relying on purge as
your primary invalidation strategy; reserve purge for genuine emergencies.

## Edge Compute

Modern CDNs run more than static caching — edge functions (Cloudflare
Workers, Lambda@Edge, Fastly Compute) execute actual code at the edge
node, close to the user, before a request ever reaches the origin:

```javascript
// Cloudflare Worker: redirect based on the user's country, at the edge
export default {
  async fetch(request) {
    const country = request.headers.get('CF-IPCountry');
    if (country === 'DE') {
      return Response.redirect('https://example.de', 302);
    }
    return fetch(request);
  }
}
```

Useful for A/B test routing, auth checks that don't need the origin,
header rewriting, and geo-based logic — anything cheap enough to run at
the edge without hitting your backend at all.

## Origin Shielding

Without shielding, a cache miss at *every* edge location independently
hits the origin server — a globally popular but just-expired asset can
cause dozens of simultaneous origin requests worldwide the moment its
cache entry expires (this is the [cache stampede](../foundational/caching-strategies.md#cache-stampede)
problem, at CDN scale).

**Origin shielding** designates one "shield" edge location that all other
edges route through on a cache miss — so the origin sees at most one
request per shielded region, not one per edge node globally:

```
Without shielding:
  50 edge nodes all miss simultaneously -> 50 requests hit the origin at once

With shielding:
  50 edge nodes miss -> all route through 1 shield node -> shield hits origin ONCE
                       -> shield serves all 50 from its own single fetch
```

---

## Quick Reference

| Task                                          | Mechanism                                       |
| :-------------------------------------------------- | :----------------------------------------------------- |
| Cache a static asset for a long time, safely           | Content-hashed filename + `max-age` + `immutable`         |
| Prevent caching per-user data                          | `Cache-Control: private, no-store`                        |
| Cache different content per language/device            | `Vary` header, kept to a small set of values                |
| Fix cached content before it expires                   | Purge/invalidate API (use sparingly)                        |
| Run logic before the origin is hit                     | Edge functions (Workers, Lambda@Edge)                        |
| Prevent a stampede on origin at cache expiry            | Origin shielding                                             |

**Bottom line:** push everything static and shareable as far to the edge
as possible with long, content-hashed cache lifetimes — that's the
highest-leverage, lowest-risk win. Be careful with `Vary` and treat purge
as an emergency tool, not your primary invalidation strategy.
