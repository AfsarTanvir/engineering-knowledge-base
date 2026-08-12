# DRY (Don't Repeat Yourself)

DRY says every piece of knowledge should have one authoritative place in
the codebase. It's routinely misquoted as "never write similar-looking
code twice" — that's not what it means, and treating it that way is how
DRY causes more harm than the duplication it was meant to prevent.

## Table of Contents

1. [What DRY Actually Targets](#what-dry-actually-targets)
2. [A Real Example](#a-real-example)
3. [Similar Code Is Not the Same as Duplicated Knowledge](#similar-code-is-not-the-same-as-duplicated-knowledge)
4. [The Rule of Three](#the-rule-of-three)
5. [When Premature DRY-ing Backfires](#when-premature-dry-ing-backfires)
6. [Quick Reference](#quick-reference)

---

## What DRY Actually Targets

The problem DRY prevents: the same fact or rule expressed in multiple
places, which can drift out of sync when one copy is updated and the
others are forgotten.

```python
# The business rule "free shipping over $50" is duplicated —
# if the threshold changes, both places must be found and updated
def calculate_shipping_web(total):
    return 0 if total > 50 else 5.99

def calculate_shipping_mobile(total):
    return 0 if total > 50 else 5.99   # same rule, copy-pasted
```

```python
# One authoritative place for the rule
FREE_SHIPPING_THRESHOLD = 50

def calculate_shipping(total):
    return 0 if total > FREE_SHIPPING_THRESHOLD else 5.99
```

The risk DRY names specifically: someone updates the threshold to $75 in
one place, ships it, and the other copy silently keeps the old rule —
inconsistent behavior that's easy to miss in review and annoying to
debug in production.

## A Real Example

The danger compounds when the duplicated logic isn't a single constant
but an actual multi-step calculation:

```python
# Order total tax logic duplicated across two API endpoints
def get_order_total_v1(order):
    subtotal = sum(item.price * item.qty for item in order.items)
    tax = subtotal * 0.0825
    return subtotal + tax

def get_order_total_v2(order):
    subtotal = sum(item.price * item.qty for item in order.items)
    tax = subtotal * 0.0825
    return subtotal + tax
```

A future change (tax exemptions for certain categories, a new state's
tax rate) has to be found and applied in both places — and a fix that
only updates one is a real, silent bug, not just untidy code.

## Similar Code Is Not the Same as Duplicated Knowledge

Code that *looks* similar but represents *different, coincidentally
matching* logic is not a DRY violation — merging it creates an
artificial coupling between two things that have no actual reason to
change together.

```python
# These look identical today, but represent DIFFERENT business rules
# that happen to compute the same way right now
def calculate_employee_bonus(salary):
    return salary * 0.1

def calculate_referral_bonus(salary):
    return salary * 0.1   # coincidentally the same formula, for now
```

Merging these into one shared function couples "how we calculate
employee bonuses" to "how we calculate referral bonuses" — the moment
one of those business rules changes independently (referral bonuses get
capped at $500, say), the shared function has to branch based on which
caller invoked it, which is worse than the original "duplication" ever
was.

**The test:** would a business change ever need one of these to change
*without* the other? If yes, they aren't the same knowledge — leave them
separate, even though the code looks the same today.

## The Rule of Three

A common practical heuristic for when to actually extract shared code:
tolerate duplication the first time, take note the second time, and
extract a shared abstraction on the third — because by then the pattern
is proven, not guessed at.

```
1st occurrence: write it inline
2nd occurrence: notice it's similar, but it's still cheap to leave alone
3rd occurrence: now there's a real, established pattern — extract it
```

Extracting after seeing only one or two instances risks guessing at the
wrong abstraction — the shared function ends up shaped around two
coincidental cases, and the third real case forces it to be pulled apart
again anyway.

## When Premature DRY-ing Backfires

Over-applying DRY produces the exact fragility [SOLID's Open/Closed
Principle](solid-principles.md#o--openclosed-principle) principle warns
about — a shared function that different callers keep needing to
special-case eventually looks like this:

```python
# What premature DRY-ing evolves into after 4 unrelated callers
# each needed slightly different behavior from "the shared function"
def calculate_bonus(base, bonus_type, is_manager=False, region=None, capped=False):
    if bonus_type == "employee":
        result = base * 0.1
        if is_manager:
            result *= 1.5
    elif bonus_type == "referral":
        result = base * 0.1
        if capped:
            result = min(result, 500)
    elif bonus_type == "partner" and region == "EU":
        result = base * 0.08
    # ...
    return result
```

This is harder to read, harder to test, and more fragile than four
separate small functions ever were — the "duplication" it eliminated was
cheaper than the conditional maze it created. When a shared function
accumulates flags and branches to serve callers that have actually
diverged, that's the sign to split it back apart, not add another flag.

---

## Quick Reference

| Situation                                                     | DRY guidance                                          |
| :-------------------------------------------------------------------- | :------------------------------------------------------------ |
| The same business rule/fact appears in 2+ places                        | Extract it — this is exactly what DRY prevents                    |
| Code looks similar but represents unrelated concepts that happen to match | Leave it separate — merging couples things with no shared reason to change |
| Seeing a pattern for the first or second time                            | Tolerate the duplication — wait for a third occurrence               |
| A shared function has grown flags/branches to serve diverging callers      | Split it back apart — the abstraction has stopped fitting              |

**Bottom line:** DRY is about eliminating duplicated *knowledge* — one
fact, one place — not about merging code that merely looks alike.
Coincidental similarity extracted too early tends to grow branches and
flags until it's worse than the duplication it replaced.
