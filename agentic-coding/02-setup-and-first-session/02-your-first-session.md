# Your First Session

It is installed and logged in. The temptation is to type "build invoice
reminders with a BullMQ job and email templates" and watch. Do not. Your first
session should be boring on purpose: ask questions that change nothing, watch
how the agent works, then make one change so small you can check every line.

> **📌 In one line:** start in the repo on a clean branch, check `/status`,
> ask read-only questions until you trust how it explores, make one tiny
> verified change, review the diff yourself, and know how to stop, end and
> resume.

## Table of Contents

1. [Before You Start](#before-you-start)
2. [Starting a Session](#starting-a-session)
3. [Read-Only Questions First](#read-only-questions-first)
4. [Reading the Interface](#reading-the-interface)
5. [A First Tiny Change](#a-first-tiny-change)
6. [Stopping, Ending and Resuming](#stopping-ending-and-resuming)
7. [Shortcuts and Essential Slash Commands](#shortcuts-and-essential-slash-commands)
8. [Common Mistakes](#common-mistakes)
9. [Questions to Test Yourself](#questions-to-test-yourself)
10. [Related](#related)

---

## Before You Start

Three commands, every time. File 04 explains why.

```text
$ cd ~/code/saas-api
$ git status
nothing to commit, working tree clean        ← anything that changes now is the agent's
$ git switch -c chore/first-agent-session    ← a branch you can throw away
```

Also check `.env` points at your **local** Postgres and Redis, not a shared
one: the agent's commands use whatever your `.env` says.

---

## Starting a Session

```text
$ claude                                     # interactive session in this directory
$ claude "explain the folder structure"      # same, with a first prompt
```

The directory you start in becomes the project the agent works in, so start
at the repository root. Your first command in any new setup is `/status`: it
shows the version, model, account (file 01) and which settings files loaded.
Note the **permission mode** too — file 03 explains modes; change nothing yet.

---

## Read-Only Questions First

Questions are safe: answering them only needs reading and searching. Start
with ones whose answers you already know, so you can judge the quality.

```text
> How is GET /tasks implemented? Trace it from the route to the database
  query, with file paths and line numbers.

  Search  "tasks" in start/routes.ts
  Read    start/routes.ts
  Read    app/controllers/tasks_controller.ts
  Read    app/validators/task.ts

  GET /tasks is registered in start/routes.ts:31 inside the `auth()`
  middleware group and handled by TasksController.index
  (app/controllers/tasks_controller.ts:12). index() validates the query
  with listTasksValidator (app/validators/task.ts:8), then builds a query
  scoped to the user's company (line 18) and paginates with `limit`...
```

*(Illustrative; your screen will differ.)* Now check it. Open
`tasks_controller.ts:18` — is it really scoped to the company? This is the
habit for the whole track: **the agent's explanation is a claim; the file is
the evidence.** Other good first questions: "How do I run the tests?", "Where
is authentication checked?", "Which file would I change to add a field to the
task list response?"

```text
❌ WEAK   explain the code
✅ STRONG Explain how a request to GET /tasks is authorised. Cite file and
          line for each step, and say if any step is missing.
```

---

## Reading the Interface

Four things appear on screen. Learn to read each.

| What you see | What it means | What you do |
|---|---|---|
| **Your prompt** | The input box at the bottom | Type tasks; `@` mentions a file; `!` runs a shell command |
| **Tool calls** | Lines like `Read app/models/task.ts` or `Bash node ace test` | Watch what it reads and runs — the loop from Part 1 |
| **Permission prompts** | It wants to do something not yet allowed, and waits | Read the exact file or command, then approve or decline |
| **Diffs** | Proposed file changes as `-` and `+` lines | Read them before approving; they are your code now |

A permission prompt looks roughly like this (illustrative; wording varies by
version):

```text
  Bash  node ace test --files tests/functional/tasks.spec.ts

  Allow this command?
  › Yes
    Yes, and don't ask again for similar commands
    No, and tell Claude what to do differently
```

Read the **command itself**, not the agent's description of it. Choosing
"No" is not failure — you can tell it what to do instead. And if it is heading
the wrong way, press `Esc`: it stops mid-turn and keeps the work done so far.

---

## A First Tiny Change

Something real, small and testable: `GET /tasks?limit=5000` currently returns
5,000 rows. Cap `limit` at 100 and return 422 above it.

```text
> In app/validators/task.ts, cap `limit` in listTasksValidator at 100 so
  GET /tasks?limit=500 returns 422. Add one test to
  tests/functional/tasks.spec.ts following the existing tests, then run
  only that file with `node ace test --files tests/functional/tasks.spec.ts`.
  Change nothing else.

  Read    app/validators/task.ts
  Read    tests/functional/tasks.spec.ts
  Edit    app/validators/task.ts
  │ -    limit: vine.number().min(1).optional(),
  │ +    limit: vine.number().min(1).max(100).optional(),
  Edit    tests/functional/tasks.spec.ts
  │ +  test('rejects limit above 100', async ({ client }) => {
  │ +    const response = await client.get('/tasks').qs({ limit: 500 }).loginAs(user)
  │ +    response.assertStatus(422)
  │ +  })
  Bash    node ace test --files tests/functional/tasks.spec.ts
          ✔ 10 passed

  Done: limit is capped at 100 and a test covers limit=500.
```

*(Illustrative.)* Each `Edit` and the `Bash` line may stop for your approval,
depending on your mode. Then review it yourself, outside the agent:

```text
$ git diff --stat
 app/validators/task.ts         | 2 +-
 tests/functional/tasks.spec.ts | 5 +++++
$ node ace test --files tests/functional/tasks.spec.ts
```

Or use VS Code's Source Control view. Then ask the roadmap's questions. *What
happens without it?* A client can fetch every task at once. *What can go
wrong?* A client that sends `limit=200` now gets 422 — or should it be clamped
to 100 instead? The agent did not ask. That decision is yours.

---

## Stopping, Ending and Resuming

| You want to | Do this |
|---|---|
| Stop the current action, keep the session | `Esc` |
| Undo recent changes to code or conversation | `Esc Esc` on an empty prompt, or `/rewind` (file 04 covers the limits) |
| Start a fresh conversation for a new task | `/clear` |
| Exit | `Ctrl+C` to clear the input, again to exit |
| Continue the latest conversation in this directory | `claude -c` (`--continue`) |
| Pick an older session | `claude -r` (opens a picker), or `/resume` inside a session |

One task per session: once the limit task is committed, `/clear` before the
next, so old output does not crowd the context window (Part 3).

---

## Shortcuts and Essential Slash Commands

| Shortcut | Does |
|---|---|
| `Esc` / `Esc Esc` | Interrupt mid-turn / open the rewind menu (empty input) |
| `Shift+Tab` | Cycle permission modes (file 03) |
| `@` | Mention a file, with path autocomplete |
| `!` at the start | Shell mode: `! git status` runs it and puts the output in the session |
| `\` then Enter, or `Ctrl+J` | New line in your prompt (any terminal) |
| `Shift+Enter` | New line in many terminals; run `/terminal-setup` for VS Code's terminal |
| `Ctrl+G` | Edit the prompt in your editor — handy for long prompts |
| `?` (empty input) | Show all shortcuts |

| Command | Does |
|---|---|
| `/help` | List commands |
| `/status` | Version, model, account, setting sources |
| `/clear` | New conversation, empty context |
| `/context` | Show how full the context window is |
| `/usage` (or `/cost`) | Cost, plan limits and activity |
| `/model` | Switch model, e.g. `/model sonnet` |
| `/diff` | Show the changes |
| `/init` | Generate a starter `CLAUDE.md` (Part 3 — wait until then) |

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Starting with a big feature | You cannot judge output you cannot fully review yet | Read-only questions, then one tiny change |
| Starting `claude` in your home directory | It works on the wrong folder and sees unrelated files | `cd` to the repo root first |
| Approving prompts by reading only the summary | The summary can differ from the command | Read the exact command or diff |
| Trusting "10 passed" from the transcript | You did not see which tests ran | Run the command yourself |
| One endless session for every task | Old context crowds and confuses new work | `/clear` between unrelated tasks |

---

## Questions to Test Yourself

1. The agent says `GET /tasks` is scoped to the user's company at line 18.
   How do you verify that in under a minute?
2. Mid-way through an edit you realise it is changing the wrong validator.
   Which key do you press, and what happens to the work done so far?
3. Yesterday you started a session on the limit task. How do you continue it
   today from the terminal?
4. The limit change returns 422 for `limit=200`. Name one client that might
   break, and the alternative behaviour you could choose.
5. Why should your first session start on a new branch with a clean
   `git status`?
6. You want to write a 15-line prompt. Which two shortcuts make that easier?

---

## Related

- [Installing and Authenticating](01-installing-and-authenticating.md) — what
  `/status`'s account line should say.
- [Permissions and Modes](03-permissions-and-modes.md) — what each prompt is
  asking and what never to approve.
- [Git as Your Safety Net](04-git-as-your-safety-net.md) — the clean tree,
  the branch, and undoing.
- [Writing Good Task Prompts](../03-prompting-and-context/01-writing-good-task-prompts.md)
  — the next step after a tiny change.
- Official docs: [quickstart](https://code.claude.com/docs/en/quickstart),
  [interactive mode](https://code.claude.com/docs/en/interactive-mode),
  [commands](https://code.claude.com/docs/en/commands).
