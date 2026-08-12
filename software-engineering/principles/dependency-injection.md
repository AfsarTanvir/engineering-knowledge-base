# Dependency Injection

Dependency Injection (DI) is the practice of supplying a class's
dependencies from the outside, rather than having the class construct
them itself internally. It's the concrete *technique* most commonly used
to satisfy the [Dependency Inversion Principle](solid-principles.md#d--dependency-inversion-principle) —
DIP is the design rule about which direction dependencies should point;
DI is one specific way of actually wiring that up in code.

## Table of Contents

1. [Without DI: Hidden, Hard-Wired Dependencies](#without-di-hidden-hard-wired-dependencies)
2. [Constructor Injection](#constructor-injection)
3. [Why This Matters for Testing](#why-this-matters-for-testing)
4. [Setter/Property Injection](#setterproperty-injection)
5. [DI Containers](#di-containers)
6. [DI vs the Dependency Inversion Principle](#di-vs-the-dependency-inversion-principle)
7. [When DI Is Overkill](#when-di-is-overkill)
8. [Quick Reference](#quick-reference)

---

## Without DI: Hidden, Hard-Wired Dependencies

A class that creates its own dependencies internally is tightly coupled
to one specific implementation of each — and that coupling is invisible
from the outside, buried inside the constructor:

```python
class OrderService:
    def __init__(self):
        self.db = PostgresDatabase()          # hard-wired
        self.mailer = SmtpMailer()              # hard-wired
        self.payment = StripePaymentGateway()    # hard-wired

    def place_order(self, order):
        self.db.save(order)
        self.payment.charge(order.total)
        self.mailer.send_confirmation(order)
```

Anyone using `OrderService` has no way to swap in a different database,
a different payment provider, or — critically for testing — a fake
version of any of them, without editing `OrderService`'s own source.

## Constructor Injection

The dependencies become parameters, supplied by whoever creates the
object — the class no longer knows or cares which concrete
implementation it's using, only that it satisfies the expected interface:

```python
class OrderService:
    def __init__(self, db: Database, mailer: Mailer, payment: PaymentGateway):
        self.db = db
        self.mailer = mailer
        self.payment = payment

    def place_order(self, order):
        self.db.save(order)
        self.payment.charge(order.total)
        self.mailer.send_confirmation(order)

# The actual wiring happens once, at the application's entry point —
# not scattered across every place OrderService gets used
order_service = OrderService(
    db=PostgresDatabase(),
    mailer=SmtpMailer(),
    payment=StripePaymentGateway(),
)
```

This is constructor injection — the most common form, because the
dependency is guaranteed to be present the moment the object exists (no
"forgot to set it before use" bugs).

## Why This Matters for Testing

This is DI's single most concrete, immediate payoff: a class depending on
abstractions instead of concrete implementations can be tested with fake
versions of every dependency, with no real database, no real email
provider, and no real payment gateway involved:

```python
class FakeDatabase:
    def __init__(self):
        self.saved = []
    def save(self, order):
        self.saved.append(order)

class FakePaymentGateway:
    def __init__(self, should_succeed=True):
        self.should_succeed = should_succeed
        self.charged = []
    def charge(self, amount):
        self.charged.append(amount)
        return self.should_succeed

def test_place_order_saves_and_charges():
    db = FakeDatabase()
    payment = FakePaymentGateway()
    service = OrderService(db=db, mailer=FakeMailer(), payment=payment)

    service.place_order(sample_order)

    assert db.saved == [sample_order]
    assert payment.charged == [sample_order.total]
```

No network calls, no real charges, no test database to provision — the
test runs in milliseconds and is entirely deterministic. Without DI, this
kind of test either requires an actual Stripe sandbox account and a real
database connection, or heavy-handed monkeypatching of internals from
outside the class.

## Setter/Property Injection

An alternative where dependencies are set after construction, via a
setter, rather than passed to the constructor:

```python
class OrderService:
    def __init__(self):
        self.db = None
        self.mailer = None

    def set_database(self, db: Database):
        self.db = db

order_service = OrderService()
order_service.set_database(PostgresDatabase())
```

**Generally weaker than constructor injection** — the object can exist in
a half-configured, invalid state (created but `db` never set), which
constructor injection makes impossible by construction. Mainly useful for
optional dependencies, or in frameworks that require a no-argument
constructor for other reasons (some ORMs, some serialization libraries).

## DI Containers

At small scale, wiring dependencies by hand (as in the constructor
injection example) is simple and sufficient. At larger scale — many
classes, many shared dependencies, deep dependency chains — a DI
container automates the wiring, constructing objects and their
dependencies based on registered mappings:

```python
# Conceptual example (frameworks like Spring in Java, or python-dependency-injector,
# automate this registration + resolution)
container.register(Database, PostgresDatabase)
container.register(Mailer, SmtpMailer)
container.register(PaymentGateway, StripePaymentGateway)

order_service = container.resolve(OrderService)
# the container inspects OrderService's constructor, sees it needs a
# Database, Mailer, and PaymentGateway, and automatically supplies the
# registered implementation of each
```

**Reach for a container once manual wiring genuinely becomes unwieldy** —
many frameworks (Spring, ASP.NET Core, NestJS) build this in as a core
feature. For a small number of dependencies, manual constructor wiring
(as shown earlier) is simpler and doesn't require learning a container's
own configuration API — see [KISS](kiss.md) and [YAGNI](yagni.md).

## DI vs the Dependency Inversion Principle

These are easy to conflate because they share the "dependency" word, but
they answer different questions:

- **Dependency Inversion Principle (DIP)** — a design rule: high-level
  code should depend on abstractions, not concrete low-level
  implementations. It's about *which direction* a dependency relationship
  should point.
- **Dependency Injection (DI)** — a technique: supply dependencies from
  outside a class rather than constructing them internally. It's about
  *how* a dependency actually gets provided to a class that needs it.

You can follow DIP without DI (a class could still internally instantiate
one specific implementation of an abstraction it depends on) — and DI is
most valuable specifically when combined with DIP (injecting a concrete
class with no shared abstraction at all still leaves you coupled to that
concrete type, just with an extra constructor parameter instead of an
internal `new`).

## When DI Is Overkill

Not every dependency needs to be injected — a pure, stateless utility
with no side effects and no reasonable alternative implementation gains
nothing from being passed in:

```python
# No need to inject this — there's no meaningful alternative
# implementation, and it has no side effects to fake in a test
import math

def calculate_distance(x1, y1, x2, y2):
    return math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
```

Reserve DI for dependencies that have real side effects (I/O, network
calls, randomness, time) or genuinely have more than one implementation
worth swapping — injecting everything, including trivial pure functions,
is the same over-engineering [KISS](kiss.md) warns about.

---

## Quick Reference

| Question                                                | Answer                                                    |
| :-------------------------------------------------------------- | :----------------------------------------------------------------- |
| A class needs a database/network/external dependency               | Inject it via the constructor                                        |
| A dependency needs to be swapped in tests for a fake                | This is exactly what constructor injection enables                     |
| Many classes, many shared dependencies, wiring by hand is painful   | Consider a DI container                                                |
| Is DI the same as the Dependency Inversion Principle?               | No — DIP is the design rule, DI is one technique for satisfying it       |
| A pure function with no side effects and no alternative implementation | Don't bother injecting it                                              |

**Bottom line:** dependency injection's real payoff is testability —
supplying dependencies from outside a class means tests can substitute
fakes instead of hitting real infrastructure. Use manual constructor
wiring until it's genuinely unwieldy; reserve a full DI container for
that point, not before.
