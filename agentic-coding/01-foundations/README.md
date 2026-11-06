# Part 1 — Foundations

You have used ChatGPT to explain an error and autocomplete to finish a line.
Now someone tells you to "let the agent do the ticket". What is actually
running when you do that? What does it see, what can it touch, and why does it
sometimes invent a method with total confidence?

This part answers those questions before you install anything. It is
tool-agnostic and has no setup steps: one running example — adding a
`dueDate` filter to `GET /tasks` in `saas-api` — is followed through
autocomplete, chat and an agent, so you can see exactly what changes. Part 2
puts the ideas on your machine.

> **📌 The whole part in one line:** an agent is a language model that predicts
> plausible text, given tools and a loop inside your repository — so it can do
> real work and check it, and it can be confidently wrong in ways only you and
> your tests will catch.

## Files

1. [What Is an AI Coding Agent?](01-what-is-an-ai-coding-agent.md) —
   autocomplete vs chat vs agent on one ticket; model + tools + loop + your
   repo; what changes in your job and what does not.
2. [How LLMs Work — Just Enough](02-how-llms-work-just-enough.md) — tokens,
   next-token prediction, the context window, training cutoff, randomness, and
   why hallucination happens.
3. [The Agent Loop and Tools](03-the-agent-loop-and-tools.md) — tool calling
   in plain words; gather context → act → verify; the typical tools; why
   running tests matters; what the agent cannot see.
4. [The Tool Landscape](04-the-tool-landscape.md) — IDE assistants, terminal
   agents, cloud agents and app builders; how to choose; why this track uses
   Claude Code; the skills that transfer.

## Read in this order

Read 1 → 4 in order, one per sitting. File 1 gives you the vocabulary (model,
tool, harness, session, diff). File 2 is the most important for your
judgement: every "verify this" habit later in the track comes from it. File 3
explains what you will watch on screen in Part 2. File 4 is the shortest
read and can wait until you are curious about other products.

## What you should be able to do after this part

- Explain the difference between autocomplete, chat and an agent using one
  concrete task.
- Name the four parts of an agent and what a harness does.
- Explain, without maths, why a model can invent an API that does not exist,
  and list what you must always verify.
- Draw the gather → act → verify loop and say where you sit in it.
- List what an agent cannot see in `saas-api`, and how to give it each one.
- Choose a tool by asking the right questions instead of reading rankings.

## Where this connects

- **The rule underneath everything:** the One Rule and the five questions in
  [doc/career-roadmap.md](../../doc/career-roadmap.md#the-one-rule).
- **The knowledge you review agent code with:**
  [backend-fundamentals/](../../backend-fundamentals/) and
  [databases/](../../databases/) — an agent's diff is only as safe as your
  ability to judge it.
- **Checks the agent can run:**
  [13-testing-and-quality/](../../backend-fundamentals/13-testing-and-quality/).
- **Invented package names as an attack:**
  [04-supply-chain-and-dependencies/](../../cybersecurity/04-supply-chain-and-dependencies/).
- **Later in this track:** hallucination in real diffs in
  [Part 5](../05-reviewing-ai-code/), building the loop yourself in
  [Part 7](../07-advanced/).

## Next

Part 2 — [Setup and First Session](../02-setup-and-first-session/) installs
Claude Code, runs a first safe session on `saas-api`, and sets up git so
anything the agent does can be undone.
