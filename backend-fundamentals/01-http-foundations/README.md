# Part 1 — HTTP Foundations

Every backend feature you will ever build sits on top of HTTP (HyperText
Transfer Protocol). A login, a file upload, a webhook, a health check — they
are all the same thing underneath: a block of text goes to a server, and a
block of text comes back.

Most developers learn a framework first and HTTP never. That works until
something breaks in production: a retry duplicates a payment, a cache serves
stale data, `req.ip` returns `127.0.0.1` for every user, or a client starts
ignoring your errors because you returned `200 OK` for all of them. Each of
those is an HTTP problem, not a framework problem.

This part gives you the mental model. After it, when you read a framework's
documentation, you will already know what it is wrapping.

## Files

1. [How the Web Works](01-how-the-web-works.md) — client, server, DNS, TCP,
   TLS, ports, and why HTTP forgets you after every request.
2. [Request and Response](02-request-and-response.md) — the raw text format of
   an HTTP message, bodies, content types, and how to read data in Node.
3. [HTTP Methods](03-http-methods.md) — GET, POST, PUT, PATCH, DELETE and the
   safe / idempotent rules that decide whether a retry is safe.
4. [Status Codes](04-status-codes.md) — the five families, the twenty codes
   that matter, and the classic confusions (401 vs 403, 400 vs 422).
5. [Headers](05-headers.md) — the metadata that carries auth, caching, content
   type, request IDs, and the real client IP behind a proxy.
6. [HTTPS and TLS](06-https-and-tls.md) — what encryption protects against,
   the handshake, certificates, and where TLS ends in a real deployment.

## Read in this order

Read them 1 → 6, one file per sitting. Files 2–5 all assume the vocabulary
from file 1 (client, server, port, stateless). File 6 assumes you can already
picture a request travelling over a connection.

Do not skip file 3's "safe vs idempotent" section. Parts 7 (Error Handling)
and 11 (API Security) both build directly on it.

## What you should be able to do after this part

- Describe out loud everything that happens between typing a URL and seeing a
  page, in order, without notes.
- Read a raw HTTP request in a log or in your browser's Network tab and name
  every line of it.
- Choose the correct method and status code for a new endpoint, and justify
  the choice in one sentence.
- Explain why a failed `POST` cannot be blindly retried but a failed `PUT` can.
- Find the true client IP address when your app runs behind a load balancer,
  and explain why the naive way is both wrong and a security hole.
- Explain what HTTPS protects, what a certificate proves, and why your Node
  app usually never sees a TLS handshake at all.

## Where this connects

- Load balancers and reverse proxies sit between the client and your app:
  [reverse-proxy](../../system-design/foundational/reverse-proxy.md),
  [load-balancing](../../system-design/foundational/load-balancing.md).
- Caching headers are the client-side half of
  [caching-strategies](../../system-design/foundational/caching-strategies.md).
- Retry safety and status codes feed directly into
  [circuit-breakers-and-retries](../../system-design/reliability/circuit-breakers-and-retries.md)
  and [idempotency](../../system-design/reliability/idempotency.md).
- The layers below HTTP (IP, TCP, packets) live in
  [networking](../../networking/README.md).

## Next

Part 2 — [REST & API Design](../02-rest-api-design/) turns these raw
mechanics into an API that other developers can use without asking you
questions.
