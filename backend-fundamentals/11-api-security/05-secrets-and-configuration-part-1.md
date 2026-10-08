# Secrets and Configuration — Part 1

A house key and a house number are both small pieces of information about your
home. One of them you paint on the door.

Configuration is the house number: the database host, the port, the log level,
the list of allowed origins. It changes between environments, so it does not
belong hard-coded in your code. Secrets are the key: the database password, the
signing key, the Stripe token. They do not belong in the repository at all — not
in a config file, not in a comment, not in a private repo, not "temporarily".

Getting this wrong is not exotic. It is one of the most common causes of real
breaches, because it needs no attacker skill: somebody committed a key, and
somebody else found it.

> **➡️ Continued in [Part 2](05-secrets-and-configuration-part-2.md).**

> **📌 In one line:** configuration lives outside the code, secrets live outside
> the repository, and both are read in exactly one validated module — so a
> missing value crashes at boot rather than at 2 AM on a code path nobody tests.

## Table of Contents

1. [The Rule, Stated First](#the-rule-stated-first)
2. [What Counts as a Secret](#what-counts-as-a-secret)
3. [Why Committing a Secret Is Worse Than It Looks](#why-committing-a-secret-is-worse-than-it-looks)
4. [Environment Variables Done Properly](#environment-variables-done-properly)
5. [Validating Configuration at Startup](#validating-configuration-at-startup)
6. [Why `process.env.PORT` Is a String](#why-processenvport-is-a-string)
7. [BROKEN vs FIXED: The Fallback That Works in Production](#broken-vs-fixed-the-fallback-that-works-in-production)
8. [Common Mistakes](#common-mistakes)
9. [Questions to Test Yourself](#questions-to-test-yourself)
10. [Related](#related)

---

## The Rule, Stated First

Two rules, and they are not the same rule.

**1. Anything that differs between environments belongs outside the code.** Your
local database is not your production database. Your test Stripe account is not
your live one. If a value changes when you deploy, it is configuration, and
baking it into a source file means you now maintain a branch per environment or
an `if (isProduction)` ladder that nobody trusts.

**2. Secrets never belong in the repository.** Not in a private repository
either. A private repo is not a vault: everyone with read access has the secret,
every CI job has it, every laptop that cloned it has it, every backup of those
laptops has it, and every fork keeps it. "Private" limits who can find it. It
does not limit who has it.

The mechanism for both is the same — the process **environment** — but the
consequences of getting them wrong are very different, which is why the checklist
in the next section exists.

---

## What Counts as a Secret

Run down this table for your own project. The right-hand column is the question
that settles arguments.

| Value | Why it is a secret | What a leak lets someone do |
|---|---|---|
| `DATABASE_URL` | Contains the password | Read and write every row you have |
| JWT signing key | Signatures are the whole auth system | Mint a valid token for any user, including admins |
| Session / cookie signing secret | Same, for sessions | Forge a session cookie |
| Encryption keys | The point of the ciphertext | Decrypt everything you stored encrypted |
| Third-party API keys (Stripe, SendGrid, Twilio) | Spend money, send mail | Charge cards, send phishing from your domain |
| Webhook **signing** secrets | They prove an event is genuine | Forge inbound events: "payment succeeded" |
| OAuth **client secret** | Proves your app is your app | Impersonate your application in the auth flow |
| SMTP credentials | Your mail reputation | Send mail as you, to your users |
| Internal service tokens | Cross-service trust | Call internal APIs as a trusted service |
| Private keys and certificates | Identity itself | Be you, on the network |

And the values that are **not** secrets, which people sometimes hide for no
reason: `PORT`, `NODE_ENV`, `LOG_LEVEL`, feature flags, the OAuth **client id**
(it is sent to the browser), public keys, and your own public API base URL.

> **💡 Tip:** the test is not "would I mind if this were public". It is "if a
> stranger had this value, what could they do?" If the answer is anything at
> all, it is a secret.

---

## Why Committing a Secret Is Worse Than It Looks

You notice the key in a file, delete the line, commit, push. It looks fixed. It
is not, and the reason is how git works.

A commit does not edit history — it adds to it. The old commit still contains
the key, and so does every clone anyone made, every fork, every CI cache, every
pull request mirror, and every object the hosting provider kept. On GitHub, a
commit that is no longer reachable from any branch can often still be fetched by
its SHA. Your deletion changed the tip of a branch. It changed nothing about the
value.

**So there is only one real remedy: the secret is burned. Rotate it.** Here are
the response steps, in the order that matters.

1. **Rotate first.** Generate a new credential at the provider and deploy it.
   Do this before anything else, including before you tell anyone. Every minute
   the old value works is a minute of exposure.
2. **Revoke the old one.** Actually disable it at the provider. Not "we will
   clean it up later" — an unrevoked old key is the whole problem.
3. **Look for use.** Check the provider's audit log for calls since the commit
   date: unfamiliar IPs, unusual volumes, calls at odd hours. Check your own
   logs for the same.
4. **Then consider purging history** with `git filter-repo` or BFG, followed by
   a force-push and asking everyone to re-clone. It is step 4 and not step 1
   because it is disruptive, it invalidates open pull requests, and it *never*
   reaches forks or clones you do not control. It reduces future exposure; it
   does not undo this one.
5. **Tell the provider** if the key was high-value. Payment and cloud providers
   have processes for this and would rather help than clean up after.
6. **Fix the pipeline, not the person.** Add the pre-commit scanning described
   in Part 2, so the next one never reaches a commit at all.

> **⚠️ Warning:** the most common version of this incident is not a key in
> source code. It is a `.env` file committed on day one of the project, long
> before anyone thought about `.gitignore`, and forgotten.

---

## Environment Variables Done Properly

Three files, three different jobs. All three exist in a healthy repository.

```bash
# .env — LOCAL DEVELOPMENT ONLY. Never committed. Never used in production.
NODE_ENV=development
PORT=3333
DATABASE_URL=postgres://app:devpassword@localhost:5432/saas_dev
JWT_SECRET=local-dev-secret-not-used-anywhere-real-000000
STRIPE_SECRET_KEY=sk_test_51abcdef
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

```bash
# .env.example — COMMITTED. This is documentation, with no real values.
NODE_ENV=development
PORT=3333
DATABASE_URL=postgres://user:password@localhost:5432/saas_dev
JWT_SECRET=                 # 32+ random bytes; generate with openssl rand -hex 32
STRIPE_SECRET_KEY=          # from the Stripe dashboard, test mode
CORS_ORIGINS=http://localhost:3000
```

```gitignore
# .gitignore
.env
.env.*
!.env.example
```

Three details that are easy to get wrong:

- **`.env.*` plus the `!` un-ignore line.** Ignoring only `.env` is the classic
  miss — it leaves `.env.production` and `.env.staging` perfectly committable.
  The pattern above ignores every variant and explicitly keeps the example.
- **`.env.example` is a contract.** It lists every variable the app needs, with
  a comment on how to obtain each one. A new developer copies it to `.env` and
  fills in the blanks. When you add a variable, you add it here in the same
  commit — otherwise the next person's app crashes at boot with no explanation.
- **Production does not use a `.env` file at all.** Real environment variables
  come from the platform: your container orchestrator, your PaaS dashboard, your
  secret manager. A `.env` file is a local-development convenience, and shipping
  one is how secrets end up inside a Docker image.

---

## Validating Configuration at Startup

Here is the failure this section prevents. You deploy on Friday. `STRIPE_SECRET_KEY`
was never set on the new environment, but nothing reads it until a customer
upgrades their plan. At 02:00 on Sunday somebody clicks "Upgrade" and gets a 500
in a code path you have never exercised.

The fix is to read and check **every** configuration value once, at boot, and
refuse to start if anything is wrong.

```ts
// config/env.ts — the only file in the codebase that touches process.env
import { z } from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  CORS_ORIGINS: z.string().transform((v) => v.split(',').map((s) => s.trim())),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

const parsed = EnvSchema.safeParse(process.env)

if (!parsed.success) {
  // Print the NAMES and the problems. Never print the values.
  console.error('Invalid configuration — refusing to start:')
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

export const env = Object.freeze(parsed.data)
export type Env = typeof env
```

What this buys you, in order of importance:

1. **It crashes immediately, and loudly.** A container that will not start is a
   failed deploy, which your rollout already knows how to handle. A silent
   misconfiguration is an incident.
2. **It reports everything wrong at once.** Not one variable per restart.
3. **It checks shape, not just presence.** A `JWT_SECRET` of `"changeme"` passes
   an existence check and fails `min(32)`.
4. **Everything downstream is typed.** `env.PORT` is a `number`. `env.CORS_ORIGINS`
   is a `string[]`. No `string | undefined` leaking through the codebase.

**And the rest of the codebase imports this module, never `process.env`.** That
single rule gives you a complete inventory of your configuration in one file, a
place to add a value with its validation, and testability — a service that
receives its configuration can be tested with a different one. It is also
enforceable in one line:

```bash
grep -rn "process.env" src/ | grep -v "config/env.ts"   # must print nothing
```

The schema layer in general:
[schema validation](../04-validation-and-input/02-schema-validation.md). Passing
configuration into services rather than reaching for it:
[dependency injection in practice](../09-application-architecture/05-dependency-injection-in-practice.md).

---

## Why `process.env.PORT` Is a String

Every environment variable is a string. The operating system has no other type.
This is obvious when stated and causes bugs constantly, because JavaScript will
happily do something *almost* right with a string.

| What you write | Actual value | What goes wrong |
|---|---|---|
| `process.env.PORT` | `"3333"` | A string where a number is expected |
| `process.env.MAX_RETRIES + 1` | `"31"` | Concatenation, not addition |
| `if (process.env.ENABLE_BILLING)` | `"false"` is **truthy** | The flag is on when you set it to false |
| `process.env.TIMEOUT > 5000` | String comparison | `"600" > "5000"` is `true` |
| `parseInt(process.env.TIMEOUT)` when unset | `NaN` | Propagates silently through arithmetic |
| `process.env.MISSING` | `undefined` | No error, just absent |

The third row is the one that reaches production. `ENABLE_BILLING=false` is the
string `"false"`, which is truthy, so the feature is enabled — by the variable
that was meant to disable it.

Coerce once, in the schema, and never again:

```ts
PORT: z.coerce.number().int().positive(),
ENABLE_BILLING: z.enum(['true', 'false']).transform((v) => v === 'true'),
TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
```

The underlying rules:
[equality and coercion](../../typescript-fundamentals/equality-and-coercion/equality-and-coercion.md).

---

## BROKEN vs FIXED: The Fallback That Works in Production

```ts
// ❌ BROKEN — reads the environment deep inside a service, with a default
export class TokenService {
  sign(payload: object) {
    const secret = process.env.JWT_SECRET ?? 'dev-secret'
    return jwt.sign(payload, secret, { expiresIn: '15m' })
  }
}
```

Count the failures in those four lines:

- **The fallback is a production backdoor.** Misspell the variable name in the
  deployment config — `JWT_SECRET_KEY` instead of `JWT_SECRET` — and the service
  signs real tokens with `'dev-secret'`. Anyone who has read your repository, or
  guessed a common value, can mint a valid token for any user.
- **Nothing fails.** No crash, no warning, no log line. The application works
  perfectly, which is the worst possible symptom.
- **It is invisible to audit.** The configuration is not in any one place, so
  nobody reviewing your setup can see which variables the app needs.
- **It is untestable.** The secret is fetched from global state at call time, so
  a test cannot supply its own without mutating `process.env`.

```ts
// ✅ FIXED — validated at boot, no default, passed in
import { env } from '#config/env'

export class TokenService {
  constructor(private readonly secret: string) {}

  sign(payload: object) {
    return jwt.sign(payload, this.secret, { expiresIn: '15m' })
  }
}

// composition root, once, at startup
const tokenService = new TokenService(env.JWT_SECRET)
```

> **📌 Remember the rule this illustrates: a secret never gets a default value.**
> A default for `PORT` is a convenience. A default for a signing key, a database
> password or an encryption key is a credential shipped in your source code that
> will silently activate the first time a deployment is misconfigured.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| A secret in a private repo | Private is not a vault; every clone has it | Environment or secret manager |
| Deleting the line and committing | The old commit still contains it | Rotate first; history purge is step 4 |
| `.gitignore` with only `.env` | `.env.production` is still committable | `.env.*` plus `!.env.example` |
| No `.env.example` | New developers guess; deploys miss variables | Commit it, update it in the same PR |
| Shipping a `.env` file to production | It travels into images and backups | Real environment variables from the platform |
| `process.env` scattered across services | No inventory, no types, untestable | One validated config module |
| `?? 'dev-secret'` | Silently works in production with a known key | No default for any secret |
| Checking presence but not shape | `JWT_SECRET=changeme` passes | `min(32)`, `startsWith('sk_')`, `url()` |
| Treating `"false"` as false | Non-empty strings are truthy | Coerce in the schema |
| Crashing on the first bad variable | One restart per mistake | Report all issues, then exit |
| Logging the config object at boot | The secrets go straight into your log store | Log names and validation errors only |

---

## Questions to Test Yourself

1. State the two rules at the top of this file and explain why they are separate
   rules rather than one.
2. Someone argues a private repository is a safe place for a key. Give three
   concrete reasons it is not.
3. A secret was committed last week and the line has been deleted. Is it safe?
   List the response steps in order and justify the ordering.
4. Why is purging git history step 4 rather than step 1, and what does it still
   fail to fix?
5. What are the three environment files a healthy repository has, and what is
   each one for?
6. Why is `.gitignore` containing only `.env` a bug?
7. Describe the 2 AM failure that startup validation prevents. Which property of
   the failure makes it expensive?
8. Give four benefits of a single validated config module over reading
   `process.env` where it is needed.
9. `ENABLE_BILLING=false` turns the feature on. Explain exactly why, and give the
   one-line fix.
10. Explain why `?? 'dev-secret'` is more dangerous than no fallback at all.
11. Which configuration values are allowed to have defaults, and which are never
    allowed one?

---

## Related

- [Secrets and Configuration — Part 2](05-secrets-and-configuration-part-2.md) —
  secret managers, zero-downtime rotation, encryption at rest, containers and
  CI/CD, and stopping leaks before they are committed.
- [Schema Validation](../04-validation-and-input/02-schema-validation.md) — the
  same schema tooling, applied to configuration instead of request bodies.
- [Dependency Injection in Practice](../09-application-architecture/05-dependency-injection-in-practice.md)
  — why a service receives its configuration rather than reaching for it.
- [Equality and Coercion](../../typescript-fundamentals/equality-and-coercion/equality-and-coercion.md)
  — why `"false"` is truthy and `"600" > "5000"` is true.
- [CORS](03-cors.md) — the per-environment origin list this configuration module
  should own.
- [OWASP Top 10 for APIs](01-owasp-top-10-for-apis.md) — API8, Security
  Misconfiguration.
