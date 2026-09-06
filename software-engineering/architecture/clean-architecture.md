# Clean Architecture

Clean Architecture organizes a system into concentric layers, with one
strict rule: dependencies only point inward. Business rules at the
center never depend on frameworks, databases, or UI details at the
edges — those outer layers depend on the center instead. It's the
[Dependency Inversion Principle](../principles/solid-principles.md#d--dependency-inversion-principle)
applied as a whole-application organizing structure, rather than to one
class at a time.

## Table of Contents

1. [The Layers](#the-layers)
2. [The Dependency Rule](#the-dependency-rule)
3. [A Concrete Example](#a-concrete-example)
4. [Ports and Adapters](#ports-and-adapters)
5. [Why the Center Stays Framework-Free](#why-the-center-stays-framework-free)
6. [Relationship to MVC and the Repository Pattern](#relationship-to-mvc-and-the-repository-pattern)
7. [Where It's Overkill](#where-its-overkill)
8. [Quick Reference](#quick-reference)

---

## The Layers

```
        ┌─────────────────────────────────────────┐
        │   Frameworks & Drivers (outermost)        │   Web framework, DB driver, UI
        │   ┌───────────────────────────────────┐   │
        │   │   Interface Adapters                │   │   Controllers, Repositories, Presenters
        │   │   ┌─────────────────────────────┐   │   │
        │   │   │   Application/Use Cases        │   │   │   Application-specific business rules
        │   │   │   ┌───────────────────────┐   │   │   │
        │   │   │   │   Entities (innermost)   │   │   │   │   Core business rules, domain model
        │   │   │   └───────────────────────┘   │   │   │
        │   │   └─────────────────────────────┘   │   │
        │   └───────────────────────────────────┘   │
        └─────────────────────────────────────────┘
```

- **Entities** — the core domain model and its fundamental business
  rules; the most stable layer, least likely to change for any external
  reason
- **Use Cases** — application-specific business logic, orchestrating
  entities to accomplish a specific task ("place an order," "cancel a
  subscription")
- **Interface Adapters** — translates between the use cases and the
  outside world: Controllers (incoming), Repositories (data access),
  Presenters (outgoing formatting)
- **Frameworks & Drivers** — the actual web framework, database driver,
  UI toolkit — the most volatile, most replaceable layer

## The Dependency Rule

**Source code dependencies can only point inward.** An inner layer must
never import, reference, or know about anything in an outer layer:

```
Frameworks & Drivers  ──depends on──>  Interface Adapters
Interface Adapters    ──depends on──>  Use Cases
Use Cases              ──depends on──>  Entities
Entities                ──depends on──>  nothing outside itself
```

```python
# WRONG: an entity importing a web framework — inner layer depending outward
from flask import request   # Entities should never see this

class Order:
    def place(self):
        customer_id = request.form["customer_id"]   # violates the dependency rule
```

```python
# RIGHT: the outer layer (Controller) depends inward on the use case;
# the use case has no idea Flask exists
class PlaceOrderUseCase:
    def execute(self, customer_id, items):
        order = Order(customer_id, items)
        order.validate()
        return order

# Interface Adapter layer — knows about Flask, calls inward into the use case
@app.route("/orders", methods=["POST"])
def place_order_controller():
    use_case = PlaceOrderUseCase()
    order = use_case.execute(request.form["customer_id"], request.form["items"])
    return jsonify(order.to_dict())
```

## A Concrete Example

```python
# Entity — core domain rule, zero framework/infrastructure awareness
class Order:
    def __init__(self, customer_id, items):
        self.customer_id = customer_id
        self.items = items

    def total(self):
        return sum(i.price * i.qty for i in self.items)

    def validate(self):
        if not self.items:
            raise ValueError("Order must have at least one item")

# Use case — application-specific orchestration, depends only on entities
# and abstractions (never concrete infrastructure)
class PlaceOrderUseCase:
    def __init__(self, order_repository: OrderRepository):  # an abstraction — see below
        self.order_repository = order_repository

    def execute(self, customer_id, items):
        order = Order(customer_id, items)
        order.validate()
        self.order_repository.save(order)
        return order

# Interface Adapter — the concrete repository implementation, living
# in the outer layer, satisfying the abstraction the use case depends on
class SqlOrderRepository(OrderRepository):
    def save(self, order):
        db.execute("INSERT INTO orders ...", ...)
```

`PlaceOrderUseCase` depends on `OrderRepository` — an abstraction — not
on `SqlOrderRepository` directly. This is exactly the
[Repository pattern](../design-patterns/repository-pattern.md), used
specifically to keep the Use Case layer from depending outward on a
concrete database.

## Ports and Adapters

The same dependency-rule idea appears under a different, related name —
**Hexagonal Architecture** (Ports and Adapters) — using slightly
different vocabulary for the same core concept:

- **Port** — an interface the core application defines, describing what
  it needs from the outside world (`OrderRepository` above is a port)
- **Adapter** — a concrete implementation of a port, living in the outer
  layer (`SqlOrderRepository` is an adapter)

```
Core application defines: "I need something that can save an Order" (a port)
Outer layer provides: SqlOrderRepository, or a FakeOrderRepository for tests (adapters)
```

Whether you call it Clean Architecture's layers or Hexagonal's
ports/adapters, the underlying rule is identical: the core never depends
on a specific outer implementation, only on an abstraction the outer
layer must conform to.

## Why the Center Stays Framework-Free

The concrete, practical payoff: business logic (Entities, Use Cases) can
be tested without a web server, without a real database, and without any
UI — and can survive a framework migration (Flask to FastAPI, one ORM to
another) with zero changes to the actual business rules, since those
never depended on the framework to begin with.

```python
def test_place_order_requires_items():
    use_case = PlaceOrderUseCase(order_repository=FakeOrderRepository())
    with pytest.raises(ValueError):
        use_case.execute(customer_id=1, items=[])
```

No Flask test client, no database fixture — this test exercises pure
business logic directly, the same testability payoff
[Dependency Injection](../principles/dependency-injection.md) and the
[Repository pattern](../design-patterns/repository-pattern.md) provide
individually, here applied consistently across the whole application's
structure.

## Relationship to MVC and the Repository Pattern

Clean Architecture isn't a replacement for [MVC](mvc.md) — it's a
stricter set of rules about *dependency direction* that can wrap around
an MVC-shaped web layer. The Controller in MVC maps naturally onto the
"Interface Adapters" layer; the Model often splits into Entities (pure
domain rules) and Use Cases (application-specific orchestration) rather
than being one undifferentiated layer.

The [Repository pattern](../design-patterns/repository-pattern.md) is
usually how the Use Cases layer gets access to data without violating
the dependency rule — it's not a separate concept from Clean
Architecture, it's the specific mechanism Clean Architecture relies on
at that boundary.

## Where It's Overkill

- **Small applications, short-lived projects, or simple CRUD** — the
  layering and abstraction overhead costs real time and files for a
  benefit (framework independence, database independence) that may
  never be exercised — the same [YAGNI](../principles/yagni.md)
  calculation as any other upfront abstraction
- **A team unfamiliar with the structure** — the indirection (interfaces
  for things with one implementation, an extra Use Case layer between
  Controller and Model) can slow a team down more than it helps if
  nobody's clear on why each layer exists

**The core discipline — keep business logic from depending on
frameworks/databases directly — is worth applying even in a simpler
project without adopting every layer formally.** Full Clean Architecture
with all four named layers is worth the ceremony specifically for
larger, longer-lived systems where framework/database independence and
extensive automated testing are real, ongoing needs.

---

## Quick Reference

| Question                                                     | Answer                                                       |
| :---------------------------------------------------------------------- | :--------------------------------------------------------------------- |
| Can an inner layer (Entities, Use Cases) import a framework/DB directly?  | No — that's the dependency rule's entire point                             |
| How does a Use Case get data without violating the rule?                    | Depends on an abstraction (a port/repository interface), not a concrete implementation |
| Is this the same idea as Hexagonal/Ports and Adapters?                       | Yes — same principle, different vocabulary                                   |
| Is this worth adopting for a small, short-lived project?                     | Often not fully — see [YAGNI](../principles/yagni.md); the underlying discipline still helps |
| How does this relate to MVC?                                                 | Compatible — MVC's Controller/Model map onto Clean Architecture's outer/inner layers |

**Bottom line:** Clean Architecture's one real rule — dependencies point
inward, business logic never depends on frameworks or databases directly
— is what keeps core logic testable and portable across infrastructure
changes. Adopt the full four-layer ceremony for larger, longer-lived
systems; keep the underlying discipline even when the full structure is
more than a given project needs.
