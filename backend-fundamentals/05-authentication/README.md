# Part 5 — Authentication

Authentication answers one question: **who is calling?**

Every other backend concern depends on that answer. You cannot decide what a
caller may do (Part 6 — Authorization) until you know who the caller is. You
cannot write a useful audit log (Part 8) without a name to put in it. You
cannot scope a database query to "my projects" without an identity.

This is also the part of a backend where mistakes are most expensive. A slow
endpoint costs you a complaint. A broken login costs you every user's data.
Almost all of the classic failures — plain-text passwords, tokens that cannot
be revoked, session cookies readable by JavaScript, accounts linked by an
unverified email — come from the same root cause: the developer copied a code
snippet without knowing what the snippet was protecting against.

So each file here starts from zero, explains the mechanism, and then shows the
attack the mechanism exists to stop.

## Files

1. [Authentication Basics](01-authentication-basics.md) — what authentication
   is, the universal login flow, the four main approaches compared, and the
   account-security work beginners forget (verification, reset, lockout,
   enumeration).
2. [Passwords and Hashing](02-passwords-and-hashing.md) — why plain text and
   encryption are both wrong, salts, bcrypt / scrypt / Argon2, cost factors,
   timing-safe comparison, and upgrading hashes silently on next login.
3. [Cookies and Sessions](03-cookies-and-sessions.md) — how cookies actually
   work at the HTTP level, every cookie attribute, server-side sessions, where
   to store them, session fixation, real logout, and CSRF protection.
4. [JWT](04-jwt.md) — what a signed token is, the three parts, the claims you
   must verify, the revocation problem stated honestly, refresh-token rotation,
   where to store tokens, and the classic JWT attacks.
5. [OAuth2 and Social Login](05-oauth2-and-social-login.md) — delegated access,
   the four roles, OAuth2 vs OpenID Connect, the Authorization Code flow with
   PKCE, grant types, and the account-linking trap.
6. [API Keys and Machine Auth](06-api-keys-and-machine-auth.md) — when the
   caller is a program: key generation and hashing, lifecycle and rotation,
   HMAC request signing for webhooks, and mTLS / workload identity.

## Read in this order

Read 1 → 6, one file per sitting.

File 1 is the map; read it first even if you already know the topic, because
the later files assume its vocabulary (credential, session, token, factor).
Files 2 and 3 are the foundation of a normal web application and you should be
able to build a complete login from them alone. File 4 only makes sense after
file 3, because half of it is a comparison against sessions. Files 5 and 6 are
about callers you do not control: other companies' users, and other companies'
servers.

## What you should be able to do after this part

- Build a complete registration, login, and logout flow, and explain every
  security decision in it out loud.
- Store a password so that a full database leak does not reveal any password,
  and say why each part of the stored string exists.
- Choose between server-side sessions and JWTs for a given system, and defend
  the choice with the trade-off — not with "JWTs are modern".
- Explain what an attacker can do with a stolen session cookie, a stolen JWT,
  and a leaked API key, and what limits the damage in each case.
- Add "Log in with Google" to an application without opening an account
  takeover hole through account linking.
- Verify a webhook's HMAC signature correctly, including the timestamp window
  and the timing-safe comparison.

## Where this connects

- Authentication only proves identity. Permissions live in Part 6 —
  [Authorization](../06-authorization/).
- Session and token storage usually means Redis:
  [redis](../../system-design/foundational/redis.md).
- Why in-memory sessions break the moment you run two servers:
  [load-balancing](../../system-design/foundational/load-balancing.md).
- Login throttling and per-key quotas:
  [rate-limiting](../../system-design/foundational/rate-limiting.md).
- The attack catalogue these defences map to: Part 11 —
  [API Security](../11-api-security/).

## Next

Part 6 — [Authorization](../06-authorization/) takes the identity you just
proved and decides what it is allowed to touch.
