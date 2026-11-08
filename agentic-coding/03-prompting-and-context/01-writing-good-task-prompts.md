# Writing Good Task Prompts

You type "add pagination to the tasks endpoint". Four minutes later the agent
has changed nine files. It wrote a new pagination helper, though `saas-api`
already has one. It changed the response from an array to `{ data, meta }`,
breaking the Next.js task list. Its `limit` has no maximum. All the tests
pass, because it wrote none.

The agent did what you asked. You asked for very little, and it filled every
gap with a guess. This file is about leaving fewer gaps.

> **📌 In one line:** a good task prompt states the goal, the context, the
> constraints, what "done" means and how to check it. Every part you leave
> out is a part the agent will guess.

## Table of Contents

1. [Why Prompts Matter More with an Agent](#why-prompts-matter-more-with-an-agent)
2. [The Five Parts of a Task Prompt](#the-five-parts-of-a-task-prompt)
3. [Pointing at Files and Examples](#pointing-at-files-and-examples)
4. [WEAK vs STRONG: Six saas-api Prompts](#weak-vs-strong-six-saas-api-prompts)
5. [How Long, and a Reusable Template](#how-long-and-a-reusable-template)
6. [Common Mistakes](#common-mistakes)
7. [Questions to Test Yourself](#questions-to-test-yourself)
8. [Related](#related)

---

## Why Prompts Matter More with an Agent

In a chat window, a vague question gets a vague answer, and you lose a
minute. With an agent, a vague request becomes **real edits to real files**: a
diff you have to read, understand and probably throw away.

The agent also cannot see what you can see. It does not know that the front
end expects a plain array, that `app/helpers/paginate.ts` already exists, or
that "done" for your team includes a functional test. Those facts are in your
head, in Slack or in last week's code review. If they are not in the prompt
(or in [project memory](03-project-memory-with-claude-md.md)), the agent
fills the gap with the most *typical* answer it has seen. Your codebase is not
typical.

---

## The Five Parts of a Task Prompt

| Part | The question it answers | saas-api example |
|---|---|---|
| **Goal** | What should be true when you finish? | "`GET /tasks` returns tasks one page at a time" |
| **Context** | What does it need to know that it can't see? | "We already paginate projects in `ProjectsController.index`" |
| **Constraints** | What must not change? What is off limits? | "Keep the response shape; no new dependencies; don't touch migrations" |
| **Definition of done** | How do we both know it is finished? | "Max 100 per page, default 20, functional test for page 2" |
| **Verification** | Which command proves it? | "`npm test -- --files tests/functional/tasks.spec.ts` passes" |

A rename needs only a goal; a feature needs all five. **Verification is the
part people forget, and it matters most.** An agent that can run a check can
see its own mistake and fix it before you look; one with nothing to run can
only tell you it is finished (see
[The Agent Loop and Tools](../01-foundations/03-the-agent-loop-and-tools.md)).

---

## Pointing at Files and Examples

The best context is often **a file that already does it right**. "Follow the
pattern in X" beats a paragraph of description, because the agent copies real
code instead of guessing at your conventions.

In Claude Code, type `@` to autocomplete and mention a file path. In the VS
Code extension, `Alt+K` (`Option+K` on macOS) mentions the open file.

```text
Add pagination to TasksController.index the same way
@app/controllers/projects_controller.ts does it, using the existing
helper in @app/helpers/paginate.ts.
```

Other pointers that work well: **a test to copy** ("in the style of
`tests/functional/projects.spec.ts`"), **the full error and stack trace**
(not "it crashes"), **a command to run first** ("run `node ace
migration:status` and tell me what you see"), and **the ticket's acceptance
criteria**, pasted in.

> **💡 Tip:** if there is no example to point at, say so: "there is no
> existing pattern; propose one before writing code".

---

## WEAK vs STRONG: Six saas-api Prompts

**1. A feature**

```text
❌ WEAK
add pagination to tasks

✅ STRONG
Add pagination to GET /projects/:projectId/tasks (TasksController.index).
- Use the existing helper in @app/helpers/paginate.ts, like
  ProjectsController.index does.
- Query params: page (default 1), perPage (default 20, max 100).
- Keep the response a plain array (the Next.js task list expects one);
  put the total count in an X-Total-Count header.
- Don't add dependencies or change migrations.
Done when: a functional test covers page 2 and perPage=500 being capped,
and `npm test` passes.
```

**2. A bug**

```text
❌ WEAK
invoices are broken, fix it

✅ STRONG
POST /invoices/:id/send returns 500 when the company has no billing email.
Error from the log:
  TypeError: Cannot read properties of null (reading 'toLowerCase')
  at InvoiceMailer.prepare (app/mails/invoice_mailer.ts:31)
Expected: 422 with { error: "Company has no billing email" }.
First explain the root cause and show me the line. Don't edit anything yet.
```

**3. A test**

```text
❌ WEAK
write tests for the task policy

✅ STRONG
Write unit tests for @app/policies/task_policy.ts in
tests/unit/task_policy.spec.ts, in the style of tests/unit/project_policy.spec.ts.
Cover: owner can update, member of another company cannot, admin can,
archived project blocks everyone. Do not change task_policy.ts. If a test
fails, stop and tell me, because that may be a real bug.
```

**4. A migration**

```text
❌ WEAK
add a due date to invoices

✅ STRONG
Add a nullable `due_at` timestamp column to invoices.
- New migration with `node ace make:migration`. Never edit an existing
  migration; they have already run in production.
- Update the Invoice model and the create/update validators.
- Don't run migrations; I'll run `node ace migration:run` myself.
Done when: `npx tsc --noEmit` and `npm test` pass.
```

**5. A refactor**

```text
❌ WEAK
clean up the billing service

✅ STRONG
In @app/services/billing_service.ts, move the tax calculation
(calculateTax and its two helpers) into app/services/tax_service.ts.
Pure move: no behaviour change, no renames, same exports from
billing_service.ts so callers don't change. Run `npm test` before and
after; both runs must show the same passing tests.
```

**6. A question (no changes)**

```text
❌ WEAK
how does auth work

✅ STRONG
Read-only, don't edit anything. Trace what happens when the Next.js app
calls POST /auth/login: which route, middleware, controller and model run,
where the session is stored, and what is in the cookie. Give file paths
and line numbers for each step so I can check them myself.
```

Every STRONG prompt names files, points at a pattern, says what must not
change and ends with a check. Prompts 2 and 6 also say **don't edit yet**,
often the most useful constraint of all
([Explore, Plan, Code, Commit](04-explore-plan-code-commit.md)).

---

## How Long, and a Reusable Template

As long as the gaps it has to fill. A rename needs one sentence; a
multi-file feature needs a plan, then one prompt per step. Ten paragraphs of
background bury the one constraint that matters, and rules for **every** task
belong in project memory. Paste from this template; delete unneeded lines.

> **💡 Tip:** `Ctrl+G` opens the prompt in your editor. `\` then Enter adds a
> new line in any terminal (`/terminal-setup` enables `Shift+Enter` in VS Code).

```text
Goal: <what should be true afterwards>
Context: <files to read, patterns to follow, @mentions>
Constraints: <what must not change; files that are off limits>
Done when: <observable outcome, edge cases covered>
Verify with: <command(s) to run>
Before editing: <explain / ask me questions / propose a plan>
```

Beginners leave out the last line. "Ask me about anything unclear before you
start" costs one round trip and often saves a whole rewrite.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| "Fix it" / "clean it up" | The agent decides what "fixed" or "clean" means | State the expected behaviour or the exact change |
| No way to verify | The agent cannot catch its own mistakes | End with a test or command it must run |
| Describing a pattern in words | It invents its own version of the pattern | Point at a file that already does it |
| Leaving out what must not change | Agents widen scope to "improve" nearby code | List off-limits files and behaviour |
| Pasting "it crashes" instead of the error | The agent guesses at the cause | Paste the full error and stack trace |
| Repeating team rules in every prompt | Noisy, and you will forget one eventually | Put permanent rules in CLAUDE.md |

---

## Questions to Test Yourself

1. "Make the invoices endpoint faster." List four things the agent must guess.
2. Rewrite "add soft delete to projects" as a STRONG prompt for `saas-api`,
   with all five parts.
3. Why does a verification command matter more to an agent than to a chat?
4. You want to understand a bug before anything changes. What do you add?
5. When is "follow the pattern in `@file`" the wrong instruction?
6. You have typed "never hand-write migration filenames" in your last ten
   prompts. Where should that rule live instead?

---

## Related

- [Managing the Context Window](02-managing-the-context-window.md) — keeping
  the session clean so a good prompt is not drowned out.
- [Project Memory with CLAUDE.md](03-project-memory-with-claude-md.md) — where
  rules for every prompt belong.
- [Explore, Plan, Code, Commit](04-explore-plan-code-commit.md) — big prompts
  turned into small, reviewable steps.
- [How LLMs Work — Just Enough](../01-foundations/02-how-llms-work-just-enough.md)
  — why the model fills gaps with the typical answer.
- [Building a Feature — Part 1](../04-everyday-workflows/02-building-a-feature-part-1.md)
  — these prompts used on a real ticket.
- [Career Roadmap — New Ticket Checklist](../../doc/career-roadmap.md#workflow-change-new-ticket-checklist)
  — the questions to answer before you write any prompt.
