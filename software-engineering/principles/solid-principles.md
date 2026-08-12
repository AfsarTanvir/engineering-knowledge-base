# SOLID Principles

Five guidelines for keeping object-oriented code changeable without it
collapsing under its own weight as it grows. None of them are laws — each
is a heuristic for a specific way code tends to get rigid, fragile, or
hard to test, and each can be over-applied just as easily as ignored.

## Table of Contents

1. [S — Single Responsibility Principle](#s--single-responsibility-principle)
2. [O — Open/Closed Principle](#o--openclosed-principle)
3. [L — Liskov Substitution Principle](#l--liskov-substitution-principle)
4. [I — Interface Segregation Principle](#i--interface-segregation-principle)
5. [D — Dependency Inversion Principle](#d--dependency-inversion-principle)
6. [Don't Apply These Dogmatically](#dont-apply-these-dogmatically)
7. [Quick Reference](#quick-reference)

---

## S — Single Responsibility Principle

A class should have one reason to change. Not "one method" — one
*responsibility*, one axis along which requirements can evolve.

```python
# Violates SRP: this class has two unrelated reasons to change —
# a change to invoicing rules, and a change to how invoices get emailed
class Invoice:
    def calculate_total(self):
        ...
    def send_email(self, smtp_client):
        ...
```

```python
# Each class has exactly one reason to change
class Invoice:
    def calculate_total(self):
        ...

class InvoiceMailer:
    def send(self, invoice, smtp_client):
        ...
```

The test isn't "does this class do more than one thing" literally — it's
"can I name two unrelated business reasons this class would need to
change." If yes, split it.

## O — Open/Closed Principle

Code should be extensible without modifying its existing, already-tested
source. New behavior gets *added*, not injected into an ever-growing
conditional inside existing code.

```python
# Violates OCP: adding a new discount type means editing this function again
def calculate_discount(customer_type, total):
    if customer_type == "regular":
        return total * 0.95
    elif customer_type == "vip":
        return total * 0.85
    # every new customer type requires editing this function
```

```python
# Open for extension: a new discount type is a new class, zero edits
# to existing, already-tested code
class DiscountStrategy:
    def apply(self, total): ...

class RegularDiscount(DiscountStrategy):
    def apply(self, total):
        return total * 0.95

class VipDiscount(DiscountStrategy):
    def apply(self, total):
        return total * 0.85

def calculate_discount(strategy: DiscountStrategy, total):
    return strategy.apply(total)
```

This is the same shape as the [Strategy pattern](../design-patterns/strategy-pattern.md) —
OCP is the *principle*, Strategy is one common *pattern* that satisfies
it.

## L — Liskov Substitution Principle

A subclass must be usable anywhere its parent class is expected, without
the caller needing to know which one it actually got. If substituting a
subclass changes correct behavior, it's not a valid subclass — it's a
different concept wearing the same interface.

```python
# Violates LSP: Square "is-a" Rectangle mathematically, but the substitution
# breaks callers that rely on Rectangle's width/height being independent
class Rectangle:
    def set_width(self, w): self.width = w
    def set_height(self, h): self.height = h

class Square(Rectangle):
    def set_width(self, w):
        self.width = self.height = w   # surprise: also changes height
    def set_height(self, h):
        self.width = self.height = h   # surprise: also changes width

def resize(rect: Rectangle):
    rect.set_width(5)
    rect.set_height(10)
    assert rect.width == 5   # FAILS if rect is actually a Square
```

The fix usually isn't a clever workaround — it's recognizing that
`Square` and `Rectangle` don't actually share a substitutable contract,
and shouldn't be in an inheritance relationship at all.

## I — Interface Segregation Principle

Don't force a class to implement methods it doesn't use just because
they're bundled into one large interface it partially needs.

```python
# Violates ISP: a Robot has to implement eat() and sleep(), which make no sense for it
class Worker(Protocol):
    def work(self): ...
    def eat(self): ...
    def sleep(self): ...

class Robot(Worker):
    def work(self): ...
    def eat(self): raise NotImplementedError   # forced to implement something meaningless
    def sleep(self): raise NotImplementedError
```

```python
# Segregated: each class implements only what actually applies to it
class Workable(Protocol):
    def work(self): ...

class Eatable(Protocol):
    def eat(self): ...

class Human(Workable, Eatable):
    def work(self): ...
    def eat(self): ...

class Robot(Workable):
    def work(self): ...   # no forced, meaningless eat()/sleep()
```

Smaller, focused interfaces mean implementers only take on the contracts
that genuinely apply to them.

## D — Dependency Inversion Principle

High-level code (business logic) shouldn't depend directly on low-level
implementation details (a specific database, a specific email provider)
— both should depend on a shared abstraction, and the low-level detail
should be the one conforming to it.

```python
# Violates DIP: OrderService is directly coupled to a concrete Postgres class
class PostgresDatabase:
    def save(self, order): ...

class OrderService:
    def __init__(self):
        self.db = PostgresDatabase()   # hard-wired to one specific implementation
    def place_order(self, order):
        self.db.save(order)
```

```python
# Inverted: OrderService depends on an abstraction; the concrete
# implementation is provided from outside, not constructed internally
class Database(Protocol):
    def save(self, order): ...

class PostgresDatabase(Database):
    def save(self, order): ...

class OrderService:
    def __init__(self, db: Database):    # depends on the abstraction, not the concrete class
        self.db = db
    def place_order(self, order):
        self.db.save(order)
```

**This is a design principle about which direction dependencies point —
not the same thing as [Dependency Injection](../principles/dependency-injection.md),
which is the specific *technique* of supplying those dependencies from
outside (as the constructor above does). DIP is the "what" and "why";
DI is one common "how."**

---

## Don't Apply These Dogmatically

Each principle counters a specific real problem — but taken to an
extreme, each backfires:

- Over-applying SRP splits classes so finely that following a single
  piece of logic means jumping across a dozen tiny files
- Over-applying OCP builds abstraction layers (strategy classes,
  plugin points) for variation that will never actually occur — see
  [YAGNI](yagni.md)
- Over-applying ISP fragments interfaces into so many tiny pieces that
  implementing "the obvious thing" requires assembling five of them

Use these to recognize *why* a specific piece of code is hard to change
or test — not as a checklist to apply uniformly whether or not the
underlying problem is actually present. See [KISS](kiss.md) for the
matching principle on the other side of this tension.

---

## Quick Reference

| Principle                     | Problem it prevents                                              |
| :--------------------------------- | :----------------------------------------------------------------------- |
| Single Responsibility               | A class with unrelated reasons to change, where editing one breaks the other |
| Open/Closed                          | Adding new behavior requires editing existing, already-tested code            |
| Liskov Substitution                  | A subclass that breaks correctness when substituted for its parent             |
| Interface Segregation                | Being forced to implement methods that don't apply to you                        |
| Dependency Inversion                  | High-level logic hard-coupled to a specific low-level implementation             |

**Bottom line:** each SOLID letter is a targeted fix for a specific way
code becomes rigid or fragile — apply the one that matches a problem
you actually have, not all five uniformly to code that doesn't need
them yet.
