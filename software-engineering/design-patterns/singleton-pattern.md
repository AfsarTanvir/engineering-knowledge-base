# Singleton Pattern

A singleton guarantees a class has exactly one instance, accessible from
anywhere via a global access point. It's one of the most well-known
design patterns — and also one of the most widely criticized, because
the exact thing that makes it convenient (global access to shared state)
is also what makes code depending on it hard to test and reason about.

## Table of Contents

1. [The Basic Implementation](#the-basic-implementation)
2. [Why Teams Reach for It](#why-teams-reach-for-it)
3. [Why It's Controversial](#why-its-controversial)
4. [The Testing Problem, Concretely](#the-testing-problem-concretely)
5. [The Hidden Dependency Problem](#the-hidden-dependency-problem)
6. [Better Alternatives](#better-alternatives)
7. [When a Singleton Is Actually Reasonable](#when-a-singleton-is-actually-reasonable)
8. [Quick Reference](#quick-reference)

---

## The Basic Implementation

```python
class ConfigManager:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance.settings = {}
        return cls._instance

config = ConfigManager()
config.settings["debug"] = True

config2 = ConfigManager()
print(config2.settings["debug"])   # True — same underlying instance
```

Every call to `ConfigManager()` anywhere in the codebase returns the
exact same object — there's no way to construct a second, independent
one.

## Why Teams Reach for It

- **Shared, genuinely single-instance resources** — a connection pool, a
  logging system, an in-memory cache — where having two independent
  instances would be actively wrong (two separate connection pools
  competing for the same limited connections, say)
- **Convenience** — global access means any code, anywhere, can reach
  the instance without it being threaded through every constructor along
  the call chain

## Why It's Controversial

The convenience is exactly the problem, for two related reasons:

- **It's global mutable state**, and global mutable state is inherently
  hard to reason about — any code, anywhere, can read or modify it, so
  understanding one piece of code's behavior may require understanding
  everything else that touches the singleton too
- **It hides dependencies** — a class that reaches out to
  `ConfigManager()` internally doesn't declare that dependency anywhere
  visible (no constructor parameter, no import that obviously signals
  "this class needs configuration") — you have to read the method bodies
  to discover it

This is the direct opposite of the visibility [Dependency Injection](../principles/dependency-injection.md)
gives you — a constructor parameter documents a dependency; a global
singleton buries it.

## The Testing Problem, Concretely

```python
class OrderService:
    def place_order(self, order):
        if ConfigManager().settings.get("orders_enabled"):
            # ... process the order
            pass
```

Testing `place_order` now requires either mutating the real, global
`ConfigManager` singleton before the test runs (and cleaning it up
afterward, carefully, or it leaks into other tests) — or monkeypatching
around the singleton entirely, both of which are more fragile than
simply passing configuration in:

```python
def test_place_order_when_disabled():
    ConfigManager()._instance.settings["orders_enabled"] = False   # mutating global state
    service = OrderService()
    # ... test, then MUST remember to reset the global state after,
    #     or this leaks into the next test that runs
```

**Tests that mutate shared global state can pass or fail depending on
what order they run in** — a test earlier in the suite leaving the
singleton in an unexpected state is a real, common source of flaky test
suites.

## The Hidden Dependency Problem

Beyond testing specifically, hidden dependencies make code harder to
understand in general — reading `OrderService`'s constructor tells you
nothing about its reliance on global config, logging, or a database
connection if all of those are fetched via singletons deep inside method
bodies instead of declared as constructor parameters.

```python
# What OrderService actually depends on is invisible from its signature
class OrderService:
    def place_order(self, order):
        db = DatabaseSingleton()          # hidden
        logger = LoggerSingleton()         # hidden
        config = ConfigManager()            # hidden
        ...
```

## Better Alternatives

**Dependency injection**, passing the shared instance explicitly instead
of reaching for it globally — the instance can still genuinely be
created once (at the application's entry point) without every consumer
needing a global accessor:

```python
config = ConfigManager()   # created once, at startup

class OrderService:
    def __init__(self, config: ConfigManager):   # explicit, visible dependency
        self.config = config

order_service = OrderService(config=config)
```

This keeps the "only one instance exists" property (nothing stops you
from only ever constructing `ConfigManager()` once) while making the
dependency visible and swappable for tests — the best of both, without
the hidden-global-state cost.

**A DI container's "singleton scope"** — most DI frameworks (see
[dependency-injection.md](../principles/dependency-injection.md#di-containers))
offer a way to register a dependency as "create once, reuse everywhere it's
injected" — giving you the single-instance guarantee through the
container's configuration, not through a globally-accessible class
pattern.

## When a Singleton Is Actually Reasonable

- **Truly stateless, side-effect-free utilities** where "one instance vs
  many" doesn't actually matter functionally — the concern above is
  really about *mutable shared state*, not about instance count per se
- **Framework-level infrastructure** (a logging configuration, in some
  ecosystems) where the convention is well-established and the
  alternative (threading a logger through every function signature)
  genuinely adds more noise than it's worth
- **Legacy codebases already built around one**, where refactoring every
  consumer to proper DI is a larger project than the current task
  justifies

Even in these cases, prefer the "created once, injected explicitly"
approach over a global accessor when starting something new — get the
single-instance guarantee without paying the hidden-dependency cost.

---

## Quick Reference

| Question                                                  | Guidance                                                |
| :------------------------------------------------------------------ | :------------------------------------------------------------ |
| Do I need exactly one instance of something?                          | Often yes — but that doesn't require a *global accessor pattern* |
| Should other code fetch it via a global `ClassName()` call?           | Prefer passing it in via the constructor instead                 |
| Will this need to be swapped for a fake in tests?                      | Strong signal to inject it explicitly, not use a singleton accessor |
| Is this genuinely stateless, with no meaningful shared mutable state?    | The downsides matter much less here                              |

**Bottom line:** "exactly one instance" and "globally accessible from
anywhere via a static call" are two separate ideas that the classic
Singleton pattern bundles together — you can usually get the first
without the second by constructing the instance once and passing it
explicitly wherever it's needed.
