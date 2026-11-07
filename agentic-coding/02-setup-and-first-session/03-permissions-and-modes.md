# Permissions and Modes

Forty minutes into a session, you have approved twenty prompts: reads, edits,
`node ace test`, `node ace test` again. The twenty-first says
`Bash node ace migration:fresh` and you press Enter before your eyes reach the
end of the line. `migration:fresh` drops every table. Your `.env` points at the
team's shared staging database.

Permission prompts only protect you if you read them. This file explains what
they are asking, which modes change how often they appear, and the short list
of actions you never let through without thinking.

> **📌 In one line:** a permission prompt asks "may I run this exact thing?" —
> answer by asking what it changes, whether git can undo it and whether it
> leaves your machine; choose a mode on purpose, and never auto-approve
> deletions, pushes, migrations, secrets or anything touching shared systems.

## Table of Contents

1. [What a Permission Prompt Is Asking](#what-a-permission-prompt-is-asking)
2. [Four Questions Before You Approve](#four-questions-before-you-approve)
3. [The Permission Modes](#the-permission-modes)
4. [Which Mode When](#which-mode-when)
5. [Never Auto-Approve These](#never-auto-approve-these)
6. ["Don't Ask Again" and Where It Goes](#dont-ask-again-and-where-it-goes)
7. [❌ WEAK vs ✅ STRONG: Prompts Are Not Guardrails](#-weak-vs--strong-prompts-are-not-guardrails)
8. [Common Mistakes](#common-mistakes)
9. [Questions to Test Yourself](#questions-to-test-yourself)
10. [Related](#related)

---

## What a Permission Prompt Is Asking

Recall from Part 1: the model asks for a tool call, and the **harness** decides
whether to run it. When an action is not already allowed, the harness stops
and asks you. Every prompt contains:

- **The tool** — `Edit`, `Bash`, `WebFetch`…
- **The exact input** — the file path and diff, or the full command line.
- **Your choices** — usually approve once, approve and stop asking for similar
  actions, or decline and tell it what to do instead.

Reads are generally allowed without asking. Edits and commands are where
prompts appear, depending on the mode.

> **📌 Remember:** you are approving the **input**, not the agent's sentence
> above it. "Let me clean up the build output" followed by
> `rm -rf build storage` is a request to delete your uploads folder.

---

## Four Questions Before You Approve

| Question | Example that should make you stop |
|---|---|
| **What does it change?** | `sed -i` across 40 files; `npm install some-new-package` |
| **Can git undo it?** | `rm` of an untracked file; anything inside `.env`, `node_modules` or a database |
| **Does it leave my machine?** | `git push`, `curl -X POST`, `npm publish`, `ssh`, a deploy script |
| **Does it touch secrets or shared systems?** | `cat .env`; `psql` with a remote host; a migration when `DATABASE_URL` is not local |

If every answer is "nothing much / yes / no / no", approve. Otherwise slow
down, read the whole line, and decline if unsure — declining costs nothing.

Some illustrative prompts and a sensible answer:

| Prompt | Answer |
|---|---|
| `Edit app/validators/task.ts` with a 2-line diff you have read | Approve |
| `Bash node ace test --files tests/functional/tasks.spec.ts` | Approve |
| `Bash npm install dayjs-business-days-plus` | Decline; check the package exists and is the one you want first |
| `Bash rm -rf tmp/ storage/` | Decline; ask what it is trying to achieve |
| `Bash git push origin feature/due-date` | Decline; you push, after review (file 04) |
| `Bash node ace migration:run` | Only after checking `DATABASE_URL` is your local Docker database |

---

## The Permission Modes

A **mode** decides which actions run without asking. At the time of writing
(2026) Claude Code has six:

| Mode | Runs without asking | Use it for |
|---|---|---|
| `default` or `manual` (shown as "Manual") | Reads only | Learning; anything sensitive |
| `acceptEdits` | Reads, file edits, and common filesystem commands (`mkdir`, `touch`, `mv`, `cp`) | Implementing on a clean branch you will review |
| `plan` | Exploring and reading; **no edits** | Understanding and planning before any change |
| `auto` | Everything, with a classifier (an automatic safety check) reviewing each action | Later, once you know what you are delegating |
| `dontAsk` | Only pre-approved tools and reads; anything else is denied (CLI only) | Scripts and CI (Part 7) |
| `bypassPermissions` | Everything, no checks | Throwaway containers or VMs only — never your laptop |

How to switch:

- **`Shift+Tab`** cycles `default → acceptEdits → plan → auto → default`.
- **Start in a mode:** `claude --permission-mode plan`.
- **Check where you are:** run `/status`. The mode a new session starts in can
  vary (a `defaultMode` setting changes it), so check rather than assume.

Two safety nets apply whatever the mode:

- **Protected paths** such as `.git`, `.claude` and `.bashrc` are never
  auto-approved, except in `bypassPermissions`.
- **Deny rules** (Part 6) block an action in **every** mode.

> **⚠️ Warning:** `--dangerously-skip-permissions` is the same as
> `bypassPermissions`. The name is honest. On your own machine, the agent
> could delete files, read `~/.ssh` or push to any repository your user can.
> Use it only in an isolated container you can throw away.

---

## Which Mode When

A simple progression for your first weeks:

| Situation | Mode |
|---|---|
| First week; any repo you do not know | `default` — see every edit and command |
| "How does this work?" / "plan this feature" | `plan` (or `/plan`) — it cannot edit even if it wants to |
| Implementing on a clean branch, plan already reviewed | `acceptEdits` — edits flow, most commands still ask |
| Touching auth, payments, migrations, CI config | Back to `default` |
| Repetitive, low-risk work you understand well | `auto` — after Part 6, when you have deny rules in place |

`acceptEdits` is safe precisely *because* of file 04: on a clean branch, every
edit is visible in `git diff` and undoable with `git restore`. Commands are a
different matter — they can reach things git does not track — so in
`acceptEdits`, anything beyond simple file commands still asks.

> **💡 Tip:** Linux also supports sandboxing: `/sandbox` runs Bash commands in a
> restricted environment with no network by default. It is a useful extra layer;
> Part 7 covers it with the rest of agent security.

---

## Never Auto-Approve These

Not "never allow" — sometimes they are exactly right. But each one deserves you
reading the full line, every time, and none belongs in an always-allow rule.

| Action | Why |
|---|---|
| `rm`, `rm -rf`, `find … -delete`, `git clean` | Untracked or ignored files are gone for good; checkpoints do not track Bash |
| `git push` (especially `--force`), `git reset --hard` | Push is public and may trigger CI/deploys; `reset --hard` discards work |
| Migrations: `node ace migration:run`, `migration:rollback`, `migration:fresh`, `db:seed` | Changes data git cannot restore; safe only on a local DB you can rebuild |
| Anything reading or writing `.env`, keys, `~/.ssh`, `~/.aws` | Secrets end up in the context window and possibly in logs or commits |
| `npm install <new package>` | Install scripts run code on your machine; the name may be hallucinated |
| `docker compose down -v`, `docker volume rm` | Deletes your local database volume |
| `curl … \| bash`, `ssh`, `scp`, deploy scripts, anything with a prod host | Leaves your machine; reaches shared or production systems |
| Editing CI files or `package.json` scripts | Changes what runs automatically for everyone later |

> **⚠️ Warning:** the safest production setup is that your laptop **has no
> production credentials** in its environment at all. Then no mode and no
> mistaken approval can reach production.

---

## "Don't Ask Again" and Where It Goes

Choosing "yes, and don't ask again" creates an **allow rule**: future matching
actions run without a prompt. That is the right answer for `node ace test` and
the wrong answer for `rm`.

- `/permissions` shows and manages your current allow, ask and deny rules.
- Rules live in settings files, which can be per-user, per-project (committed
  for the team) or local to you.
- **Deny beats ask beats allow**, so you can, for example, deny reading `.env`
  in a way no approval can override.

The rule *syntax* and a sensible `saas-api` settings file are Part 6 file 01.
For now: say "don't ask again" only to commands that are read-only or that
only touch tracked files, and look at `/permissions` once a week.

---

## ❌ WEAK vs ✅ STRONG: Prompts Are Not Guardrails

```text
❌ WEAK
Fix the failing invoice tests. Don't touch the database.
```

"Don't touch the database" is a request, not a rule. Models usually follow it,
but nothing enforces it — a later step may decide a migration is "needed".

```text
✅ STRONG
Fix the failing tests in tests/functional/invoices.spec.ts.
Run only: node ace test --files tests/functional/invoices.spec.ts
If you believe a migration or new package is needed, stop and explain why
instead of running it.
```

…and, separately, stay in `default` mode so a migration command would still
need your approval. The prompt sets expectations; **the permission system
enforces them.** Rules that can never have exceptions belong in deny rules
and hooks (Part 6), not only in prose.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Approving on reflex after many safe prompts | The dangerous prompt looks just like the safe ones | Read the full input; decline when unsure |
| "Don't ask again" for broad commands | It becomes an allow rule for every future match | Only for read-only or tracked-file commands |
| Using `bypassPermissions` on your laptop | Nothing stands between the agent and your files, keys and remotes | Containers or VMs only |
| Relying on "please don't" in the prompt | Prose is not enforcement | Use the mode, and deny rules in Part 6 |
| Assuming the starting mode | It can vary with settings | Check `/status` |
| Keeping prod credentials in your shell | One wrong approval reaches production | No prod credentials on the dev machine |

---

## Questions to Test Yourself

1. The prompt reads "Cleaning temporary files" and the command is
   `rm -rf tmp storage`. What do you do, and what question do you ask the agent?
2. Name the mode you would use for "explain how invoices are generated and
   propose a plan for reminders", and why it is safer than `default`.
3. In `acceptEdits`, the agent edits five files without asking. Why is that
   acceptable on a clean branch, and why does `node ace test` still ask?
4. The agent wants to run `node ace migration:run`. What do you check before
   approving?
5. Your prompt said "don't install packages", and it asks to `npm install` one.
   What does this tell you about prompts versus permissions?
6. Why is "no production credentials on this machine" stronger than any mode?

---

## Related

- [Your First Session](02-your-first-session.md) — where these prompts appear.
- [Git as Your Safety Net](04-git-as-your-safety-net.md) — why edits are
  cheap to undo and Bash side effects are not.
- [The Agent Loop and Tools](../01-foundations/03-the-agent-loop-and-tools.md)
  — the harness that asks for permission.
- [Explore, Plan, Code, Commit](../03-prompting-and-context/04-explore-plan-code-commit.md)
  — plan mode in a real workflow.
- [Settings and Permission Rules](../06-customising-your-agent/01-settings-and-permission-rules.md)
  — the rule syntax and a `saas-api` settings file.
- [Prompt Injection and Agent Security](../07-advanced/03-prompt-injection-and-agent-security.md)
  — why limits matter when the agent reads untrusted text.
- [Your Dependencies Are Your Code](../../cybersecurity/04-supply-chain-and-dependencies/01-your-dependencies-are-your-code.md)
  — what `npm install` actually runs.
- Official docs: [permission modes](https://code.claude.com/docs/en/permission-modes),
  [permissions](https://code.claude.com/docs/en/permissions).
