# Strategy Pattern

The strategy pattern extracts an algorithm (or a piece of business
logic that varies) into its own interchangeable object, so the code
using it can switch behavior at runtime without an if/elif chain and
without editing existing code to add a new variant. It's the most direct,
common way to satisfy the
[Open/Closed Principle](../principles/solid-principles.md#o--openclosed-principle) —
that page's OCP example *is* the strategy pattern, shown from the
principle's side rather than the pattern's.

## Table of Contents

1. [The Problem It Solves](#the-problem-it-solves)
2. [Basic Implementation](#basic-implementation)
3. [Choosing a Strategy at Runtime](#choosing-a-strategy-at-runtime)
4. [Strategy Objects vs Plain Functions](#strategy-objects-vs-plain-functions)
5. [Strategy vs Factory](#strategy-vs-factory)
6. [When Not to Use It](#when-not-to-use-it)
7. [Quick Reference](#quick-reference)

---

## The Problem It Solves

A growing conditional selecting between behaviors is the classic sign
this pattern applies — every new variant means editing an existing,
already-tested function:

```python
def calculate_shipping_cost(method, weight, distance):
    if method == "standard":
        return weight * 0.5 + distance * 0.1
    elif method == "express":
        return weight * 1.0 + distance * 0.3
    elif method == "overnight":
        return weight * 2.0 + distance * 0.5
    # every new shipping method requires editing this function again
```

## Basic Implementation

Each variant becomes its own class implementing a shared interface; the
calling code depends only on that interface, never on which concrete
variant it holds:

```python
class ShippingStrategy(Protocol):
    def calculate(self, weight, distance) -> float: ...

class StandardShipping:
    def calculate(self, weight, distance):
        return weight * 0.5 + distance * 0.1

class ExpressShipping:
    def calculate(self, weight, distance):
        return weight * 1.0 + distance * 0.3

class OvernightShipping:
    def calculate(self, weight, distance):
        return weight * 2.0 + distance * 0.5

class ShippingCalculator:
    def __init__(self, strategy: ShippingStrategy):
        self.strategy = strategy    # injected — see dependency-injection.md

    def get_cost(self, weight, distance):
        return self.strategy.calculate(weight, distance)

calculator = ShippingCalculator(ExpressShipping())
calculator.get_cost(weight=5, distance=100)
```

Adding `SameDayShipping` means writing one new class — `ShippingCalculator`
and every existing strategy class are untouched.

## Choosing a Strategy at Runtime

The interesting part isn't the strategy classes themselves — it's that
the *choice* of which one to use can be deferred to runtime, based on
user input, configuration, or context, rather than hard-coded:

```python
STRATEGIES = {
    "standard": StandardShipping(),
    "express": ExpressShipping(),
    "overnight": OvernightShipping(),
}

def get_calculator(method: str) -> ShippingCalculator:
    return ShippingCalculator(STRATEGIES[method])

# The specific method comes from a request, a user's selection, etc.
calculator = get_calculator(request.form["shipping_method"])
```

This lookup step is itself a small [factory](factory-pattern.md) — the
two patterns commonly pair up: a factory decides *which* strategy to
construct, the strategy interface is what makes the rest of the code
indifferent to which one was chosen.

## Strategy Objects vs Plain Functions

In languages with first-class functions, a full class per strategy is
often more ceremony than needed — a plain function satisfies the same
interface if the strategy has no internal state to maintain:

```python
def standard_shipping(weight, distance):
    return weight * 0.5 + distance * 0.1

def express_shipping(weight, distance):
    return weight * 1.0 + distance * 0.3

STRATEGIES = {
    "standard": standard_shipping,
    "express": express_shipping,
}

def get_cost(method, weight, distance):
    return STRATEGIES[method](weight, distance)
```

**Use a class-based strategy when the algorithm needs to hold
configuration or state** (an API key, a rate table loaded once and
reused); **use a plain function when it's genuinely stateless** — forcing
every strategy into a class with one method just to "follow the pattern"
is unnecessary ceremony, the same kind [KISS](../principles/kiss.md)
warns against.

## Strategy vs Factory

These are frequently used together but solve different problems:

- **Strategy** — makes an *algorithm* swappable; the caller holds a
  strategy object and calls a common method on it, indifferent to which
  concrete implementation it is
- **[Factory](factory-pattern.md)** — makes *object creation* swappable;
  the caller asks for "an X" without knowing which concrete class of X
  it gets back

A factory often *produces* the strategy object the caller will then use
— "which shipping strategy should I use" (factory's job) is a separate
question from "given a shipping strategy, calculate the cost" (strategy's
job).

## When Not to Use It

- **Only one implementation exists, with no realistic second one on the
  horizon** — introducing the interface and a single concrete class adds
  a layer of indirection with no current benefit, exactly the
  [YAGNI](../principles/yagni.md) trap
- **The "variants" are just simple parameter differences**, not actually
  different algorithms — a shipping cost that only varies by a
  multiplier constant doesn't need separate strategy classes, just a
  parameter:

```python
# No strategy pattern needed — this is one algorithm with a rate parameter,
# not several different algorithms
def calculate_shipping(weight, distance, rate_multiplier):
    return weight * rate_multiplier + distance * 0.1
```

---

## Quick Reference

| Signal                                                          | Guidance                                              |
| :---------------------------------------------------------------------- | :------------------------------------------------------------ |
| A growing if/elif choosing between algorithms                             | Good candidate for the strategy pattern                          |
| Need to swap behavior at runtime based on input/config                     | Strategy pattern is exactly this                                    |
| The strategy has no internal state to hold                                 | A plain function often suffices — skip the class ceremony            |
| Only one implementation exists and no second is realistically coming        | Skip the pattern — see [YAGNI](../principles/yagni.md)                 |
| "Variants" differ only by a parameter value, not by actual algorithm        | Use a parameter, not separate strategy classes                        |

**Bottom line:** the strategy pattern turns "which algorithm" into a
runtime-swappable object instead of a hard-coded conditional — the same
mechanism the Open/Closed Principle asks for, applied specifically to
interchangeable behavior. Skip it when there's genuinely only one
algorithm, or when the variation is just a parameter, not a different
process.
