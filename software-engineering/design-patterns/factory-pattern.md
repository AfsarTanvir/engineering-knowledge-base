# Factory Pattern

A factory is a function or class whose job is creating objects, so
callers don't need to know which concrete class to instantiate or how to
construct it. It's the standard way to satisfy the
[Open/Closed Principle](../principles/solid-principles.md#o--openclosed-principle)
for object creation specifically: adding a new type means adding a new
branch (or registration) in the factory, not editing every place objects
get created.

## Table of Contents

1. [The Problem It Solves](#the-problem-it-solves)
2. [Simple Factory Function](#simple-factory-function)
3. [Factory Method Pattern](#factory-method-pattern)
4. [Abstract Factory](#abstract-factory)
5. [Registry-Based Factories](#registry-based-factories)
6. [Factory vs Just Calling the Constructor](#factory-vs-just-calling-the-constructor)
7. [Quick Reference](#quick-reference)

---

## The Problem It Solves

Without a factory, code that needs to create one of several related
types has to know about every concrete class directly, and that
knowledge gets duplicated everywhere an object is created:

```python
# Every call site needs to know all the concrete classes and their
# constructor signatures
def process_payment(method, amount):
    if method == "stripe":
        gateway = StripeGateway(api_key=STRIPE_KEY, amount=amount)
    elif method == "paypal":
        gateway = PayPalGateway(client_id=PAYPAL_ID, amount=amount)
    gateway.charge()
```

If this construction logic is needed in 5 different places, adding a
new payment method means finding and updating all 5.

## Simple Factory Function

The most common, lightweight version — a single function centralizes the
"which class, with what constructor arguments" decision:

```python
def create_payment_gateway(method: str, amount: float) -> PaymentGateway:
    if method == "stripe":
        return StripeGateway(api_key=STRIPE_KEY, amount=amount)
    elif method == "paypal":
        return PayPalGateway(client_id=PAYPAL_ID, amount=amount)
    raise ValueError(f"Unknown payment method: {method}")

# Every call site just asks for what it needs, without knowing the details
gateway = create_payment_gateway("stripe", 49.99)
gateway.charge()
```

Adding a new method now means editing one function, in one place —
callers are unaffected.

## Factory Method Pattern

A more OOP-flavored variant: instead of one standalone function, a base
class defines an abstract "create" method that subclasses override to
produce the specific type they're responsible for. Useful when the
*process* around creation (not just the object itself) varies by type:

```python
class NotificationSender(ABC):
    @abstractmethod
    def create_notification(self, message) -> Notification:
        ...

    def send(self, message):
        notification = self.create_notification(message)   # factory method
        notification.deliver()
        self.log(notification)

class EmailSender(NotificationSender):
    def create_notification(self, message):
        return EmailNotification(message)

class SmsSender(NotificationSender):
    def create_notification(self, message):
        return SmsNotification(message)
```

`send()` is shared logic (deliver + log) that works identically
regardless of notification type — only the specific creation step
(`create_notification`) varies per subclass. This is the Factory Method
pattern specifically: a factory *method* embedded in a class hierarchy,
not a standalone factory function.

## Abstract Factory

When you need to create a whole *family* of related objects that must be
used together consistently — not just one object type — an abstract
factory groups several creation methods behind one interface:

```python
class UIFactory(ABC):
    @abstractmethod
    def create_button(self) -> Button: ...
    @abstractmethod
    def create_checkbox(self) -> Checkbox: ...

class DarkThemeFactory(UIFactory):
    def create_button(self):
        return DarkButton()
    def create_checkbox(self):
        return DarkCheckbox()

class LightThemeFactory(UIFactory):
    def create_button(self):
        return LightButton()
    def create_checkbox(self):
        return LightCheckbox()

def build_form(factory: UIFactory):
    button = factory.create_button()
    checkbox = factory.create_checkbox()
    # both guaranteed to match the same theme — impossible to accidentally
    # mix a DarkButton with a LightCheckbox
```

The guarantee this adds over separate simple factories: whichever
concrete factory you pass in, everything it produces is consistent with
everything else it produces — you can't accidentally mismatch a dark
button with a light checkbox by calling the wrong factory function for
one but not the other.

## Registry-Based Factories

For a large or dynamically growing set of types, an explicit if/elif
chain becomes unwieldy — a registry lets new types register themselves,
satisfying Open/Closed without editing the factory's own source at all:

```python
class PaymentGatewayRegistry:
    _gateways = {}

    @classmethod
    def register(cls, name, gateway_class):
        cls._gateways[name] = gateway_class

    @classmethod
    def create(cls, name, **kwargs):
        return cls._gateways[name](**kwargs)

PaymentGatewayRegistry.register("stripe", StripeGateway)
PaymentGatewayRegistry.register("paypal", PayPalGateway)

# A new payment provider integration registers itself, without
# touching PaymentGatewayRegistry's own code at all
PaymentGatewayRegistry.register("square", SquareGateway)

gateway = PaymentGatewayRegistry.create("stripe", amount=49.99)
```

This is the pattern behind plugin systems — new implementations can be
added from entirely separate modules/packages, as long as they register
themselves against the shared registry.

## Factory vs Just Calling the Constructor

Not every object needs a factory — introducing one for a type with
exactly one implementation and a trivial constructor is the same
over-engineering [KISS](../principles/kiss.md) and
[YAGNI](../principles/yagni.md) warn about:

```python
# No factory needed — there's one implementation, nothing to abstract over
user = User(name="Alice", email="alice@x.com")
```

**Reach for a factory when:** there's genuinely more than one concrete
type the caller shouldn't need to know about, construction logic is
non-trivial enough to be worth centralizing, or the specific concrete
type needs to be decided at runtime based on input (a config value, a
request parameter) rather than known at the call site.

---

## Quick Reference

| Situation                                                      | Which variant                                  |
| :---------------------------------------------------------------------- | :---------------------------------------------------- |
| A handful of related types, simple creation logic                        | A plain factory function                                 |
| Creation is a step within a larger shared process that varies by subtype   | Factory Method (overridden per subclass)                    |
| Need to create several related objects that must stay consistent together | Abstract Factory                                            |
| Many, possibly plugin-supplied types, growing over time                    | Registry-based factory                                       |
| Exactly one implementation, trivial constructor                            | Skip the factory — just call the constructor                  |

**Bottom line:** a factory centralizes "which concrete type, constructed
how" so callers depend on an interface instead of a specific class list.
Use the simplest variant that fits — a plain function for a few types, a
registry once the set of types grows or comes from plugins — and skip it
entirely when there's only one implementation to begin with.
