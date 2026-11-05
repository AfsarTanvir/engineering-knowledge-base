# How LLMs Work — Just Enough

You ask an assistant how to configure a BullMQ worker. It answers instantly,
with clean code and a confident explanation, and one of the options it uses
does not exist. Nobody lied to you. The model did exactly what it was built
to do — and once you see what that is, the mistake stops being mysterious.

You do not need maths to use an agent well. You need a handful of ideas about
what the model is doing, because each idea maps directly to a habit.

> **📌 In one line:** a language model writes the most plausible next piece of
> text, one token at a time, from patterns it learned — it does not look facts
> up, so anything it says about your code, your versions or the world must be
> checked against the real thing.

## Table of Contents

1. [Tokens: How the Model Sees Text](#tokens-how-the-model-sees-text)
2. [Next-Token Prediction](#next-token-prediction)
3. [The Context Window](#the-context-window)
4. [Training Cutoff](#training-cutoff)
5. [Non-Determinism](#non-determinism)
6. [Hallucination: Why It Happens](#hallucination-why-it-happens)
7. [What This Means for Trusting Output](#what-this-means-for-trusting-output)
8. [Common Mistakes](#common-mistakes)
9. [Questions to Test Yourself](#questions-to-test-yourself)
10. [Related](#related)

---

## Tokens: How the Model Sees Text

A model does not read letters or whole words. It reads **tokens**: chunks of
text, usually a word or part of a word. A common English word is often one
token; an unusual identifier like `invoiceReminderJob` may be split into several.
Code, JSON and log lines all become tokens too.

Tokens matter for two practical reasons:

- **Limits are counted in tokens.** How much the model can hold at once (the
  context window, below) is measured in tokens, not files or lines.
- **Cost is counted in tokens.** If you pay per use, you pay for tokens read
  and tokens written. Part 7 covers cost. A huge pasted log is never free.

---

## Next-Token Prediction

At its core, a model does one thing: **given all the text so far, it produces
a likely next token.** Then it adds that token to the text and does it again.
And again. A whole answer, a whole file, is this one step repeated.

```text
   Text so far ─────────────────────────────────────────────┐
   "await Task.query().where('status', status).orderBy("    │
                                                            ▼
                                                   ┌────────────────┐
                                                   │     MODEL      │
                                                   │ (learned       │
                                                   │  patterns)     │
                                                   └───────┬────────┘
                                                           ▼
                                  Likely next tokens:  'created_at'  ← very likely
                                                       'due_date'    ← likely
                                                       'id'          ← possible
                                                       'banana'      ← almost never
                                                           │
                                       pick one ───────────┘
                                                           │
   Append it to the text, and repeat until the answer ends ◄┘
```

How does it know `'created_at'` is likely? During **training**, the model was
shown an enormous amount of text and code and gradually adjusted itself to get
better at predicting what comes next. What it learned is not a database of
facts. It is a vast set of patterns: what usually follows what.

That is why it is so good at code. Code is full of strong patterns. After
`orderBy(`, a column name is very likely. After a failing test, a fix is likely.

> **📌 Remember:** the model is not retrieving an answer it stored. It is
> generating text that fits. Most of the time "fits" and "true" are the same.
> Sometimes they are not.

---

## The Context Window

The **context window** is everything the model can see while producing the
next token: the instructions from the tool, your prompt, the conversation so
far, every file it read, every command output. It is the model's entire world
for this request. It has no other memory.

Three consequences:

- **It only knows what is in the window.** If the agent has not read
  `app/models/task.ts`, it does not know what is in it. It will guess from
  similar projects — and the guess will look just as confident as knowledge.
- **The window has a limit.** In a long session, it fills with old file
  contents and test output. Tools handle this by summarising or dropping old
  material, and details get lost.
- **Quality drops as it fills.** A window stuffed with irrelevant material
  makes it harder for the model to focus on what matters now.

Between sessions, the window starts empty. That is why agents "forget" and
why project memory files (Part 3) exist: they are text loaded into every new
window. Part 3 also covers managing the window in practice.

---

## Training Cutoff

A model learned from text collected up to some date — its **training cutoff**.
It knows nothing that happened after that unless the text is put into its
context (for example, by reading your files or fetching a web page).

For a developer this means:

- A library released or changed after the cutoff is unknown or half-known.
- It may suggest a **deprecated API**, because older usage dominated its
  training text.
- It cannot know which version is in *your* `package.json` unless it reads it.

```text
❌ WEAK   How do I define a validator in AdonisJS?
✅ STRONG Read package.json and one file in app/validators/. Using the same
          AdonisJS and validator version this project uses, show me how to
          validate an optional ISO date query parameter.
```

The strong version makes the agent ground its answer in your real versions
instead of whatever version was most common in its training data.

---

## Non-Determinism

When the model picks the next token, it does not always pick the single most
likely one. A little randomness is deliberate: it makes output less repetitive
and often better. The result is that **the same prompt can give different
answers on different runs.**

Practical effects:

- Re-running a prompt is not a test of correctness. Two answers that disagree
  tell you the model is unsure; two answers that agree do not prove it is right.
- An agent may solve a task one way today and another way tomorrow. Your tests
  and conventions, not the model, are what keep the code consistent.
- If something works "sometimes", look for vagueness in the prompt.

---

## Hallucination: Why It Happens

A **hallucination** is output that is fluent and confident but false: a method
that does not exist, a config option nobody shipped, a package name that was
never published, a "fact" about your code that is wrong.

It happens because of everything above, working together:

1. The model produces **plausible continuations**, not looked-up facts.
2. When the real answer is **not in the context window** and was rare or
   absent in training, the most plausible-looking continuation can still be
   wrong. A method called `queue.retryFailedWithBackoff()` *sounds* like
   something BullMQ would have. Nothing in the generation step checks that it
   does.
3. There is **no built-in "I don't know" signal.** A guessed token and a known
   token come out in the same confident tone.

So hallucination is not a bug that will be patched away. It is a side effect of
how generation works. Newer models do it less, and agents do it less than chat
because they can *read the real file* before answering — but neither removes it.

> **⚠️ Warning:** the most dangerous hallucinations are plausible package
> names. If an agent suggests `npm install` of a package you have never heard
> of, check it exists, who publishes it and how widely it is used before
> installing. Attackers publish packages under names that models tend to
> invent. Part 5 covers this.

---

## What This Means for Trusting Output

| Claim from the model | How to verify |
|---|---|
| "This method/option exists" | Find it in `node_modules`, the type definitions, or the official docs |
| "This works in version X" | Check `package.json` / lockfile and that version's docs or changelog |
| "This file does Y" | Open the file, or ask the agent to quote the lines |
| "Tests pass" | Run them yourself, and check which tests actually ran |
| "This package does Z" | Check the registry page, the repository, the publisher |
| "This is the standard/best practice" | Ask why, and ask for the alternatives and trade-offs |

Agents help with the first rows, because they can read and run things. Make
them: "show me where this option is defined in node_modules" turns a guess into
evidence. A good habit is to ask the agent to **cite the file and line** behind
any claim about your code.

```text
❌ WEAK   Does our task list endpoint handle soft-deleted tasks?
✅ STRONG Does GET /tasks exclude soft-deleted tasks? Answer with the exact
          file and lines that do it, or say clearly that nothing does.
```

The strong version gives the model an honest way out ("nothing does") and asks
for evidence you can check in seconds.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Treating answers as looked-up facts | The model generates plausible text; it does not consult a source | Verify APIs, versions and claims against code or docs |
| Assuming it knows your versions | It defaults to whatever was common in training | Make it read `package.json` and existing code first |
| Pasting huge logs "just in case" | Fills the context window and dilutes attention | Paste the relevant part, or let the agent search it |
| Re-running until you get the answer you like | Agreement between runs is not correctness | Check against tests and sources |
| Installing a suggested package unchecked | Invented names can be real malicious packages | Verify the package exists and is the one you meant |

---

## Questions to Test Yourself

1. Explain to a colleague, without the words "AI is dumb", why a model can
   invent a BullMQ option that does not exist.
2. An agent has been working for an hour and starts contradicting decisions it
   made earlier. Which concept from this file explains it?
3. The agent suggests an AdonisJS API that your project's version does not
   have. Which two concepts are at work, and what prompt would have prevented it?
4. You run the same prompt twice and get two different migrations. Is one of
   them wrong? How do you decide?
5. The agent says "this endpoint already checks the user's company". How do you
   turn that claim into evidence in under a minute?
6. Why do agents usually hallucinate less about your code than chat does?

---

## Related

- [What Is an AI Coding Agent?](01-what-is-an-ai-coding-agent.md) — the
  definition this file sits underneath.
- [The Agent Loop and Tools](03-the-agent-loop-and-tools.md) — how tools put
  real files and outputs into the context window.
- [Managing the Context Window](../03-prompting-and-context/02-managing-the-context-window.md)
  — the practice that follows from this theory.
- [How AI Code Goes Wrong](../05-reviewing-ai-code/02-how-ai-code-goes-wrong.md)
  — a catalogue of what hallucination looks like in a diff.
- [Cost Models and Limits](../07-advanced/04-cost-models-and-limits.md) —
  tokens turned into money.
- [Your Dependencies Are Your Code](../../cybersecurity/04-supply-chain-and-dependencies/01-your-dependencies-are-your-code.md)
  — why an invented package name is a security problem.
