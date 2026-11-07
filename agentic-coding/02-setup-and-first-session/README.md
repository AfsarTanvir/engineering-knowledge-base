# Part 2 — Setup and First Session

Part 1 explained what an agent is. Now it goes on your machine and into
`saas-api` — a real repository with a real database behind it. That changes
the questions: who is paying for this session, what is it allowed to run, and
if it does something wrong, how do you get back to where you were?

This part installs Claude Code on Linux and VS Code, runs a deliberately
boring first session, explains every permission prompt you will see, and sets
up the git habits that make everything after it safe to try. **Do it at the
keyboard** — this part is practice, not reading.

> **📌 The whole part in one line:** install it, check which account and mode
> you are really in, start every task on a clean branch, read every permission
> prompt, and know exactly which mistakes git can undo and which only
> prevention can stop.

## Files

1. [Installing and Authenticating](01-installing-and-authenticating.md) —
   requirements, the native installer and npm, login options, the API key that
   silently overrides your subscription, the VS Code extension, `claude doctor`.
2. [Your First Session](02-your-first-session.md) — starting in the repo,
   read-only questions first, reading tool calls, prompts and diffs, a first
   tiny change, ending and resuming, essential shortcuts and slash commands.
3. [Permissions and Modes](03-permissions-and-modes.md) — what a permission
   prompt is asking, the six modes and when to use each, and the actions you
   never auto-approve.
4. [Git as Your Safety Net](04-git-as-your-safety-net.md) — clean tree and
   branch before every task, reviewing diffs, small commits, undoing,
   checkpoints and their limits, and why the agent should not push.

## Read in this order

Read 1 → 4 in order, with a terminal open. File 1 takes ten minutes and ends
with `/status` showing the right account. Read **file 4 before your first real
task** — its "clean tree and branch" habit is what makes files 2 and 3 safe to
experiment with. If you only remember one table from this part, make it "What
Neither Can Undo" in file 4.

## What you should be able to do after this part

- Install Claude Code, log in on purpose, and prove with `/status` and
  `claude auth status` which account is being billed.
- Find and remove a stray `ANTHROPIC_API_KEY` that would override your
  subscription.
- Run a read-only session on `saas-api`, verify the agent's claims against the
  files, and make one tiny tested change.
- Read a permission prompt and decide in seconds whether it is safe, and
  choose a mode for the task instead of accepting whatever is set.
- Start every task from a clean branch, review with `git diff` and
  `git status`, and undo any edit.
- Explain why `/rewind` does not undo a migration, an install or an `rm`.

## Where this connects

- **Shell basics this part assumes:**
  [01-the-shell-and-filesystem-part-1.md](../../linux-and-deployment/01-linux-essentials/01-the-shell-and-filesystem-part-1.md)
  and environment variables in
  [05-logs-disks-and-debugging-part-2.md](../../linux-and-deployment/01-linux-essentials/05-logs-disks-and-debugging-part-2.md).
- **Why API keys are secrets:**
  [05-secrets-and-configuration-part-1.md](../../backend-fundamentals/11-api-security/05-secrets-and-configuration-part-1.md).
- **What `npm install` really runs:**
  [04-supply-chain-and-dependencies/](../../cybersecurity/04-supply-chain-and-dependencies/).
- **Later in this track:** permission rule syntax and settings files in
  [Part 6](../06-customising-your-agent/), worktrees and agent security in
  [Part 7](../07-advanced/).

## Next

Part 3 — [Prompting and Context](../03-prompting-and-context/) turns your first
tiny change into a repeatable skill: prompts with a goal and a definition of
done, a clean context window, project memory, and planning before code.
