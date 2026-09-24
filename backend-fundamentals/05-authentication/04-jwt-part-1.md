# JWT — Part 1

A session cookie is a cloakroom ticket: meaningless on its own, useful only
because the server can look it up.

A **JWT** is the opposite idea. It is a small piece of JSON that says who you
are, with a cryptographic signature stapled to it. The server does not look
anything up. It checks the signature, and if the signature is valid, it
believes the JSON.

Think of a laminated conference badge. It carries your name and your access
level, printed right on it. Security does not phone head office — they look at
the hologram. If the hologram is real, the badge is real.

This part explains the badge: what is printed on it, how the hologram works,
and how to check it correctly. Part 2 asks the harder question — what happens
when you need to cancel a badge you have already handed out.

> **➡️ Continued in [Part 2](04-jwt-part-2.md).**

> **📌 In one line:** a JWT is base64url-encoded JSON plus a signature, so any
> server holding the right key can verify who you are **without a database
> lookup** — and that single property is both the whole benefit and the whole
> problem.

## Table of Contents

1. [What a JWT Is](#what-a-jwt-is)
2. [The Three Parts, Split at the Dots](#the-three-parts-split-at-the-dots)
3. [Critical: Signed Is Not Encrypted](#critical-signed-is-not-encrypted)
4. [The Standard Claims](#the-standard-claims)
5. [HMAC vs RSA and ECDSA](#hmac-vs-rsa-and-ecdsa)
6. [The Issue-and-Verify Flow](#the-issue-and-verify-flow)
7. [Working Code: Signing and Verifying](#working-code-signing-and-verifying)
8. [BROKEN vs FIXED: What You Put in the Payload](#broken-vs-fixed-what-you-put-in-the-payload)
9. [Common Mistakes](#common-mistakes)
10. [Questions to Test Yourself](#questions-to-test-yourself)
11. [Related](#related)

---

## What a JWT Is

**JWT** stands for **JSON Web Token**, and it is pronounced "jot".

Strip away the jargon and it is three things joined by dots:

1. A little JSON object describing **how the token was signed**.
2. A little JSON object describing **who the user is and for how long**.
3. A **signature** over the first two, made with a key only your server has.

The server that receives it re-computes the signature. If it matches, nobody
edited the JSON, so the JSON can be trusted. If it does not match, the token is
thrown away.

The point of this design is the phrase **without a lookup**. With a session,
every request costs a round trip to Redis or a database. With a JWT, every
request costs a signature check — pure CPU, no network, and any number of
separate services can do it independently as long as they hold the key.

That is genuinely useful when:

- Several different services must all recognise the same user.
- Your API is called from a mobile app or another domain, where cookies are
  awkward ([file 03 part 2](03-cookies-and-sessions-part-2.md#advanced-why-mobile-apps-prefer-tokens)).
- An identity provider (Google, Auth0, Keycloak) issues the token and *you*
  only verify it ([file 05](05-oauth2-and-social-login-part-1.md)).

And it is a cost, not a benefit, when you have one backend and one web app.
Part 2 makes that case properly.

---

## The Three Parts, Split at the Dots

Here is a real token. It is one long string with exactly two dots in it.

```text
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0MiIsIm5hbWUiOiJTYXJhIiwicm9sZSI6ImFkbWluIiwiaWF0IjoxNzU4MjQwMDAwLCJleHAiOjE3NTgyNDM2MDB9.bQ3xO8s1mS4rJvKqZ1fT2cWm9HhE0aYpL7nUd6gRxKc
```

Split it at the dots:

```text
  HEADER                          PAYLOAD                         SIGNATURE
┌───────────────────────┐   ┌──────────────────────────┐   ┌────────────────────┐
│ eyJhbGciOiJIUzI1NiIs  │ . │ eyJzdWIiOiI0MiIsIm5hbWUi │ . │ bQ3xO8s1mS4rJvKqZ1 │
│ InR5cCI6IkpXVCJ9      │   │ OiJTYXJhIiwicm9sZSI6ImFk │   │ fT2cWm9HhE0aYpL7nU │
│                       │   │ bWluIiwiaWF0IjoxNzU4MjQw │   │ d6gRxKc            │
│                       │   │ MDAwLCJleHAiOjE3NTgyNDM2 │   │                    │
│                       │   │ MDB9                     │   │                    │
└───────────┬───────────┘   └────────────┬─────────────┘   └─────────┬──────────┘
            │                            │                           │
     base64url JSON              base64url JSON            HMAC/RSA over
     "how it is signed"          "who, and until when"     header + "." + payload
```

Decoded, part 1 — the **header**:

```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

`alg` is the signing algorithm. `typ` says this is a JWT. A header may also
carry `kid` (key id) when the issuer rotates between several keys.

Decoded, part 2 — the **payload** (also called the *claims*):

```json
{
  "sub": "42",
  "name": "Sara",
  "role": "admin",
  "iat": 1758240000,
  "exp": 1758243600
}
```

Each key-value pair is a **claim**: a statement the issuer makes about the
subject. Some names are standard (section 4); the rest are yours.

Part 3 — the **signature** — is not JSON and does not decode into anything
readable. For `HS256` it is:

```text
HMAC-SHA256(
  secret,
  base64url(header) + "." + base64url(payload)
)
```

then base64url-encoded. Change one character anywhere in the header or the
payload and this value no longer matches. That is the hologram.

> **💡 Tip:** base64url is base64 with `+` → `-`, `/` → `_`, and the `=`
> padding removed, so the token is safe inside a URL. Every JWT starts with
> `eyJ` because that is what `{"` encodes to.

---

## Critical: Signed Is Not Encrypted

This is the single most misunderstood fact about JWTs, so it comes before
everything else.

**A JWT is signed, not encrypted. Anyone who has the token can read the entire
payload. No key is required.**

Prove it to yourself in one line of shell, with no secret of any kind:

```bash
echo 'eyJzdWIiOiI0MiIsIm5hbWUiOiJTYXJhIiwicm9sZSI6ImFkbWluIiwiaWF0IjoxNzU4MjQwMDAwLCJleHAiOjE3NTgyNDM2MDB9' | base64 -d
```

```json
{"sub":"42","name":"Sara","role":"admin","iat":1758240000,"exp":1758243600}
```

Or in the browser console, again with no secret:

```js
JSON.parse(atob(token.split('.')[1]))
```

The signature protects **integrity**, not **confidentiality**:

| Property | Does a signed JWT give it? |
|---|---|
| Nobody can change the claims without detection | **Yes** — that is what the signature is for |
| Nobody can forge a brand-new token | **Yes**, if your key is strong and secret |
| Nobody can read the claims | **No.** Everyone can read them |
| The token stops working when you say so | **No.** See [Part 2](04-jwt-part-2.md) |

So the rule is absolute:

> **⚠️ Warning:** never put a secret or personal data in a JWT payload. No
> passwords, no password hashes, no API keys, no national ID numbers, no home
> addresses, no medical or financial detail. The payload will end up in browser
> storage, in proxy logs, in error reports and in bug-tracker screenshots.

Put an id and the few flags you need. If you truly need an encrypted token
there is a standard for it (JWE), but the usual right answer is "put it on the
server and send an id" — which is a session.

---

## The Standard Claims

Seven claim names are reserved by the JWT standard. Learn them, because
security bugs come from ignoring them.

| Claim | Full name | What it means | Must you verify it? |
|---|---|---|---|
| `iss` | issuer | who created this token (`https://auth.acme.com`) | **Yes**, if more than one issuer could reach you |
| `sub` | subject | who the token is about — usually your user id | Yes, as the identity you act on |
| `aud` | audience | who this token is *for* (`https://api.acme.com`) | **Yes** — stops a token meant for another service being replayed at yours |
| `exp` | expiration time | Unix seconds after which the token is invalid | **Yes. Always.** This is the only thing limiting a stolen token |
| `nbf` | not before | Unix seconds before which the token is invalid | Yes, if the issuer sets it |
| `iat` | issued at | Unix seconds when the token was created | Useful for "re-authenticate for this action" checks |
| `jti` | JWT id | a unique id for this token | Only if you keep a denylist — see [Part 2](04-jwt-part-2.md) |

Three notes that catch people out:

- `exp`, `nbf` and `iat` are **seconds**, not milliseconds (`Date.now() / 1000`).
- A missing `exp` means a token that never expires, and most libraries accept
  that silently unless you configure otherwise.
- `aud` is the claim beginners skip and attackers love. If one provider issues
  tokens for five of your services and you do not check `aud`, a token minted
  for the low-value service works on the high-value one.

Beyond these, your own claims are free-form. Keep them small: `role`,
`tenantId`, `scope`. Every claim is re-sent on every request, and every claim
is potentially stale (Part 2).

---

## HMAC vs RSA and ECDSA

There are two families of signing algorithm and the choice is about **who
needs to verify**.

| | **HMAC** (`HS256`, `HS384`, `HS512`) | **RSA / ECDSA** (`RS256`, `ES256`, `PS256`) |
|---|---|---|
| Keys | one shared secret | a key **pair**: private signs, public verifies |
| Who can sign | anyone with the secret | only the holder of the private key |
| Who can verify | anyone with the secret — **so verifiers can also forge** | anyone with the public key, which forges nothing |
| Key distribution | every verifier needs the secret | publish the public key freely, often at a JWKS URL |
| Speed | very fast | signing is slower; `ES256` verification is fast, `RS256` is fine |
| Token size | smallest | signature is larger (256 bytes for RSA-2048) |
| Good for | **one service** that both issues and verifies | many services, or a third party verifying your tokens |

The decision in one sentence: **if the party verifying the token is not the
party issuing it, use asymmetric.** Otherwise you would have to hand your
signing secret to every verifier, and each of them could then mint tokens for
any user.

That is why every identity provider — Google, Auth0, Okta, Keycloak — signs
with `RS256` or `ES256` and publishes its public keys at a well-known JWKS
(JSON Web Key Set) URL:

```text
https://accounts.google.com/.well-known/openid-configuration
   └─ points at → https://www.googleapis.com/oauth2/v3/certs   (the JWKS)
```

Your service fetches those public keys, caches them, and picks the right one
using the `kid` in the token header. Use a library that does this and respects
cache headers (`jwks-rsa` in Node). Never hard-code a key you fetched once.

> **📌 Remember:** HMAC secrets must be **random and long** — at least 256 bits
> from `crypto.randomBytes(32)`. `"supersecret"` is brute-forceable offline in
> seconds, and the attacker needs only one token to try against.

---

## The Issue-and-Verify Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant A as Auth service
    participant D as Database
    participant R as Resource API

    C->>A: POST /login {email, password}
    A->>D: find user by email
    D-->>A: user row + password hash
    A->>A: verify password (argon2)
    A->>A: build claims {sub, role, iss, aud, iat, exp}
    A->>A: sign with private key / secret
    A-->>C: 200 OK {accessToken}
    Note over C,R: no database call from here on
    C->>R: GET /projects<br/>Authorization: Bearer eyJ...
    R->>R: split at the dots
    R->>R: recompute signature with the key → matches?
    R->>R: check exp, nbf, iss, aud
    R->>R: req.user = {id: claims.sub, role: claims.role}
    R-->>C: 200 OK [projects]
```

Read the right-hand side carefully. Between "issue" and "verify" there is **no
line back to the database**. That is the whole selling point, and in Part 2 it
is also the whole problem.

The verification steps, in the order a correct library performs them:

1. Split the token into three parts. Reject anything that is not three parts.
2. Decode the header and read `alg`. **Check it against your own allow-list**,
   never against what the token asks for.
3. Recompute the signature over `header.payload` and compare it, timing-safely,
   with the third part.
4. Only now decode the payload and check `exp`, `nbf`, `iss` and `aud`.
5. Hand the claims to your application.

Step 2 before step 3 is the part attackers target, and it is the subject of the
`alg` attacks in [Part 2](04-jwt-part-2.md#the-classic-attacks).

---

## Working Code: Signing and Verifying

### Signing at login

```ts
import jwt from 'jsonwebtoken'

const ACCESS_TTL = '15m'   // deliberately short — see Part 2

export function issueAccessToken(user: { id: number; role: string; tenantId: number }) {
  return jwt.sign(
    {
      // custom claims: small, non-secret, and things you need on every request
      role: user.role,
      tenantId: user.tenantId,
    },
    process.env.JWT_PRIVATE_KEY!,      // or a 32-byte random HMAC secret
    {
      algorithm: 'RS256',
      subject: String(user.id),        // → sub
      issuer: 'https://auth.acme.com', // → iss
      audience: 'https://api.acme.com',// → aud
      expiresIn: ACCESS_TTL,           // → exp
      jwtid: crypto.randomUUID(),      // → jti, needed for denylisting later
    },
  )
}
```

The login route itself is unchanged from
[file 01](01-authentication-basics.md#login): validate, look the user up,
verify the password, and then return `issueAccessToken(user)` instead of
setting a cookie. A refresh token belongs in that response too — Part 2.

### Verifying in middleware

```ts
import jwt, { type JwtPayload } from 'jsonwebtoken'

export function requireAuth() {
  return async (req, res, next) => {
    const header = req.headers.authorization ?? ''
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' })
    }
    const token = header.slice('Bearer '.length).trim()

    let claims: JwtPayload
    try {
      claims = jwt.verify(token, process.env.JWT_PUBLIC_KEY!, {
        algorithms: ['RS256'],              // ← allow-list. Never omit this.
        issuer: 'https://auth.acme.com',    // ← reject other issuers
        audience: 'https://api.acme.com',   // ← reject tokens meant elsewhere
        clockTolerance: 5,                  // seconds of clock skew, not minutes
      }) as JwtPayload
    } catch (err: any) {
      // TokenExpiredError is normal and the client should refresh, not re-login
      const code = err.name === 'TokenExpiredError' ? 'token_expired' : 'token_invalid'
      return res.status(401).json({ error: code })
    }

    req.user = { id: Number(claims.sub), role: claims.role, tenantId: claims.tenantId }
    return next()
  }
}
```

Five things in that call are doing real security work, and every one of them
is optional in the library's default:

| Option | Without it |
|---|---|
| `algorithms: ['RS256']` | the token chooses its own algorithm — see the `alg` attacks in Part 2 |
| `issuer` | a token from any issuer whose key you happen to trust is accepted |
| `audience` | a token minted for another one of your services is accepted here |
| `expiresIn` at signing | the token never expires |
| small `clockTolerance` | a generous tolerance quietly extends every token's life |

Note where this middleware sits: after body parsing, before your routes, and
before any authorization check. See
[middleware](../03-request-lifecycle/03-middleware.md).

---

## BROKEN vs FIXED: What You Put in the Payload

Because the payload is readable by anyone, the claim list is a security
decision, not a convenience decision.

```ts
// ❌ BROKEN — every one of these is now visible to anyone holding the token
const token = jwt.sign(
  {
    userId: user.id,
    email: user.email,
    passwordHash: user.passwordHash,   // catastrophic: offline cracking target
    ssn: user.nationalId,              // personal data, now in browser storage
    stripeSecretKey: process.env.STRIPE_SECRET, // a live credential, published
    permissions: allPermissions,       // 6 KB of claims on every single request
  },
  secret,                              // no options at all: no exp, no iss, no aud
)
```

What actually happens: the token sits in `localStorage`, is copied into a
support ticket, appears in a proxy access log with the query string, and is
pasted into jwt.io by a developer debugging an unrelated bug. Every field above
leaks in all four places, and the token never expires.

```ts
// ✅ FIXED — an id, the two flags needed on every request, and full options
const token = jwt.sign(
  {
    role: user.role,         // small, non-secret, needed for routing decisions
    tenantId: user.tenantId, // small, non-secret, needed to scope every query
  },
  privateKey,
  {
    algorithm: 'RS256',
    subject: String(user.id),
    issuer: 'https://auth.acme.com',
    audience: 'https://api.acme.com',
    expiresIn: '15m',
    jwtid: crypto.randomUUID(),
  },
)
```

Anything bigger than a flag — a full permission list, a profile, a settings
object — belongs behind `sub`, fetched and cached server-side. Ask of every
claim: *am I happy for this to be printed on a billboard, and am I happy for
it to be up to fifteen minutes out of date?* If the answer to either is no, it
does not go in the token.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Believing a JWT is encrypted | The payload is plain base64url; anyone can read it | Treat the payload as public; keep secrets server-side |
| Putting personal data or credentials in claims | They leak into storage, logs, screenshots and tickets | Put an id; look the rest up |
| Signing without `expiresIn` | The token is valid forever | Always set `exp`, and keep it short |
| Verifying without `algorithms` | The attacker picks the algorithm | Pin an explicit allow-list |
| Skipping `aud` | A token for service B is accepted by service A | Set and verify `audience` |
| A short or guessable HMAC secret | Offline brute force from a single captured token | 32 random bytes, from a secret manager |
| Sharing the HMAC secret with every verifier | Any verifier can now mint tokens for any user | Use `RS256`/`ES256` and publish only the public key |
| Confusing seconds and milliseconds in `exp` | A token expires in 1970, or in the year 57000 | Unix **seconds**; let the library compute it |
| Large `clockTolerance` "to fix flaky tests" | Silently extends the life of every token | 5 seconds, and fix the clocks with NTP |
| Hard-coding a JWKS key fetched once | Breaks silently when the provider rotates keys | Use a JWKS client that caches and refreshes by `kid` |

---

## Questions to Test Yourself

1. A colleague says "the data is safe, it is inside the JWT". Write the
   one-line command that ends that conversation.
2. What exactly does the signature protect, and what does it not protect?
3. Name the seven standard claims and say which ones you must verify on every
   request.
4. Why is `aud` important when one identity provider serves several of your
   services?
5. You run one monolithic API that both issues and verifies tokens. Is `HS256`
   or `RS256` the better fit, and why?
6. You add a second service that must verify the same tokens. Does your answer
   to question 5 change? Explain what breaks if it does not.
7. Put the five verification steps in the correct order, and say why checking
   `alg` against your own allow-list must come before trusting anything.
8. Why are `exp` values in seconds a common source of bugs?
9. Your token payload is 6 KB because it carries every permission. Name two
   separate costs of that, one on the wire and one in correctness.
10. Explain, in one sentence each, what `iss`, `aud` and `jti` are for.

---

## Related

- [Part 2](04-jwt-part-2.md) — the revocation problem stated honestly, refresh
  tokens and rotation, where to store a token on the client, the classic
  attacks, and sessions vs JWT.
- [Cookies and Sessions — Part 2](03-cookies-and-sessions-part-2.md) — the
  stateful alternative this is being compared against.
- [Authentication Basics](01-authentication-basics.md) — where JWTs sit among
  the four approaches.
- [Passwords and Hashing](02-passwords-and-hashing.md) — what happens before a
  token is ever issued.
- [OAuth2 and Social Login — Part 1](05-oauth2-and-social-login-part-1.md) —
  the most common way you will meet a JWT you did not issue.
- [Headers](../01-http-foundations/05-headers.md#authorization) — the
  `Authorization: Bearer` header this file relies on.
- [Middleware](../03-request-lifecycle/03-middleware.md) — where `requireAuth`
  belongs in the pipeline.
- [Part 6 — Authorization](../06-authorization/) — what to do with `role` and
  `tenantId` once verified.
