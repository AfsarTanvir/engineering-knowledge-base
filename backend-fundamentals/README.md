# Backend Fundamentals

Weeks 3–5 of [doc/career-roadmap.md](../doc/career-roadmap.md), expanded into a
full learning track.

This is the layer between "I can make a CRUD endpoint work" and "I can design a
backend feature and explain every decision in it". Each numbered folder is one
part. Each file inside is one topic, written from absolute beginner up to
production-level detail.

Everything is explained in plain English, with diagrams, tables, and real
TypeScript / Node examples using one consistent SaaS domain (users, companies,
projects, tasks, invoices, notifications).

## Roadmap

| # | Part | What it answers |
|---|---|---|
| 1 | [HTTP Foundations](01-http-foundations/) | What actually travels between a browser and your server |
| 2 | [REST & API Design](02-rest-api-design/) | How to design an API other people can use without asking you |
| 3 | [Request Lifecycle](03-request-lifecycle/) | What happens inside your app between request and response |
| 4 | [Validation & Input Handling](04-validation-and-input/) | How to never trust incoming data |
| 5 | [Authentication](05-authentication/) | Proving who the caller is |
| 6 | [Authorization](06-authorization/) | Deciding what that caller is allowed to do |
| 7 | [Error Handling](07-error-handling/) | Failing safely, clearly, and on purpose |
| 8 | [Logging & Observability](08-logging-and-observability/) | Knowing what your system did at 3 AM |
| 9 | [Application Architecture](09-application-architecture/) | Where code belongs: controllers, services, repositories |
| 10 | [Database Integration](10-database-integration/) | Migrations, transactions, pooling, and the ORM boundary |
| 11 | [API Security](11-api-security/) | The attacks that actually hit real APIs |
| 12 | [Files & Integrations](12-files-and-integrations/) | Uploads, storage, webhooks, outbound email |
| 13 | [Testing & Quality](13-testing-and-quality/) | Proving the feature works without clicking through the UI |

## Status

- [ ] Part 1 — HTTP Foundations
- [ ] Part 2 — REST & API Design
- [ ] Part 3 — Request Lifecycle
- [ ] Part 4 — Validation & Input Handling
- [ ] Part 5 — Authentication
- [ ] Part 6 — Authorization
- [ ] Part 7 — Error Handling
- [ ] Part 8 — Logging & Observability
- [ ] Part 9 — Application Architecture
- [ ] Part 10 — Database Integration
- [ ] Part 11 — API Security
- [ ] Part 12 — Files & Integrations
- [ ] Part 13 — Testing & Quality

## How to use this

1. **One file per sitting.** Do not read a whole part in one day. See the daily
   routine in the [roadmap](../doc/career-roadmap.md).
2. **Close the file, then answer its "Questions to Test Yourself" from memory.**
   If you cannot answer, you have not learned it yet — re-read it tomorrow.
3. **Find the same thing in your real project.** After each topic, open your
   work codebase and locate where that concept already exists. That is where
   the learning actually sticks.
4. **Do not move to the next part until you can explain the previous one** to
   someone else without notes.

## Reading the diagrams

Files use [Mermaid](https://mermaid.js.org/) diagrams. They render automatically
on GitHub. To read them locally with the repo's own viewer:

```
utils/markdown-viewer.html?file=backend-fundamentals/01-http-foundations/01-how-the-web-works.md
```

## What is deliberately not here

These live in their own folders — this track links to them instead of repeating
them:

- **Caching, queues, background jobs** → Weeks 9–10 of the roadmap, plus
  [system-design/foundational/](../system-design/foundational/)
- **Docker, Linux, deployment, CI/CD** → Weeks 11–12, plus
  [cloud-devops/](../cloud-devops/)
- **SQL query tuning and indexes** → [databases/](../databases/)
- **Language-level JavaScript/TypeScript** →
  [typescript-fundamentals/](../typescript-fundamentals/)
- **Scaling patterns and distributed systems** →
  [system-design/](../system-design/)
