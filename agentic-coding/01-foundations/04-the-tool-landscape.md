# The Tool Landscape

Search for "AI coding tool" and you get dozens of products, each announcing
a new feature every month, each compared in posts that are out of date by the
time you read them. Trying to pick "the best one" from that is a trap. Products
change; the **categories** they fall into, and the skills that make any of them
useful, change much more slowly.

This file maps the categories, gives you a way to choose, explains why this
track uses Claude Code, and lists what you keep if you switch tools later.

> **📌 In one line:** AI coding tools fall into a few categories that differ in
> where they run and how much they do on their own — pick by where you work and
> how much control you need, and invest in the skills that transfer, not in one
> product's buttons.

## Table of Contents

1. [Four Categories](#four-categories)
2. [IDE Assistants](#ide-assistants)
3. [Terminal (CLI) Agents](#terminal-cli-agents)
4. [Cloud and Background Agents](#cloud-and-background-agents)
5. [App Builders](#app-builders)
6. [How to Choose](#how-to-choose)
7. [Why This Track Uses Claude Code](#why-this-track-uses-claude-code)
8. [The Skills That Transfer](#the-skills-that-transfer)
9. [Common Mistakes](#common-mistakes)
10. [Questions to Test Yourself](#questions-to-test-yourself)
11. [Related](#related)

---

## Four Categories

| Category | Where it runs | You interact by | Autonomy | Best for |
|---|---|---|---|---|
| **IDE assistant** | Inside your editor | Typing, a side panel, inline edits | Low → medium | Line-by-line help while you code |
| **Terminal agent** | Your terminal, on your machine, in your repo | A conversation in the shell | Medium → high | Multi-file tasks, running tests and commands |
| **Cloud / background agent** | A remote machine with a copy of your repo | Assigning a task, getting a branch or PR | High | Well-defined tasks you review later |
| **App builder** | A website | Describing an app in plain English | Very high | Prototypes and demos, not existing codebases |

**Autonomy** here means how many steps the tool takes before you see the
result. More autonomy means less typing and a larger review.

> **💡 Tip:** the lines are blurry. Many products now cover two or three
> categories — an editor with an agent mode, a terminal agent with an editor
> extension, either one with a cloud mode. Think of categories as *ways of
> working*, not as boxes products fit into.

---

## IDE Assistants

These live in your editor. They started as autocomplete and grew chat panels
and, more recently, agent modes that can edit several files and run commands.
Some are extensions to an editor you already use; some are whole editors built
around AI (often based on VS Code). Examples at the time of writing (2026)
include GitHub Copilot, Cursor and Windsurf; features differ and change often.

- **Strengths:** zero context switch; inline suggestions; diffs shown right in
  your editor; good for small, local changes.
- **Weaknesses:** autocomplete encourages accepting code at typing speed,
  which is the fastest way to stop reading it.

---

## Terminal (CLI) Agents

A **CLI** (command-line interface) agent runs in your terminal, in your
project directory, with your user's permissions. You talk to it in a
conversation; it reads, searches, edits and runs commands through the loop
from [file 03](03-the-agent-loop-and-tools.md). Examples include Claude Code,
Gemini CLI, OpenAI's Codex CLI and the open-source Aider.

- **Strengths:** sees and runs everything you can — your tests, your Docker
  containers, `git`, `psql` against your local database. Scriptable: the same
  tool can run inside CI. Works with any editor.
- **Weaknesses:** it can run anything you can, so permissions matter (Part 2).
  A terminal is less visual for reviewing changes; pairing it with your
  editor's diff view fixes that.

---

## Cloud and Background Agents

You give the agent a task — often by assigning it an issue or mentioning it in
a pull request comment — and it works on a remote machine with a copy of your
repository. You come back to a branch or a pull request. Several of the
products above offer a mode like this, and agents can also be run from CI
pipelines such as GitHub Actions (Part 7).

- **Strengths:** runs while you do something else; several tasks in parallel;
  your laptop is not involved.
- **Weaknesses:** you see only the result, not the reasoning along the way,
  so course-correcting is harder. It cannot reach your local database or
  services. A pile of agent PRs is a pile of reviews — the bottleneck moves to you.

---

## App Builders

Browser tools that generate a whole application from a description, often
with hosting included (v0, Bolt and Lovable are examples). They are aimed at
people who do not want to read the code at all.

- **Strengths:** a clickable prototype in minutes; good for testing an idea.
- **Weaknesses:** they are built to *start* projects, not to work inside an
  existing one with its conventions, tests and history. Authorization, data
  modelling and security are whatever the generator chose.

For `saas-api`, app builders are mostly irrelevant. They are worth knowing
because you will meet their output — and it needs the same review as any code.

---

## How to Choose

Ask these questions in order. They matter more than any feature comparison.

| Question | Why it matters |
|---|---|
| Can I use it at work? | Company policy on sending code to third parties beats any feature |
| Where do I already work? | A tool in your existing editor and terminal gets used; a new environment often does not |
| Can it run my tests and commands? | Without verification, it is chat with extra steps (file 03) |
| How do I control what it may do? | Permission prompts, read-only modes, rules for commands and files |
| Where does my code go, and who pays? | Subscription vs pay-per-token; data retention terms; check the vendor's docs |
| Can I give it project memory? | A file of conventions it reads every session saves repeating yourself |
| Can I script it? | Running it in CI or in shell scripts later |

> **⚠️ Warning:** never paste company code into a tool your employer has not
> approved, however good it is. That is a data-handling decision, not a
> technical one. Ask first.

A reasonable default for a backend developer: **one terminal agent plus your
existing editor**, used together. The agent does multi-step work; the editor
shows you the diffs.

```text
❌ WEAK   "Which AI coding tool is the best?"
✅ STRONG "Which tool can my company approve, works in VS Code and my
          terminal, can run `node ace test` on my machine, and lets me
          stop it from running migrations without asking?"
```

---

## Why This Track Uses Claude Code

Not because it is the best — that changes, and "best" depends on the task.
It is used here because it fits how this repo is written and how its reader
works:

- **It runs in the terminal and has a VS Code extension.** That is the
  reader's setup; nothing new to learn around it.
- **It is a terminal agent at heart**, so it can run `node ace test`, `docker
  compose`, `psql` and `git` — the full loop from file 03.
- **Its customisation is in plain files.** Project memory (`CLAUDE.md`),
  settings and permission rules (`.claude/settings.json`), reusable skills,
  hooks and subagents are all text files you can read and commit. That makes
  the *concepts* visible, which is the point of a learning track.
- **The same tool runs headless and in CI**, so Part 7 does not need another
  product.

Every concept in this track — context, memory files, permissions, plans,
verification, hooks, MCP — has an equivalent in most other serious agents.
The names and file locations will differ; the ideas will not.

---

## The Skills That Transfer

These are the things you are really learning. Switch tools next year and you
keep all of them.

| Skill | Where this track teaches it |
|---|---|
| Writing a task with a goal, constraints and definition of done | Part 3 |
| Managing what is in the context window | Part 3 |
| Writing project memory (conventions, commands, "never do X") | Part 3 — many tools read a similar file; `AGENTS.md` is a common shared name |
| Plan before code; review the plan | Part 3 |
| Giving the agent a check to run | Parts 1, 4 |
| Working on a branch with a clean tree; small commits | Part 2 |
| Reading a diff and explaining every line | Part 5 |
| Knowing how AI code typically goes wrong | Part 5 |
| Choosing permissions on purpose | Parts 2, 6 |
| Connecting tools through MCP, an open standard many agents support | Part 6 |
| Spotting prompt injection | Part 7 |

> **📌 Remember:** shortcuts and slash commands are product trivia. The table
> above is the career skill.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Hopping between tools every week | You never get past the learning curve of any of them | Pick one, use it for a month, then compare |
| Choosing by benchmark posts | Benchmarks rarely match your stack and change monthly | Try it on a real `saas-api` ticket |
| Using an unapproved tool on company code | Data-handling and legal risk | Ask what is approved first |
| Using an app builder to "add a feature" to a real codebase | It does not know your conventions or tests | Use a repo-aware agent |
| Learning the product, not the skills | Product details are obsolete within a year | Focus on the transferable table |
| Running several cloud agents before you can review one diff well | Review becomes the bottleneck | Master one local session first |

---

## Questions to Test Yourself

1. Place these in categories: an editor's Tab completion, a chat panel that
   can edit files, an agent you assign a GitHub issue to, a tool that builds a
   website from one sentence.
2. Your manager asks which tool the team should adopt. Which three questions
   from "How to Choose" do you raise first, and why those?
3. Give one strength and one weakness of a cloud agent compared to a terminal
   agent, using `saas-api`'s local Postgres as the example.
4. Why does this track call autocomplete "the fastest way to stop reading
   code"? Do you agree?
5. Name four skills from this track that would still matter if you switched
   tools next year.
6. Your colleague builds an internal tool with an app builder and wants to
   connect it to production. What do you check before agreeing?

---

## Related

- [What Is an AI Coding Agent?](01-what-is-an-ai-coding-agent.md) —
  autocomplete vs chat vs agent on one task.
- [The Agent Loop and Tools](03-the-agent-loop-and-tools.md) — why "can it run
  my tests?" is the key question.
- [Installing and Authenticating](../02-setup-and-first-session/01-installing-and-authenticating.md)
  — setting up the tool this track uses.
- [Project Memory with CLAUDE.md](../03-prompting-and-context/03-project-memory-with-claude-md.md)
  — the memory file, and how it relates to `AGENTS.md`.
- [Headless Mode and CI](../07-advanced/02-headless-mode-and-ci.md) — agents
  in pipelines.
- [Working with Agents on a Team](../07-advanced/06-working-with-agents-on-a-team.md)
  — team choices and rules.
- [GitHub Actions](../../cloud-devops/ci-cd/github-actions.md) — the CI system
  that background agents often run in.
