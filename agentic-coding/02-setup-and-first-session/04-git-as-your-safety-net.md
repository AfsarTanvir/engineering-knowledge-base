# Git as Your Safety Net

You let the agent work on the due-date filter while you had half-finished
changes of your own in the same files. It edited eight files, ran a migration
and installed a package. Now something is broken and `git diff` shows your work
and its work mixed together. Which lines are yours? And `/rewind` restored the
code — but the new column is still in your database and the package is still
in `node_modules`.

Git keeps every agent change visible and reversible — and it covers more than
the agent's own edits, which is where checkpoints stop.

> **📌 In one line:** start every task on a new branch with a clean
> `git status`, review with `git diff`, commit small verified steps yourself,
> undo with `git restore` — and remember that checkpoints do not undo
> commands, so migrations, installs and `rm` need git, backups or care.

## Table of Contents

1. [Clean Tree and Branch, Every Time](#clean-tree-and-branch-every-time)
2. [Reviewing What Changed](#reviewing-what-changed)
3. [Small Commits](#small-commits)
4. [Undoing with Git](#undoing-with-git)
5. [Checkpoints and Rewind](#checkpoints-and-rewind)
6. [What Neither Can Undo](#what-neither-can-undo)
7. [Why the Agent Should Not Push](#why-the-agent-should-not-push)
8. [BROKEN vs FIXED: Starting a Task](#broken-vs-fixed-starting-a-task)
9. [Common Mistakes](#common-mistakes)
10. [Questions to Test Yourself](#questions-to-test-yourself)
11. [Related](#related)

---

## Clean Tree and Branch, Every Time

A **clean working tree** means `git status` reports no changes: everything is
committed. Start every agent task from one, on its own branch.

```text
$ git status
On branch main
nothing to commit, working tree clean

$ git switch -c feat/tasks-due-before
Switched to a new branch 'feat/tasks-due-before'
```

Why both:

- **Clean tree** → every change afterwards is the agent's, and
  `git restore .` cannot destroy your own work.
- **Branch** → `main` stays untouched; a bad attempt is one deleted branch.

Half-finished work? Commit it, or `git stash` it (`git stash pop` later).

> **📌 Remember:** git only protects files it **tracks**. `.env`, your local
> database, `node_modules`, uploads in `storage/` and anything in `.gitignore`
> are invisible to it. Keep a copy of `.env` somewhere safe.

---

## Reviewing What Changed

After the agent says "Done", look before anything else:

```text
$ git status --short
 M app/controllers/tasks_controller.ts
 M app/validators/task.ts
 M tests/functional/tasks.spec.ts
?? database/migrations/1730700000000_add_due_date_index.ts   ← new, untracked

$ git diff --stat           # size of the change per file
$ git diff                  # every changed line in tracked files
$ git diff -- app/validators/task.ts
```

`git diff` does **not** show untracked (`??`) files. New files are easy to
miss — here, a migration you did not ask for. Open them directly.

VS Code's **Source Control** view shows each changed file side by side, and
`/diff` shows changes inside a session. Use whichever makes you read every line.

For every agent diff ask: did it change only what I asked? Any new
dependencies? Did it change, skip or delete a test? Can I explain every line?

---

## Small Commits

Commit each step that works, instead of one large commit at the end.

```text
$ node ace test --files tests/functional/tasks.spec.ts     # verify yourself
$ git add app/validators/task.ts tests/functional/tasks.spec.ts
$ git commit -m "Validate dueBefore query param on GET /tasks"
```

Each commit is a known-good point you can return to with one command, and
each review stays small enough to do properly.

You may let the agent make local commits after you have reviewed the change;
you still decide when a step is done. (Commit messages and PRs: Part 4.)

> **💡 Tip:** `git add -p` lets you stage a change hunk by hunk — a good way to
> force yourself to read each one, and to leave out a stray debug line.

---

## Undoing with Git

| To undo… | Command |
|---|---|
| Changes to one tracked file | `git restore app/controllers/tasks_controller.ts` |
| All changes to tracked files | `git restore .` |
| Something you staged with `git add` | `git restore --staged <file>` |
| New untracked files — **preview first** | `git clean -n` then `git clean -fd` |
| The last local commit, keeping its changes | `git reset --soft HEAD~1` |
| The whole attempt | `git switch main` then `git branch -D feat/tasks-due-before` |

> **⚠️ Warning:** `git restore .` and `git clean -fd` cannot be undone, and
> `git clean` deletes untracked files including ones you made yourself. This is
> exactly why you start from a clean tree: then the only things to throw away
> are the agent's.

---

## Checkpoints and Rewind

Claude Code saves a **checkpoint** before each of your prompts: a snapshot of
the files it has edited and of the conversation. Press `Esc Esc` on an empty
prompt, or type `/rewind`, to pick a point and choose to restore the code and
conversation, the conversation only, or the code only — or to summarise from
there.

Checkpoints are handy for "that idea was wrong, go back", but the official
docs say they are **not a substitute for version control**. Their limits:

- **Bash side effects are not tracked.** Files changed by a command (`sed -i`,
  `rm`, a code generator), migrations, package installs and network calls are
  outside the snapshot.
- **Subagent edits** are usually not restored.
- **Edits made outside Claude Code** — by you, your formatter, another
  session — are not tracked.
- Snapshots are **cleaned up after about 30 days**.

---

## What Neither Can Undo

| What happened | Checkpoint restores it? | Git restores it? | What actually helps |
|---|---|---|---|
| Agent edited a tracked file with its edit tool | Yes | Yes | Either |
| Agent ran `sed -i` on tracked files | No | Yes | `git restore` |
| Agent ran `rm` on an untracked or ignored file (`.env`, uploads) | No | No | Your backup — or the file is gone |
| `node ace migration:run` against your local DB | No | No (only the migration *file*) | `node ace migration:rollback`, or rebuild the local DB |
| Migration against a shared or staging DB | No | No | A database backup — and an apology. Prevent it (file 03) |
| `npm install some-package` | No | `package.json` and lockfile: yes | Restore those files, then reinstall `node_modules` |
| `git push`, an API call, an email, a deploy | No | No | Nothing undoes it — only prevention |

The pattern: **code is cheap to undo; the outside world is not.** That is why
file 03's "never auto-approve" list is mostly commands, not edits.

> **💡 Tip:** run Postgres and Redis locally in Docker, with seed data you can
> recreate in one command, so "rebuild the local DB" is a two-minute fix.

---

## Why the Agent Should Not Push

Everything above stays local until `git push`, where changes become shared:

- It may **trigger CI and deployments** for the whole team.
- A secret that reaches a remote must be treated as **leaked** — removing the
  commit is not enough; the key must be rotated.
- `--force` can **overwrite teammates' work** on a shared branch.
- Pushing is the moment you vouch for the change — your review, not its.

So the agent edits and, if asked, commits locally; **you push**, after
reading the diff. Decline push prompts; Part 6 shows how to deny them.

---

## BROKEN vs FIXED: Starting a Task

```text
❌ BROKEN
$ git status
 M app/controllers/tasks_controller.ts      ← your own unfinished work
$ claude "add a dueBefore filter to GET /tasks"
```

Your changes and the agent's are now mixed in one file. You cannot review its
work separately, and `git restore` would throw away yours too.

```text
✅ FIXED
$ git stash                                 # only if git status was dirty
$ git switch -c feat/tasks-due-before
$ git status                                # nothing to commit, working tree clean
$ claude "add a dueBefore filter to GET /tasks ... run the task tests"
  ...
$ git diff --stat && git status --short     # review, including untracked files
$ git add -p && git commit -m "Add dueBefore filter to GET /tasks"
```

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Starting with a dirty tree | Your work and the agent's mix; undo destroys both | Commit or stash first |
| Reviewing only `git diff` | Untracked new files do not appear in it | `git status --short` too |
| Treating `/rewind` as full undo | Bash side effects, migrations and installs are not tracked | Git for code; backups and care for the rest |
| Letting the agent push | Push is shared, triggers CI and cannot be taken back | You push, after review |
| Assuming git protects `.env` | Ignored files are invisible to git | Keep a backup; deny agent access (Part 6) |

---

## Questions to Test Yourself

1. The agent ran `node ace migration:run` and then you used `/rewind` to
   restore the code. What state is your database in, and how do you fix it?
2. `git diff` shows three files, but the agent mentioned creating four. Where
   is the fourth and why did `git diff` not show it?
3. You have unfinished changes and want the agent to start a new task now.
   Give the exact commands.
4. The agent deleted `storage/uploads/` with `rm -rf`. Which of checkpoints and
   git can bring it back, and why?
5. Give two reasons the agent should not run `git push`, one technical and one
   about responsibility.
6. Why does `acceptEdits` mode feel safe on a clean branch but not on `main`
   with uncommitted work?

---

## Related

- [Permissions and Modes](03-permissions-and-modes.md) — preventing the
  actions nothing can undo.
- [Commits, PRs and Code Review](../04-everyday-workflows/06-commits-prs-and-code-review.md)
  — commit messages and pull requests.
- [The Review Mindset](../05-reviewing-ai-code/01-the-review-mindset.md) —
  reading a diff efficiently.
- [Parallel Agents and Worktrees](../07-advanced/01-parallel-agents-and-worktrees.md)
  — several branches checked out at once.
- [Secrets and Configuration — Part 1](../../backend-fundamentals/11-api-security/05-secrets-and-configuration-part-1.md)
  — what to do when a secret is pushed.
- Official docs: [checkpointing](https://code.claude.com/docs/en/checkpointing).
