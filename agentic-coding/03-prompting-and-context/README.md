# Part 3 — Prompting and Context

You have installed the agent and made a first small change. Now you give it a
real task, and the result is close but wrong: it rewrote a helper you already
had, changed a response shape the front end depends on, and skipped the test.
The model is the same one that impressed you yesterday. What changed is how
much it had to guess.

This part is the core skill of the whole track. An agent's output is only as
good as three things: the **prompt** (what you ask), the **context** (what it
can see while it works) and the **workflow** (the order in which you let it
work). All three are under your control, and none of them need any
configuration beyond a single markdown file.

> **📌 The whole part in one line:** say exactly what you want and how to check
> it, keep the agent's working memory clean, write the permanent rules down
> once, and agree a plan before any code is written.

## Files

1. [Writing Good Task Prompts](01-writing-good-task-prompts.md) — goal,
   context, constraints, definition of done and verification, with six
   WEAK vs STRONG prompts on `saas-api`.
2. [Managing the Context Window](02-managing-the-context-window.md) — what
   fills the agent's memory, signs it is degrading, one task per session,
   `/clear` vs `/compact`, and feeding it the right files.
3. [Project Memory with CLAUDE.md](03-project-memory-with-claude-md.md) —
   where memory files live, what goes in and stays out, an example
   `CLAUDE.md` for `saas-api`, and when to use a skill or hook instead.
4. [Explore, Plan, Code, Commit](04-explore-plan-code-commit.md) — this
   track's recommended workflow: plan mode, making the agent ask you
   questions, reviewing a plan, and interrupting early.

## Read in this order

Read 1 → 4 in order. File 1 is about a single prompt; file 2 about a whole
session; file 3 about what carries over between sessions; file 4 puts them
together into a workflow you will use for every real ticket in Part 4.

After file 3, write a first `CLAUDE.md` for your own project (start with
`/init`, then cut it down). After file 4, do one small ticket using all four
steps, even if it feels slow. The slowness is the point the first time.

## What you should be able to do after this part

- Turn a one-line request into a prompt with a goal, context, constraints,
  a definition of done and a command that verifies it.
- Recognise when a session's context has degraded, and choose between
  `/clear`, `/compact` with focus instructions, and a rewind.
- Write a short `CLAUDE.md` for a real project, and explain why a hard rule
  also needs a permission rule or hook.
- Use plan mode to get a written plan, review it against a checklist, and
  correct the approach before any code exists.
- Interrupt an agent heading the wrong way, and say what rewind can and
  cannot undo.

## Where this connects

- **Before this:** tokens and the context window in theory in
  [How LLMs Work — Just Enough](../01-foundations/02-how-llms-work-just-enough.md);
  plan mode among the other modes in
  [Permissions and Modes](../02-setup-and-first-session/03-permissions-and-modes.md).
- **Your own planning habit:** the
  [New Ticket Checklist](../../doc/career-roadmap.md#workflow-change-new-ticket-checklist)
  in the roadmap is the human version of the explore and plan steps.
- **Enforcing what memory only asks for:** settings, skills and hooks in
  [Part 6](../06-customising-your-agent/).
- **Reviewing what comes out:** [Part 5](../05-reviewing-ai-code/).

## Next

Part 4 — [Everyday Workflows](../04-everyday-workflows/) uses these prompts,
memory and workflow on real tickets: onboarding, features, bugs, tests,
refactors and PRs.
