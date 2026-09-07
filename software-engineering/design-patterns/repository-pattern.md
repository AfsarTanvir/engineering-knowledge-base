# Repository Pattern

A repository sits between business logic and data access, presenting
data as a simple collection-like interface (`get`, `add`, `find_by_x`)
while hiding exactly how that data is actually stored or retrieved.
Business logic depends on the repository's interface, not on SQL, an
ORM, or a specific database — a direct application of the
[Dependency Inversion Principle](../principles/solid-principles.md#d--dependency-inversion-principle)
to the data layer specifically.

## Table of Contents

1. [The Problem It Solves](#the-problem-it-solves)
2. [Basic Implementation](#basic-implementation)
3. [Why This Matters for Testing](#why-this-matters-for-testing)
4. [Repository vs Raw ORM Usage](#repository-vs-raw-orm-usage)
5. [Repository vs Generic CRUD Wrapper](#repository-vs-generic-crud-wrapper)
6. [Where It Fits in a Layered Architecture](#where-it-fits-in-a-layered-architecture)
7. [When It's Overkill](#when-its-overkill)
8. [Quick Reference](#quick-reference)

---

## The Problem It Solves

Without a repository, data access details (SQL, ORM query syntax,
connection handling) end up scattered directly inside business logic —
coupling every place that needs an order to the specific mechanics of
how orders are currently stored:

```python
class OrderService:
    def get_pending_orders(self, customer_id):
        conn = get_db_connection()
        cursor = conn.execute(
            "SELECT * FROM orders WHERE customer_id = %s AND status = 'pending'",
            (customer_id,)
        )
        return [Order.from_row(row) for row in cursor.fetchall()]
```

Switching databases, changing the schema, or even just testing this
method without a real database all require touching this business logic
directly.

## Basic Implementation

```python
class OrderRepository:
    def __init__(self, db_connection):
        self.db = db_connection

    def get_by_id(self, order_id) -> Order | None:
        row = self.db.execute("SELECT * FROM orders WHERE id = %s", (order_id,)).fetchone()
        return Order.from_row(row) if row else None

    def find_pending_by_customer(self, customer_id) -> list[Order]:
        rows = self.db.execute(
            "SELECT * FROM orders WHERE customer_id = %s AND status = 'pending'",
            (customer_id,)
        ).fetchall()
        return [Order.from_row(row) for row in rows]

    def add(self, order: Order):
        self.db.execute(
            "INSERT INTO orders (customer_id, status, total) VALUES (%s, %s, %s)",
            (order.customer_id, order.status, order.total)
        )

class OrderService:
    def __init__(self, repository: OrderRepository):
        self.repository = repository    # injected — see dependency-injection.md

    def get_pending_orders(self, customer_id):
        return self.repository.find_pending_by_customer(customer_id)
```

`OrderService` no longer knows or cares that this is SQL, which table
name is used, or how connections are managed — it just asks the
repository for what it needs, in business-domain terms.

## Why This Matters for Testing

Same payoff as [Dependency Injection](../principles/dependency-injection.md)
generally, applied specifically to the data layer: business logic tests
can run against an in-memory fake repository instead of a real database:

```python
class FakeOrderRepository:
    def __init__(self):
        self.orders = []

    def find_pending_by_customer(self, customer_id):
        return [o for o in self.orders if o.customer_id == customer_id and o.status == "pending"]

    def add(self, order):
        self.orders.append(order)

def test_get_pending_orders():
    repo = FakeOrderRepository()
    repo.add(Order(customer_id=1, status="pending", total=50))
    repo.add(Order(customer_id=1, status="shipped", total=30))

    service = OrderService(repository=repo)
    pending = service.get_pending_orders(customer_id=1)

    assert len(pending) == 1
```

No test database, no SQL, no fixtures to set up and tear down — the test
runs in microseconds and only exercises `OrderService`'s actual logic.

## Repository vs Raw ORM Usage

Modern ORMs (SQLAlchemy, Django's ORM, ActiveRecord) already provide a
collection-like interface over the database — which raises a fair
question: doesn't the ORM already give you this abstraction?

```python
# Django ORM used directly inside business logic
class OrderService:
    def get_pending_orders(self, customer_id):
        return Order.objects.filter(customer_id=customer_id, status="pending")
```

This is more concise, and for many applications, genuinely sufficient —
the ORM itself is already an abstraction over raw SQL. **The case for an
explicit repository on top of that:** it decouples business logic from
the *specific ORM's query API* (not just from raw SQL), which matters if
you ever need to swap ORMs, support multiple data sources behind the same
interface, or need a testing seam that doesn't require the ORM's own
test database setup at all. Introduce the extra layer when one of those
is a real, current need — not by default for every project.

## Repository vs Generic CRUD Wrapper

A repository should express domain-meaningful queries (`find_pending_by_customer`),
not just be a thin, generic pass-through for arbitrary queries — the
latter provides little real abstraction and just adds indirection:

```python
# Weak: a generic wrapper that just forwards arbitrary filters —
# business logic still has to know the underlying field names/query shape
class GenericRepository:
    def find(self, **filters):
        return self.db.query(self.model).filter_by(**filters).all()

# Better: the repository's methods speak the business domain's language
class OrderRepository:
    def find_pending_by_customer(self, customer_id):
        ...
    def find_overdue(self, as_of_date):
        ...
```

The domain-specific version is what actually keeps query logic (and
knowledge of the schema) out of the business layer — a generic filter
pass-through still leaks schema knowledge into every caller.

## Where It Fits in a Layered Architecture

The repository is the boundary between the domain/business layer and the
data layer — the same seam
[Clean Architecture](../architecture/clean-architecture.md) calls out
explicitly as a "port," with the concrete database implementation as the
"adapter" behind it:

```
Business logic (OrderService)
        |
        v
Repository interface (OrderRepository — an abstraction)
        |
        v
Concrete implementation (SqlOrderRepository, or a fake for tests)
```

## When It's Overkill

- **A small application with one data source and no realistic plan to
  swap it, test extensively against fakes, or support multiple storage
  backends** — using the ORM directly is simpler and has less
  indirection to maintain, matching [KISS](../principles/kiss.md)
- **CRUD screens with no meaningful business logic between the UI and
  the database** — a thin admin panel wrapping a table directly rarely
  benefits from an extra abstraction layer sitting in between

---

## Quick Reference

| Situation                                                       | Guidance                                                  |
| :------------------------------------------------------------------------ | :------------------------------------------------------------------ |
| Business logic needs to be testable without a real database                 | Repository pattern (with a fake implementation for tests)              |
| Might need to swap ORMs or support multiple data sources someday, concretely | Consider a repository — otherwise this alone isn't enough justification |
| A repository's methods just forward arbitrary filters                         | Not a real abstraction — express domain-meaningful queries instead        |
| Simple CRUD app, one data source, no complex business logic                    | Skip it — use the ORM directly                                             |

**Bottom line:** a repository's real value is a clean, domain-shaped
testing seam between business logic and data access — worth it once
that logic is complex enough to need fast, database-free tests. For
simple CRUD with no meaningful logic in between, using the ORM directly
is simpler and loses little.
