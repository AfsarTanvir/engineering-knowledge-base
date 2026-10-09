# Part 11 — API Security

Every other part of this track teaches you to make something work. This part
teaches you to make it hard to break.

That sounds dramatic, but the reality is boring in a good way. Real APIs are
almost never broken by clever cryptography attacks. They are broken because one
endpoint forgot to check who owns a record, because a `.env` file went into git,
because an old `/v1/` route nobody remembers is still live, or because a
response object quietly included a `passwordHash` field.

So this part is a catalogue of the attacks that actually happen, each one
explained with the defence next to it. You are building your own SaaS API. You
are your own security team. The goal is not to make you paranoid — it is to
give you a short list of things to check, and the understanding to know why each
one is on the list.

Nothing here is offensive tooling. Every attack is shown at the minimum detail
needed to understand the fix, and the fix is the point of the file.

## Files

1. [OWASP Top 10 for APIs](01-owasp-top-10-for-apis.md) — the industry's list of
   the ten risks that break real APIs, each one explained in plain words with a
   SaaS example and the primary defence, plus a checklist you can run against
   your own API.
2. **Injection Attacks** — the single idea behind SQL
   injection, NoSQL injection, command injection, path traversal, XSS, XXE,
   template and log injection, and prototype pollution: untrusted data being
   read as code instead of as data.
   - [Part 1](02-injection-attacks-part-1.md) — the one idea, SQL injection,
     parameterised queries, what they cannot cover, ORM escape hatches, least
     privilege for the database user, and NoSQL injection.
   - [Part 2](02-injection-attacks-part-2.md) — command injection, path
     traversal, XSS from the backend's side, XXE, template, log and CSV
     injection, and prototype pollution.
3. [CORS](03-cors.md) — what the same-origin policy actually blocks, why CORS is
   a browser rule and not a server defence, every CORS header, the credentials
   rule, and a troubleshooting table for the errors you will hit.
4. **Security Headers** — the response headers that tell a
   browser how to treat your data: Content-Security-Policy, HSTS, nosniff,
   frame-ancestors, Referrer-Policy, what to remove, and which of them a pure
   JSON API actually needs.
   - [Part 1](04-security-headers-part-1.md) — what a security header is, the
     full reference table, and Content-Security-Policy in depth.
   - [Part 2](04-security-headers-part-2.md) — HSTS, nosniff, clickjacking,
     Referrer-Policy, headers to remove, the pure-JSON-API set, cache headers,
     and verifying your own deployment.
5. **Secrets and Configuration** — keeping keys
   out of the repository, validating configuration at startup, secret managers,
   rotating a signing key without downtime, and stopping leaks before they are
   committed.
   - [Part 1](05-secrets-and-configuration-part-1.md) — the rules, what counts
     as a secret, responding to a committed one, `.env` discipline, and startup
     validation.
   - [Part 2](05-secrets-and-configuration-part-2.md) — secret managers,
     zero-downtime rotation, encryption at rest, containers and CI/CD, and
     preventing leaks proactively.

## Read in this order

Read 1 → 5, one file per sitting.

File 1 is the map. Read it first: it names every risk and tells you which other
file in this knowledge base covers it properly, so it doubles as an index.
File 2 is the deepest technical file in the part and repays slow reading.
Files 3 and 4 are browser-facing and belong together — CORS is the rule you will
fight with, security headers are the ones you will forget to add. File 5 is the
one with the highest chance of saving you from a real incident.

## What you should be able to do after this part

- Look at any endpoint you wrote and say which OWASP API risk it could carry,
  and what in the code stops it.
- Explain why parameterised queries stop SQL injection at the mechanism level,
  not as a rule you memorised, and say exactly what they do not protect.
- Read a CORS error in a browser console and name the server-side
  misconfiguration causing it, instead of pasting `origin: '*'` and moving on.
- Choose a starting Content-Security-Policy and roll it out in report-only mode
  without breaking the front end.
- Build a typed, schema-validated configuration module that crashes at startup
  when a secret is missing, and explain why that is better than a fallback.
- Rotate a JWT signing key and a webhook secret with zero downtime, and describe
  the correct response when a secret is committed by accident.

## Where this connects

- Object-level permission checks — the number one API risk — live in Part 6,
  [Authorization](../06-authorization/).
- Input validation is the first half of injection defence: Part 4,
  [Validation & Input Handling](../04-validation-and-input/).
- Abuse limits and quotas:
  [rate-limiting](../../system-design/foundational/rate-limiting.md).
- Where to terminate TLS and set headers centrally:
  [api-gateway](../../system-design/foundational/api-gateway.md) and
  [nginx/reverse-proxy-config](../../cloud-devops/nginx/reverse-proxy-config.md).
- Not leaking internals in error responses: Part 7,
  [Error Handling](../07-error-handling/).

## Next

Part 12 — [Files & Integrations](../12-files-and-integrations/) takes the two
most dangerous things an API can accept — a file from a user and a request from
another company's server — and makes them safe.
