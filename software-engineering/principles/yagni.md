# YAGNI (You Aren't Gonna Need It)

YAGNI says: don't build something until an actual requirement needs it —
not "might need," not "will probably need eventually," an actual
requirement, today. It's the sibling principle to [KISS](kiss.md): KISS
is about not over-complicating what you're building right now; YAGNI is
about not building things you don't need to build at all yet.

## Table of Contents

1. [The Core Argument](#the-core-argument)
2. [Speculative Generality](#speculative-generality)
3. [A Concrete Example](#a-concrete-example)
4. [Why "We'll Need It Eventually" Is a Weak Argument](#why-well-need-it-eventually-is-a-weak-argument)
5. [YAGNI vs Genuine Foresight](#yagni-vs-genuine-foresight)
6. [Where YAGNI Doesn't Apply](#where-yagni-doesnt-apply)
7. [Quick Reference](#quick-reference)

---

## The Core Argument

Building for a hypothetical future requirement costs real time now, and
carries a real chance the guess about the future turns out wrong —
paying a cost today for a benefit that may never materialize, in a form
you may not have even guessed correctly.

```
Cost of building it now, before it's needed:
  - time spent building and testing something with no current user
  - ongoing maintenance burden for code nothing currently exercises
  - a real chance the actual future requirement looks different from
    the guess, making the speculative code wasted AND in the way

Cost of building it later, when it's actually needed:
  - the same implementation work, done once, informed by a real
    requirement instead of a guess
```

The asymmetry is the whole argument: waiting costs nothing if the
requirement never materializes, and costs the same implementation effort
(often less, since the real requirement is now known precisely) if it
does.

## Speculative Generality

The most common concrete form YAGNI violations take — building a generic,
configurable, or pluggable mechanism for variation that doesn't exist yet:

```python
# Speculative: a full plugin/registry system for export formats,
# built for a future that hasn't asked for it — there is exactly one
# format in use today
class ExportFormat(ABC):
    @abstractmethod
    def export(self, data): ...

class ExportRegistry:
    _formats = {}
    @classmethod
    def register(cls, name, formatter):
        cls._formats[name] = formatter
    @classmethod
    def export(cls, name, data):
        return cls._formats[name]().export(data)

class CsvExport(ExportFormat):
    def export(self, data): ...

ExportRegistry.register("csv", CsvExport)
```

```python
# What's actually needed today
def export_to_csv(data):
    ...
```

If a second export format becomes a real requirement, *that's* the
moment to introduce an abstraction — informed by two actual concrete
cases instead of one real case and a guess.

## A Concrete Example

```python
# Adding a "just in case" configuration option nobody asked for
class EmailService:
    def __init__(self, retry_count=3, retry_backoff=2, retry_jitter=True,
                 max_retry_delay=60, retry_strategy="exponential"):
        # 5 knobs for retry behavior, all defaulted, none ever changed
        # by any caller anywhere in the codebase
        ...
```

```python
# What's actually needed, given the current single caller and its needs
class EmailService:
    def __init__(self):
        ...
```

Every parameter added "in case someone needs to configure it later" is
API surface that has to be understood, documented, and kept working —
paid for immediately, with no current beneficiary.

## Why "We'll Need It Eventually" Is a Weak Argument

"Eventually" is doing a lot of unearned work in that sentence. Two
questions expose whether it's a real signal or a guess:

- **Is there an actual ticket, customer commitment, or roadmap item
  driving this — not just a feeling that it seems likely?**
- **If it does happen, will the eventual real requirement actually match
  what's being speculatively built now?** Often, when the real
  requirement eventually shows up, it looks different enough from the
  guess that the speculative code has to be reworked anyway — at which
  point it provided no benefit at all, only cost.

## YAGNI vs Genuine Foresight

YAGNI isn't an argument for being blind to clearly foreseeable needs —
it's specifically about not building the *implementation* of a feature
before it's needed. Structuring code so that adding a feature later is
*easy* (clean separation of concerns, following
[SOLID](solid-principles.md) where it genuinely applies) is different
from actually *building* that feature's speculative machinery now.

```python
# NOT a YAGNI violation: a clean separation that costs nothing extra
# today, and happens to make a future addition easier if it comes
class PaymentProcessor:
    def process(self, payment: Payment):
        ...

# A YAGNI violation would be: building a PaymentProcessorFactory,
# a PaymentProcessorRegistry, and 3 unused processor subclasses
# for payment methods the product doesn't support and has no plan to
```

Writing reasonably clean, well-separated code is good practice regardless
— YAGNI specifically targets building unused, speculative *machinery*,
not writing tangled code that would make a future change hard.

## Where YAGNI Doesn't Apply

- **Genuinely expensive-to-retrofit decisions** — a database schema
  choice, a public API's shape, an authentication mechanism — where
  getting it wrong is far costlier to fix later than getting it "too
  flexible" is to build now. These warrant more upfront thought, not
  less.
- **Known, committed requirements just not yet implemented** — if
  there's an actual roadmap item for multi-currency support next
  quarter, laying minimal groundwork now (storing currency alongside
  amount, say) isn't speculative — it's implementing a known requirement
  incrementally.

---

## Quick Reference

| Question                                                       | Answer                                                    |
| :---------------------------------------------------------------------- | :----------------------------------------------------------------- |
| Is there a real, current requirement driving this, or a guess about the future? | Build it only if the requirement is real and current today            |
| Is this speculative flexibility, or a genuinely cheap-to-add separation?    | Speculative machinery (unused factories/registries) — skip it; cheap separation — fine  |
| Is this an expensive-to-retrofit decision (schema, public API)?              | More upfront thought is warranted — YAGNI applies less here             |
| Is this a known, committed future requirement (on an actual roadmap)?         | Not speculative — build incrementally as needed, it's real                |

**Bottom line:** the cost of building something speculative is paid
immediately and certainly; the benefit is uncertain and often smaller
than expected once the real requirement actually shows up. Wait for the
real requirement — it's cheaper than guessing, even when the guess turns
out roughly right.
