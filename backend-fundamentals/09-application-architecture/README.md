# Part 9 — Application Architecture

Parts 1 to 8 taught you what happens to a request: it arrives, it is routed, it
is validated, the caller is identified and authorized, errors are handled, and
the whole thing is logged. This part answers a different question.

**Where does the actual code go?**

Every backend developer starts by putting everything in the controller. It
works. Then the feature grows, a second caller appears (a background job, a
CLI command, a webhook), someone asks for a test, and the controller becomes
the thing nobody wants to touch. This part is about the structure that
prevents that — controllers, services, repositories, DTOs, and the wiring
that connects them.

The goal is not to memorise a folder layout. The goal is that when you are
given a feature, you already know which file each piece belongs in, and you
can explain why.

## What this part builds on

The *theory* of these ideas already lives in `software-engineering/`. This
part is the **practical backend application** of that theory in a Node /
TypeScript API. Read the theory files when you want the general principle;
read these files when you want the code.

| Theory file | What it gives you | Where this part uses it |
|---|---|---|
| [clean-architecture.md](../../software-engineering/architecture/clean-architecture.md) | The layer model and the dependency rule | File 01 |
| [mvc.md](../../software-engineering/architecture/mvc.md) | What a controller and a model really are | File 01 |
| [repository-pattern.md](../../software-engineering/design-patterns/repository-pattern.md) | The pattern definition and when it is overkill | File 03 |
| [dependency-injection.md](../../software-engineering/principles/dependency-injection.md) | Why injecting beats importing | File 05 |
| [solid-principles.md](../../software-engineering/principles/solid-principles.md) | The single-responsibility and dependency-inversion rules | Files 01, 05 |

## Files

1. [Layered Architecture](01-layered-architecture.md) — a 120-line controller
   taken apart and rebuilt into layers, the dependency rule in practice, how
   far to go before it becomes over-engineering, and layer-first vs
   feature-first folders.
2. [The Service Layer](02-service-layer-part-1.md) — what a business operation looks
   like as code, the "no `req`/`res`" signature rule, the anatomy of a real
   service method, side effects and transactions, and keeping services
   testable.
3. [The Repository Layer](03-repository-layer-part-1.md) — intention-revealing data
   access, interfaces and in-memory fakes, mandatory tenant scoping as a
   security feature, N+1 at the boundary, and an honest look at when a
   repository is pure ceremony.
4. [DTOs and Serialization](04-dtos-and-serialization-part-1.md) — why `res.json(user)`
   leaks password hashes, allow-list output shapes, money and id and date
   conventions, per-role field visibility, and `PATCH` with explicit `null`.
5. [Dependency Injection in Practice](05-dependency-injection-in-practice.md) —
   a composition root you write by hand, when a container earns its place,
   lifetimes and the request-scoped-into-singleton bug, and injecting the clock.

## Read in this order

Read 1 → 5, one file per sitting.

File 1 is the map and every later file assumes its vocabulary (layer,
dependency rule, controller, service, repository). Files 2 and 3 are the two
layers you will write most often. File 4 is the layer between your data and
the outside world, and it is the one with the most security value. File 5 is
the glue — read it last, because it only makes sense once you have separate
pieces that need connecting.

## What you should be able to do after this part

- Take a controller that does everything and split it into layers without
  guessing where each line belongs.
- Explain the dependency rule in your own words, and spot an import that
  breaks it in a code review.
- Write a service that the same code can call from an HTTP controller, a queue
  worker, a CLI command, and a test — unchanged.
- Decide, with a reason, whether a given feature needs a repository or should
  use the ORM directly.
- Guarantee that no API response ever contains a field you did not
  deliberately choose to send.
- Wire an application by hand in a composition root, and say what a DI
  container would add and what it would cost.

## Next

Part 10 — [Database Integration](../10-database-integration/) goes below the
repository line: migrations, transactions, connection pooling, and how close
to the ORM you should actually sit.
