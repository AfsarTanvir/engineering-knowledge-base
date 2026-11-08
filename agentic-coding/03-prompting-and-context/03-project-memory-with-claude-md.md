# Project Memory with CLAUDE.md

Every new session starts with an agent that has never seen `saas-api`. It
does not know that tests need Docker, that money is in cents, or that editing
an old migration broke staging last month. So you explain again. One day you
forget, and the agent edits `1712_create_invoices.ts` "to add the missing
column". A memory file lets you write those facts down once.

> **📌 In one line:** `CLAUDE.md` is a short file of project facts and rules
> that loads into every session; keep it to what the agent cannot guess, and
> remember it is advice, not enforcement.

## Table of Contents

1. [What a Memory File Is](#what-a-memory-file-is)
2. [Where Memory Files Live](#where-memory-files-live)
3. [What Goes In and What Stays Out](#what-goes-in-and-what-stays-out)
4. [A First Draft with /init](#a-first-draft-with-init)
5. [An Example CLAUDE.md for saas-api](#an-example-claudemd-for-saas-api)
6. [BROKEN vs FIXED: The Bloated Memory File](#broken-vs-fixed-the-bloated-memory-file)
7. [Imports, Rules Files and AGENTS.md](#imports-rules-files-and-agentsmd)
8. [CLAUDE.md, Skill or Hook?](#claudemd-skill-or-hook)
9. [Common Mistakes](#common-mistakes)
10. [Questions to Test Yourself](#questions-to-test-yourself)
11. [Related](#related)

---

## What a Memory File Is

A **memory file** is a markdown file the agent reads at the start of every
session. Claude Code calls it `CLAUDE.md`. Think of the onboarding note for a
new teammate: how to run things, where code lives, which rules never bend.

It is **not** learning: the agent just reads this file every time. It also
uses context ([previous file](02-managing-the-context-window.md)), so every
line is paid for in every session. The docs suggest under about 200 lines per
file; for one project, aim far lower.

---

## Where Memory Files Live

| File | Scope | Commit it? |
|---|---|---|
| `~/.claude/CLAUDE.md` | You, in every project | No (it is in your home folder) |
| `./CLAUDE.md` or `./.claude/CLAUDE.md` | This project, for everyone | **Yes** |
| `./CLAUDE.local.md` | This project, only you | No: add to `.gitignore` |
| `CLAUDE.md` in a subfolder | Loads when the agent works in that folder | Yes |

Files in the start folder **and every parent folder** load at launch and
are concatenated; subfolder files load on demand. Personal preferences ("keep
answers short") go in the user file; project facts go in the repo.

Edit them in any editor or with `/memory`, which also toggles **auto memory**
(Claude keeping its own notes on a repo; skim what it writes, nobody reviewed
it). Details: [memory docs](https://code.claude.com/docs/en/memory) (2026).

---

## What Goes In and What Stays Out

The test for every line: **would the agent get this wrong without it?**

| Put in | Keep out |
|---|---|
| Commands: dev, test, one test file, type check, lint, migrations | Things it can read in seconds (the full `package.json`) |
| Layout: where routes, services, validators, jobs live | A file-by-file tour of the repo |
| Conventions that differ from the framework default | Generic advice ("write clean code", "use TypeScript") |
| Gotchas that have bitten you | Long explanations and history |
| "Never do X" rules, with the alternative | Secrets, URLs with tokens, customer data |
| Where to look for more (`docs/architecture.md`) | Step-by-step workflows you use once a week |

> **⚠️ Warning:** `CLAUDE.md` is committed. Never put a password, API key or
> connection string in it, not even "temporarily".

---

## A First Draft with /init

Run `/init` in the project folder. Claude Code reads the repo (and other
tools' instruction files, if any) and writes a starter `CLAUDE.md`, or
suggests improvements to an existing one. Treat it as a draft from someone who
has read your code for five minutes: it finds commands and layout, but not
your team's rules or last month's incident. Delete the generic lines and add
the "never" rules yourself.

---

## An Example CLAUDE.md for saas-api

An **example to adapt**, not to copy: check every command works in your repo.

```md
# saas-api

AdonisJS 6 + TypeScript API for a multi-tenant SaaS (users, companies,
projects, tasks, invoices). PostgreSQL via Lucid, Redis, a BullMQ worker.
The Next.js front end is a separate repo that calls this API.

## Commands
- Start Postgres + Redis: `docker compose up -d`
- Dev server: `npm run dev`
- All tests: `npm test` (Japa; needs Docker services running)
- One file: `npm test -- --files tests/functional/invoices.spec.ts`
- Type check: `npx tsc --noEmit`   Lint: `npm run lint`
- New migration: `node ace make:migration <name>`
- Migration state: `node ace migration:status`
- Apply migrations (local DB only, ask first): `node ace migration:run`
- List routes: `node ace list:routes`

## Layout
- `start/routes.ts`: all routes
- `app/controllers`: thin; validate, authorize, call a service
- `app/services`: business logic
- `app/validators`: VineJS validators
- `app/policies`: authorization (Bouncer)
- `app/jobs`: BullMQ jobs, run by the separate worker process

## Conventions
- Tenant data is always scoped by `company_id` from `auth.user`, never from
  the request body or URL.
- Reuse helpers in `app/helpers/` (paginate, money) before writing new ones.
- Money is integer cents, never floats.
- Throw the exceptions in `app/exceptions/`; no ad-hoc error JSON.
- New behaviour needs a test in `tests/functional` or `tests/unit`.

## Never
- Never edit a migration that has already run. Create a new one.
- Never read, print or edit `.env` or `.env.*`. Keys are in `.env.example`.
- Never run `migration:rollback`, `db:seed` or anything against staging/prod.
- Never add an npm dependency without asking me first.
- Never skip, weaken or delete a test to make it pass. Stop and tell me.
- Never `git push`.

## Gotchas
- Read config with `env.get()` from `#start/env`, not `process.env`.
- The worker is a separate process: restart it after changing job code.
- Tests use the `saas_api_test` database and truncate tables between runs.
```

About 45 lines, with no AdonisJS tutorial, style guide or model list. Each
"never" names the safe alternative where there is one.

---

## BROKEN vs FIXED: The Bloated Memory File

```md
<!-- ❌ BROKEN - 400 lines, mostly things the agent knows or can read -->
## Coding style
- Write clean, readable, maintainable code.
- Use meaningful variable names.
- Follow SOLID principles.
## Models
- User has id, email, password, company_id, created_at, updated_at...
  (40 more lines copied from the migrations)
## How to add a feature
1. Create a branch. 2. Write a validator. 3. ... (60 lines)
```

None of this changes what the agent does. It buries the rule that matters,
and the model list goes stale the day someone adds a column.

```md
<!-- ✅ FIXED - only what it would get wrong, plus a pointer -->
- Money is integer cents, never floats.
- Never edit a migration that has already run. Create a new one.
- Architecture decisions: see docs/architecture.md (read when relevant).
```

The feature workflow moves to a **skill**, loaded only when used (table below).

---

## Imports, Rules Files and AGENTS.md

**Imports.** A line `@docs/architecture.md` in `CLAUDE.md` pulls that file in
(relative to the importing file). It still costs context every session.

**Path-scoped rules.** `.claude/rules/*.md` files with `paths` frontmatter
apply only to matching files, e.g. migration rules for
`database/migrations/**`.

**AGENTS.md.** Some other tools read a file called `AGENTS.md`. At the time
of writing, Claude Code reads `AGENTS.md` directly only if there is no
`CLAUDE.md`. To share one file between tools, keep the content in `AGENTS.md`
and put a single line `@AGENTS.md` in your `CLAUDE.md`.

---

## CLAUDE.md, Skill or Hook?

`CLAUDE.md` is a **request** the agent usually follows. "Never read `.env`"
there is a good reminder; a deny rule is what actually stops the read.

| You want | Use | Why | Part 6 |
|---|---|---|---|
| A fact or convention in every session | `CLAUDE.md` | Always loaded, cheap if short | (this file) |
| A workflow you run sometimes ("new migration", "review my diff") | A skill | Loaded only when used | [02-custom-commands-and-skills](../06-customising-your-agent/02-custom-commands-and-skills.md) |
| A rule with **no** exceptions (never read `.env`) | A permission deny rule | Enforced by the tool, in every mode | [01-settings-and-permission-rules](../06-customising-your-agent/01-settings-and-permission-rules.md) |
| Something that must happen every time (format after each edit) | A hook | Runs as code, not as advice | [03-hooks](../06-customising-your-agent/03-hooks.md) |

> **📌 Remember:** if breaking a rule would cost you a secret, a database or a
> production incident, `CLAUDE.md` alone is not enough. Write it there *and*
> enforce it with a rule or hook.

**Keeping it current.** Change `CLAUDE.md` in pull requests like code, and
delete stale lines. When the agent makes the same mistake twice, add one line
and check that the next session gets it right.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Copying the `/init` draft as is | Generic, and it misses your team's rules | Delete the generic lines, add your "never" rules |
| A 400-line memory file | Costs context every session; rules get lost | Keep it short; move workflows to skills |
| Relying on `CLAUDE.md` for hard rules | It is advice the agent can ignore | Deny rules and hooks (Part 6) |
| Secrets or connection strings in it | It is committed and widely read | `.env.example` with key names only |
| Never updating it | It drifts from reality and misleads | Update it in PRs when the code changes |

---

## Questions to Test Yourself

1. The agent keeps running `npm run test:all`, which does not exist. Where do
   you fix that so it never happens again?
2. Why does "write clean, maintainable code" not belong in `CLAUDE.md`?
3. Your team also uses a tool that reads `AGENTS.md`. How do you avoid two
   files drifting apart?
4. Why does "never read `.env`" belong in `CLAUDE.md` *and* somewhere else?
5. You have a 30-line checklist for adding a BullMQ job. Memory file or
   skill? Why?

---

## Related

- [Managing the Context Window](02-managing-the-context-window.md) — why every
  line of memory has a cost.
- [Settings and Permission Rules](../06-customising-your-agent/01-settings-and-permission-rules.md)
  — enforcing what `CLAUDE.md` only asks for.
- [Hooks](../06-customising-your-agent/03-hooks.md) — automation that always
  runs.
- [Working with Agents on a Team](../07-advanced/06-working-with-agents-on-a-team.md)
  — a shared `CLAUDE.md` as a team document.
- [Secrets and Configuration — Part 1](../../backend-fundamentals/11-api-security/05-secrets-and-configuration-part-1.md)
  — why `.env` stays out of everything.
