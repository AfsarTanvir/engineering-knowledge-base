# Observer Pattern

The observer pattern lets an object (the subject) notify a list of
dependents (observers) automatically whenever its state changes — without
the subject needing to know anything concrete about who's watching or
what they'll do in response. It's the in-process, single-application
version of the same idea behind
[pub/sub messaging](../../system-design/foundational/message-queues/overview.md)
and [event-driven architecture](../../system-design/scale-patterns/event-driven-architecture.md)
at the distributed-systems scale.

## Table of Contents

1. [The Problem It Solves](#the-problem-it-solves)
2. [Basic Implementation](#basic-implementation)
3. [Using Built-In Language Support](#using-built-in-language-support)
4. [Push vs Pull Observers](#push-vs-pull-observers)
5. [Common Pitfalls](#common-pitfalls)
6. [Observer Pattern vs Pub/Sub](#observer-pattern-vs-pubsub)
7. [Quick Reference](#quick-reference)

---

## The Problem It Solves

Without this pattern, a subject that needs to notify several unrelated
parts of the system about a change ends up calling each of them
directly — coupling it to every current consumer, and requiring a code
change every time a new consumer needs to react:

```python
class Order:
    def mark_shipped(self):
        self.status = "shipped"
        EmailService().send_shipping_notification(self)   # hard-wired
        AnalyticsService().track_shipment(self)             # hard-wired
        # adding a 3rd interested party means editing this method again
```

## Basic Implementation

The subject keeps a list of observers and calls a common method on each
when something happens — it never needs to know what any individual
observer actually does with the notification:

```python
class Order:
    def __init__(self):
        self.status = "pending"
        self._observers = []

    def subscribe(self, observer):
        self._observers.append(observer)

    def mark_shipped(self):
        self.status = "shipped"
        for observer in self._observers:
            observer.on_order_shipped(self)

class EmailNotifier:
    def on_order_shipped(self, order):
        send_email(f"Order shipped: {order}")

class AnalyticsTracker:
    def on_order_shipped(self, order):
        track_event("order_shipped", order)

order = Order()
order.subscribe(EmailNotifier())
order.subscribe(AnalyticsTracker())

order.mark_shipped()   # both observers react, Order doesn't know either exists concretely
```

Adding a third interested party (a fraud-check service, say) means
calling `order.subscribe(FraudChecker())` — zero changes to `Order`
itself, satisfying the same
[Open/Closed Principle](../principles/solid-principles.md#o--openclosed-principle)
the [Factory](factory-pattern.md) and [Strategy](strategy-pattern.md)
patterns also serve.

## Using Built-In Language Support

Most ecosystems have built-in or standard-library support for this
pattern rather than requiring you to hand-roll the subscribe/notify
mechanics — reach for those before writing your own:

```python
from blinker import signal

order_shipped = signal("order-shipped")

def notify_email(sender, **kwargs):
    send_email(f"Order shipped: {sender}")

def notify_analytics(sender, **kwargs):
    track_event("order_shipped", sender)

order_shipped.connect(notify_email)
order_shipped.connect(notify_analytics)

order_shipped.send(order)   # both receivers fire
```

```javascript
// Node's built-in EventEmitter is the same pattern
const emitter = new EventEmitter();
emitter.on('order:shipped', (order) => sendEmail(order));
emitter.on('order:shipped', (order) => trackEvent(order));
emitter.emit('order:shipped', order);
```

## Push vs Pull Observers

**Push model** (shown above) — the subject sends the relevant data
directly to each observer's callback. Simple, and sufficient for most
cases.

**Pull model** — the subject only signals *that* something changed;
observers query the subject for whatever specific details they need:

```python
class Order:
    def mark_shipped(self):
        self.status = "shipped"
        for observer in self._observers:
            observer.on_order_changed(self)   # pass the subject itself, not specific data

class DetailedLogger:
    def on_order_changed(self, order):
        # pulls exactly what it needs, rather than receiving a fixed payload
        log(f"{order.id}: {order.status}, {order.tracking_number}")
```

Pull is useful when different observers need different subsets of data
from the subject — push forces every observer to receive (or ignore) the
same fixed payload.

## Common Pitfalls

- **Memory leaks from forgotten unsubscription** — an observer that's no
  longer relevant (a UI component that's been destroyed, say) but never
  unsubscribed keeps receiving notifications and keeps the subject
  holding a reference to it, preventing garbage collection:

```python
class Order:
    def unsubscribe(self, observer):
        self._observers.remove(observer)
    # callers need to actually call this when an observer's lifecycle ends
```

- **Notification order dependencies** — if observers are notified in
  list order and one observer's logic accidentally depends on another
  having already run, that's a hidden, fragile coupling; observers
  should be able to run in any order (or even concurrently) without
  correctness depending on it
- **Exceptions in one observer blocking the rest** — a naive loop that
  doesn't catch exceptions per-observer means one broken observer
  prevents every subsequent observer from being notified at all:

```python
def mark_shipped(self):
    self.status = "shipped"
    for observer in self._observers:
        try:
            observer.on_order_shipped(self)
        except Exception:
            log_error(f"Observer {observer} failed")   # don't let one bad observer block the rest
```

## Observer Pattern vs Pub/Sub

Same core idea, different scope:

- **Observer pattern** — in-process, direct object references, subject
  and observers typically share the same memory space and lifecycle
- **[Pub/Sub](../../system-design/foundational/message-queues/overview.md)** —
  cross-process or cross-service, via a message broker, with delivery
  guarantees, persistence, and network failure modes the in-process
  version never has to consider

Reach for the plain observer pattern within a single application/process;
reach for actual pub/sub infrastructure (Kafka, SNS+SQS) the moment
observers live in a genuinely separate service or process.

---

## Quick Reference

| Question                                                | Answer                                                    |
| :-------------------------------------------------------------- | :----------------------------------------------------------------- |
| Multiple unrelated parts of the app need to react to one event     | Observer pattern                                                       |
| Should the subject know what each observer does?                    | No — that's exactly what this pattern avoids                              |
| Observers are in a different process/service                        | Use real pub/sub (message broker), not the in-process pattern              |
| An observer is no longer needed                                      | Explicitly unsubscribe — forgetting to causes memory leaks                   |
| One observer throws an exception                                     | Catch it per-observer so it doesn't block notifying the rest                  |

**Bottom line:** the observer pattern decouples a subject from the
specific things that react to its changes — new reactions can be added
by subscribing, with zero changes to the subject itself. It's the
in-process analog of pub/sub; reach for actual messaging infrastructure
once observers cross a process boundary.
