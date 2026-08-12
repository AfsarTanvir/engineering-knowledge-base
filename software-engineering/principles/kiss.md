# KISS (Keep It Simple, Stupid)

KISS says the simplest solution that correctly solves the actual problem
beats a more "clever" or "flexible" one — complexity should be earned by
a real requirement, not added because it's technically interesting or
feels more professional. It's the principle most directly in tension with
over-applying [SOLID](solid-principles.md) or reaching for a
[design pattern](../design-patterns/factory-pattern.md) before one's
actually needed.

## Table of Contents

1. [Simple Is Not the Same as Easy](#simple-is-not-the-same-as-easy)
2. [A Concrete Example](#a-concrete-example)
3. [Where Complexity Actually Comes From](#where-complexity-actually-comes-from)
4. [Signs You've Violated KISS](#signs-youve-violated-kiss)
5. [KISS Doesn't Mean "No Abstraction, Ever"](#kiss-doesnt-mean-no-abstraction-ever)
6. [Quick Reference](#quick-reference)

---

## Simple Is Not the Same as Easy

"Simple" here means *few moving parts, easy to trace, easy to reason
about* — not "quick to write" or "the first thing that came to mind."
Sometimes the simplest correct solution takes more thought to arrive at
than a more convoluted one that technically also works.

```python
# "Easy" to write, not actually simple — reaches for a general-purpose
# rule engine to solve a problem that's really just three conditions
class PricingRule:
    def __init__(self, condition_fn, discount_fn):
        self.condition_fn = condition_fn
        self.discount_fn = discount_fn

rules = [
    PricingRule(lambda o: o.total > 100, lambda o: o.total * 0.9),
    PricingRule(lambda o: o.customer.is_vip, lambda o: o.total * 0.85),
]

def apply_pricing(order):
    for rule in rules:
        if rule.condition_fn(order):
            return rule.discount_fn(order)
    return order.total
```

```python
# Actually simple: same behavior, no framework to understand first
def apply_pricing(order):
    if order.customer.is_vip:
        return order.total * 0.85
    if order.total > 100:
        return order.total * 0.9
    return order.total
```

The second version is simple because reading it top to bottom tells you
exactly what happens — no indirection, no framework-within-the-code to
learn before the logic itself makes sense.

## A Concrete Example

A common KISS violation: solving "we might need to support multiple
databases someday" with a full abstraction layer, for an app that has
used exactly one database its entire life.

```python
# Over-engineered: an abstract interface, a factory, and a registry —
# for an app that has only ever used, and has no concrete plan to
# stop using, PostgreSQL
class DatabaseInterface(ABC):
    @abstractmethod
    def query(self, sql): ...

class PostgresDatabase(DatabaseInterface):
    def query(self, sql): ...

class DatabaseFactory:
    _registry = {"postgres": PostgresDatabase}
    @classmethod
    def create(cls, db_type):
        return cls._registry[db_type]()

db = DatabaseFactory.create("postgres")
```

```python
# Simple: use the actual database library directly
import psycopg2
db = psycopg2.connect(DATABASE_URL)
```

If a second database genuinely becomes a real, funded requirement
later, that's exactly when to introduce the abstraction — see
[YAGNI](yagni.md) for the matching principle about not building for
hypothetical future requirements.

## Where Complexity Actually Comes From

Unnecessary complexity tends to come from a small number of recurring
sources:

- **Solving a more general problem than the one that exists** — building
  a plugin system for "any future discount type" when there are two
  known discount types and no roadmap for a third
- **Premature abstraction** — introducing an interface/base class before
  there's a second real implementation to justify it
- **Cleverness for its own sake** — a one-liner using three chained
  higher-order functions that's genuinely harder to read than five
  plain lines, even though it's "more elegant"
- **Configuration for things that never vary** — making something
  configurable that has had exactly one value since the project started

## Signs You've Violated KISS

- Explaining the code out loud takes longer than the problem it solves
  seems to warrant
- A new team member needs a design doc, not just the code, to understand
  a single function
- The abstraction has exactly one real implementation, and has for its
  entire existence
- You reach for a named design pattern because it seems like "the right
  way to do it," rather than because the specific problem it solves is
  the one you actually have

## KISS Doesn't Mean "No Abstraction, Ever"

KISS is not an argument for writing everything as one giant function, or
avoiding interfaces entirely — an abstraction that matches a genuine,
current need (multiple real implementations, a real testing seam) is
simple *for that problem*. The failure mode KISS names is complexity
that doesn't correspond to any real, current requirement — not
abstraction in general.

```python
# This interface isn't over-engineering — there ARE two real,
# currently-used implementations, and tests genuinely need to swap one
# for a fake
class PaymentGateway(Protocol):
    def charge(self, amount): ...

class StripeGateway(PaymentGateway): ...
class PayPalGateway(PaymentGateway): ...
```

The question is never "is this abstract" — it's "does this abstraction
correspond to something real that exists today."

---

## Quick Reference

| Question                                                    | If the answer is yes...                                |
| :-------------------------------------------------------------------- | :------------------------------------------------------------ |
| Does this abstraction have more than one real implementation today?     | Probably justified                                               |
| Is this solving a more general problem than the one that actually exists? | Simplify — solve the actual problem                                |
| Would a new team member need extra explanation beyond the code itself?    | Likely too complex for what it does                                |
| Is this configurable/flexible for a variation that's never occurred?       | Remove the flexibility until it's actually needed — see [YAGNI](yagni.md) |

**Bottom line:** simple means matching the solution's complexity to the
problem's actual complexity — no more, no less. Complexity is a cost
paid in comprehension and maintenance; it should only be spent on a
requirement that's real today, not one that might exist someday.
