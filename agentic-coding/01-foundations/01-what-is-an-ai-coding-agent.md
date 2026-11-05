# What Is an AI Coding Agent?

You have pasted code into ChatGPT, copied the answer back, and found that it
called a helper your project does not have. You fixed it by hand, ran the
tests, pasted the error back in, and went round three times. You were the one
reading files, running commands and carrying results between two windows.

An **AI coding agent** does that carrying itself. It reads your files, runs
your tests, edits code, reads the error and tries again. That is the whole
difference, and it changes what the tool can do for you and what it can break.

> **📌 In one line:** an agent is a language model given tools and a loop
> inside your repository, so it can act and check its own work — which makes
> it faster than chat, and makes your review more important, not less.

## Table of Contents

1. [Three Kinds of AI Help](#three-kinds-of-ai-help)
2. [One Task, Three Ways](#one-task-three-ways)
3. [The Definition: Model + Tools + Loop + Your Repo](#the-definition-model--tools--loop--your-repo)
4. [What an Agent Is Good and Bad At](#what-an-agent-is-good-and-bad-at)
5. [What Changes in Your Job, and What Does Not](#what-changes-in-your-job-and-what-does-not)
6. [❌ WEAK vs ✅ STRONG: Your First Agent Prompt](#-weak-vs--strong-your-first-agent-prompt)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)
9. [Related](#related)

---

## Three Kinds of AI Help

There are three ways AI shows up while you code. They use similar models
underneath; what differs is **how much of your project they can see and touch**.

| Kind | What you do | What it sees | What it can do |
|---|---|---|---|
| **Autocomplete** | Type code | The file you are in, plus nearby context | Suggest the next few lines; you press Tab |
| **Chat** | Ask a question in a panel or website | Only what you paste or attach | Answer in text and code blocks |
| **Agent** | Describe a task | Your whole repository, through tools | Read files, search, edit, run commands, repeat |

Some terms you will see throughout this track:

- **Model** (or **LLM**, large language model): the program that reads text and
  writes text. File [02](02-how-llms-work-just-enough.md) explains how.
- **Prompt**: what you type to the model.
- **Tool**: an action the model may ask for, such as "read this file" or "run
  this command". File [03](03-the-agent-loop-and-tools.md) explains them.
- **Session**: one conversation with an agent, from start to exit.
- **Diff**: the set of line changes between two versions of your code. You will
  read a lot of them.

---

## One Task, Three Ways

The ticket: **add a `dueDate` filter to `GET /tasks` in `saas-api`**, so
`GET /tasks?dueBefore=2026-12-01` returns only tasks due before that date.

**With autocomplete.** You open `app/controllers/tasks_controller.ts`, start
typing `if (dueBefore)`, and it suggests `query.where('due_date', '<', dueBefore)`.
Useful. But you still had to know which file, add the field to the validator,
write the test and run it. Autocomplete saved keystrokes, not thinking.

**With chat.** You paste the controller and ask for the filter. It answers with
a full controller — written for a slightly different framework version, using
a validator style your project does not use, and with no test. You adapt it by
hand, run the tests, paste the failure back. Chat saved you some typing and
some searching, but **you** were the loop.

**With an agent.** You type the task into a session started in the repo. An
illustrative run:

```text
> Add a dueBefore query filter to GET /tasks. Follow the existing filters.
  Add a functional test. Run the task tests when done.

  Search  "status" in app/controllers, app/validators
  Read    app/controllers/tasks_controller.ts
  Read    app/validators/task.ts
  Read    tests/functional/tasks.spec.ts
  Edit    app/validators/task.ts          (+1 line)
  Edit    app/controllers/tasks_controller.ts  (+3 lines)
  Edit    tests/functional/tasks.spec.ts  (+24 lines)
  Bash    node ace test --files tests/functional/tasks.spec.ts
          ✖ 1 failed: expected 2 tasks, got 3
  Read    app/controllers/tasks_controller.ts
  Edit    app/controllers/tasks_controller.ts  (fix: compare dates, not strings)
  Bash    node ace test --files tests/functional/tasks.spec.ts
          ✔ 9 passed

  Done. Added `dueBefore` to the list validator, applied it in index(),
  and added a test covering before/after/missing.
```

It found the existing `status` filter and copied its pattern. It wrote a test,
ran it, saw it fail, and fixed its own bug — all before you saw anything.

> **📌 Remember:** the agent's "Done" is a claim, not a proof. It ran *its*
> test. You still read the diff, and you still ask whether "before" should
> include the date itself — a business question no test answered.

---

## The Definition: Model + Tools + Loop + Your Repo

Four parts, and each one matters:

| Part | What it is | Without it |
|---|---|---|
| **Model** | The LLM that decides what to do next | Nothing reasons about the task |
| **Tools** | Actions the model may request: read, search, edit, run | It can only talk, like chat |
| **Loop** | Act, look at the result, decide again — many times per task | One answer, no self-correction |
| **Your repo** | The real files, tests and commands it works on | It guesses at your code instead of reading it |

The program that holds these together — sends your prompt to the model, runs
the tools it asks for, shows you what happened, asks your permission — is
called the **harness**. Claude Code, which this track uses, is a harness. The
model is the brain; the harness is the hands and the safety rules.

A useful mental picture: an agent is **a fast, well-read junior developer who
has never seen your project before, forgets everything between sessions, and
never gets tired**. It reads quickly, writes quickly and is confident. It does
not know your team's decisions, it does not know why the code is the way it
is, and it will not tell you when it is guessing unless you ask.

---

## What an Agent Is Good and Bad At

| Usually good at | Usually weak at |
|---|---|
| Following a pattern that already exists in the repo | Decisions that need context nobody wrote down |
| Boilerplate: validators, tests, migrations, types | Knowing what *should* happen in a business edge case |
| Searching a large codebase and explaining it | APIs or versions newer than its training data |
| Running a command, reading the error, fixing it | Noticing that the task itself is a bad idea |
| Tedious, mechanical changes across many files | Security it was not asked about (authorization, secrets) |

The left column is why agents are worth learning. The right column is why the
roadmap's rule exists.

---

## What Changes in Your Job, and What Does Not

**What changes:**

- You type less code and read more code. Reviewing a diff becomes a core skill.
- Your prompts become specifications. A vague request gets a vague result.
- Exploring an unfamiliar codebase gets much faster — you can ask "where is
  this handled?" and get file paths in seconds.
- You manage a worker: give it context, a way to check itself, and limits.

**What does not change:**

- **You own every line you merge.** If an agent writes an authorization bug and
  you merge it, it is your bug.
- You still need to understand HTTP, SQL, transactions, caching and security.
  That knowledge is how you tell a correct diff from a plausible one.
- Tests, code review and git are still your safety net — more so, because
  changes now arrive faster than you can type them.

From [doc/career-roadmap.md](../../doc/career-roadmap.md#the-one-rule):

> **Never merge code you cannot explain.**

Before accepting agent code, answer the same five questions: what problem it
solves, why this solution, what happens without it, what the alternatives are,
and what can go wrong. An agent can also help you *answer* them — ask it to
explain its change — but the answers have to end up in your head, not just in
the chat.

> **⚠️ Warning:** the risk is not that the agent writes bad code. The risk is
> that it writes code that *looks* good, you merge it without understanding,
> and six months later you are a developer who cannot work without it.

---

## ❌ WEAK vs ✅ STRONG: Your First Agent Prompt

```text
❌ WEAK
add due date filtering to tasks
```

The agent must guess: which endpoint, which parameter name, before or after,
inclusive or not, whether to write tests, whether to run them.

```text
✅ STRONG
Add a `dueBefore` query parameter to GET /tasks (tasks_controller index).
- Follow how the existing `status` filter is validated and applied.
- Accept an ISO date (YYYY-MM-DD). Return tasks with due_date strictly before it.
- Tasks with no due_date are excluded when the filter is set.
- Add cases to tests/functional/tasks.spec.ts and run only that file.
Do not change other endpoints or install packages.
```

The strong prompt names the place, points at an example to copy, settles the
business question, defines "done", and sets limits. Part 3 is entirely about
writing prompts like this.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Treating an agent like chat: one question, copy the answer | You lose the part that makes it useful — it can check itself | Give it a task and a command that proves it worked |
| Trusting "Done, all tests pass" | It may have run the wrong tests, or none | Run the tests yourself and read the diff |
| Starting with a large, vague task | More guessing, larger diff, harder review | Start small and specific, then grow the tasks |
| Letting it decide business rules silently | It will pick *something* and not tell you | State the rule, or ask it to list open questions first |
| Using it to skip learning a topic | You lose the knowledge you need to review it | Use it to explain, then check the explanation |

---

## Questions to Test Yourself

1. Your teammate says "Copilot autocomplete and an agent are the same thing".
   Using the dueDate task, explain the difference in two sentences.
2. Name the four parts of an agent. For each, say what you lose without it.
3. An agent says "Done, all tests pass". List three things you check before
   believing it.
4. Why is "a junior who forgets everything between sessions" a useful picture?
   What does it suggest you should write down for it?
5. Rewrite "fix the invoice bug" as a prompt an agent could act on, using the
   ❌/✅ example as a model.
6. Which of the five roadmap questions is hardest to answer from the diff
   alone, and how would you answer it?

---

## Related

- [How LLMs Work — Just Enough](02-how-llms-work-just-enough.md) — what the
  model underneath is doing and why it can be confidently wrong.
- [The Agent Loop and Tools](03-the-agent-loop-and-tools.md) — how the loop and
  the tools actually work.
- [The Tool Landscape](04-the-tool-landscape.md) — autocomplete, IDE, terminal,
  cloud: where each kind of product fits.
- [Writing Good Task Prompts](../03-prompting-and-context/01-writing-good-task-prompts.md)
  — the ❌/✅ prompt pattern in depth.
- [The Review Mindset](../05-reviewing-ai-code/01-the-review-mindset.md) — the
  One Rule applied to agent output.
- [Pagination, Filtering and Sorting](../../backend-fundamentals/02-rest-api-design/03-pagination-filtering-sorting.md)
  — how a filter like `dueBefore` should be designed in the first place.
