# Managing the Context Window

Two hours into a session on `saas-api`, you have fixed a bug, added a
migration, chased a failing test and asked three side questions. Now the agent
writes a validator with the old v5 import style you corrected an hour ago, and
calls a helper it deleted twenty minutes earlier. It is not getting stupider.
Its working memory is full of everything you did today, and your correction is
one small line somewhere in the middle.

> **📌 In one line:** the context window is the agent's only working memory,
> so keep it holding one task, the right files and nothing else, and clear it
> the moment the task changes.

## Table of Contents

1. [What Fills the Context](#what-fills-the-context)
2. [Signs the Context Is Degrading](#signs-the-context-is-degrading)
3. [One Task per Session](#one-task-per-session)
4. [Clear, Compact or Rewind](#clear-compact-or-rewind)
5. [Checking Context Usage](#checking-context-usage)
6. [Feeding the Right Files](#feeding-the-right-files)
7. [Logs, Links and Screenshots](#logs-links-and-screenshots)
8. [Common Mistakes](#common-mistakes)
9. [Questions to Test Yourself](#questions-to-test-yourself)
10. [Related](#related)

---

## What Fills the Context

The **context window** is everything the model can "see" on its next turn,
measured in tokens. [How LLMs Work](../01-foundations/02-how-llms-work-just-enough.md)
covers the theory. In practice, here is what fills it during a session:

| What | When it gets in | How big it gets |
|---|---|---|
| Memory files (CLAUDE.md) | At the start of every session | Small, if you keep them short |
| Tool, skill and MCP server descriptions | At the start | Grows with every server and plugin you enable |
| Your messages | Every prompt | Usually small |
| Files the agent reads | Each time it opens one | A 600-line controller is a lot |
| Command output | Each command it runs | A full test run or `npm install` log can be huge |
| Its own replies and plans | Every turn | Adds up over a long session |

Most of the space goes to **what the agent read and ran**, not what you
typed. And nothing leaves on its own: a log read an hour ago still competes
with what matters now.

---

## Signs the Context Is Degrading

You will rarely hit a hard limit. You will notice the quality dropping first:

- It **forgets an instruction** you gave early in the session.
- It **brings back** code or an approach you already rejected.
- It **mixes up two tasks**, e.g. adds invoice fields to the task migration.
- It **re-reads files** it already read, or asks something you already answered.
- Answers get **vaguer** and plans get longer for the same size of task.

When you see two of these, stop prompting harder. Repeating the correction
in capitals adds more text to an already crowded window. Reset instead.

---

## One Task per Session

The simplest rule in this whole part: **one task, one session.** A "task" is
one ticket, one bug or one question you are researching. When it is done (or
committed), start fresh.

```text
❌ WEAK
(same session, 90 minutes in, after fixing a mailer bug)
now also add the due_at column to invoices and while you're there
look at why the worker is slow

✅ STRONG
/clear
Add a nullable due_at timestamp to invoices with a new migration
(node ace make:migration). Update the Invoice model and validators.
Don't run the migration. Done when npx tsc --noEmit and npm test pass.
```

The STRONG version costs a few lines of re-explaining, less than you think,
because project memory (next file) loads again automatically. The slow worker
becomes its own session later.

> **💡 Tip:** if you need a quick side question mid-task ("what does
> `preload` do in Lucid?"), `/btw` asks it as a side question. For anything
> bigger, finish or park the task first.

---

## Clear, Compact or Rewind

Claude Code gives you three ways to shrink or reset context:

| Command | What it does | Use it when |
|---|---|---|
| `/clear` | Starts a new conversation with empty context. Memory files load again | The task changed. This is your default |
| `/compact [instructions]` | Replaces the conversation with a summary | Same task, long session, you need to keep going |
| `Esc Esc` or `/rewind` | Goes back to an earlier prompt; one option is "summarise from here" | A detour (wrong approach, side investigation) filled the context |

`/compact` takes **focus instructions**. Without them the summary keeps what
the model thinks matters. With them, you decide:

```text
❌ WEAK
/compact

✅ STRONG
/compact Keep: the plan in docs/plans/invoice-reminders.md, the decision to
use a BullMQ repeatable job, and the failing test name. Drop the exploration
of the mailer and the npm install output.
```

A summary is lossy: exact error messages and small decisions are the first
things to go. That is why, for multi-step work, it pays to **write the plan
and decisions to a file** in the repo. A file survives `/clear` and
`/compact` exactly, while a summary does not.
[Explore, Plan, Code, Commit](04-explore-plan-code-commit.md) shows this habit.

> **⚠️ Warning:** `/clear` throws away the conversation, not your files. Edits
> the agent already made are still on disk. Check `git status` before and
> after, as in [Git as Your Safety Net](../02-setup-and-first-session/04-git-as-your-safety-net.md).

---

## Checking Context Usage

Don't guess how full the window is. Look.

- `/context` shows a coloured grid of what is using the window right now
  (memory files, tools, MCP servers, messages), with hints.
- `/usage` (alias `/cost`) shows session cost and your plan limits.

Run `/context` at the **start** of a fresh `saas-api` session: that is your
baseline, what you pay before typing anything. If MCP servers or
plugins you never use take a big share, disable them (`/mcp`, `/plugin`);
[MCP Servers](../06-customising-your-agent/04-mcp-servers.md) covers this.
Context is also money: more tokens per turn means higher cost per turn
([Cost Models and Limits](../07-advanced/04-cost-models-and-limits.md)).

---

## Feeding the Right Files

The agent finds files by itself, with search and read tools. That is useful
and also wasteful: to answer "where is invoice sending?" it may open ten files
to find one. You can often do better by pointing.

```text
❌ WEAK
read the whole codebase and then add rate limiting to login

✅ STRONG
Add rate limiting to POST /auth/login. Relevant files:
@start/routes.ts, @app/controllers/auth_controller.ts and
@app/middleware/ (we have no rate limiter yet). Redis config is in
@config/redis.ts. Don't read anything under app/mails or database/seeders.
```

Rules of thumb:

- **Name the files you know are relevant** with `@`. The agent can still
  open others, but it starts in the right place.
- **Say what to skip** if large folders are irrelevant (seeders, fixtures,
  generated code).
- **Ask for the narrow thing:** "show me the `send` method" instead of "explain
  the invoices module".
- **Delegate noisy research** to a subagent: its reading happens in its own
  context, and only the answer comes back. See
  [Subagents](../06-customising-your-agent/05-subagents.md).

---

## Logs, Links and Screenshots

**Logs.** Paste the part that matters, not everything. The error, the stack
trace and the few lines before it beat a 5,000-line log. When the agent runs
commands itself, ask it to keep the output short:

```text
❌ WEAK
run all the tests and show me the output

✅ STRONG
Run npm test -- --files tests/functional/invoices.spec.ts and report only
the failing test names and their first error line.
```

`!` at the start of a prompt runs a shell command and puts its output in the
session: handy for `!git status`, wasteful for `!npm install`.

**Links.** Claude Code can fetch a web page if you allow it. A link to the
exact docs page (AdonisJS v6 VineJS validation) beats the model's memory of a
library, which may be older than the version in your `package.json`.

**Screenshots.** For front-end or UI bugs, an image of what is wrong can say
more than a paragraph. Whether and how you can paste images depends on your
tool and terminal, so check `/help` or the
[docs](https://code.claude.com/docs/en/interactive-mode) at the time of
writing (2026).

> **📌 Remember:** everything you add stays until you clear it. Before you
> paste, ask: will the agent need this for the *rest* of the task?

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| One long session for the whole day | Old tasks crowd out the current one | `/clear` between tasks |
| Repeating a forgotten instruction louder | Adds text to a full window | `/clear` or `/compact` with focus, then restate once |
| Bare `/compact` | The summary may drop the decision you need | Give focus instructions |
| Keeping the plan only in the chat | Summaries lose detail; `/clear` loses all of it | Write the plan to a file |
| Pasting whole logs | Most of it is noise | Paste the error and nearby lines |
| Leaving unused MCP servers enabled | Their descriptions cost context every session | Check `/context`, disable with `/mcp` |

---

## Questions to Test Yourself

1. The agent re-adds a function you told it to delete an hour ago. What is
   the likely cause, and what are your two options?
2. You have finished the invoice bug and want to start on the worker. Which
   command do you use, and what still loads automatically afterwards?
3. Write a `/compact` instruction for a session where the important parts are
   a migration filename and two failing test names.
4. Why does writing the plan to a file beat relying on `/compact`?
5. What does `/context` at the start of a fresh session tell you?
6. Your test suite prints 3,000 lines. How do you let the agent run it without
   filling its context?

---

## Related

- [Writing Good Task Prompts](01-writing-good-task-prompts.md) — what to put
  into the window in the first place.
- [Project Memory with CLAUDE.md](03-project-memory-with-claude-md.md) — what
  loads into every session automatically.
- [Explore, Plan, Code, Commit](04-explore-plan-code-commit.md) — the plan
  file that survives `/clear`.
- [How LLMs Work — Just Enough](../01-foundations/02-how-llms-work-just-enough.md)
  — tokens and the context window in theory.
- [Cost Models and Limits](../07-advanced/04-cost-models-and-limits.md) — why
  a full context also costs more.
