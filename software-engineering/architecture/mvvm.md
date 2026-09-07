# MVVM (Model-View-ViewModel)

MVVM replaces [MVC](mvc.md)'s Controller with a ViewModel — an object
that exposes the Model's data in a display-ready form and reacts to user
actions, connected to the View through automatic data binding instead of
a Controller mediating each request. It's the dominant pattern for rich
client UIs (mobile apps, single-page web apps, desktop apps) where the
UI updates continuously, not once per discrete request.

## Table of Contents

1. [Why MVC's Controller Doesn't Fit Here](#why-mvcs-controller-doesnt-fit-here)
2. [The Three Roles in MVVM](#the-three-roles-in-mvvm)
3. [Data Binding: The Core Mechanism](#data-binding-the-core-mechanism)
4. [A Concrete Example](#a-concrete-example)
5. [Testability: The ViewModel Has No UI Dependency](#testability-the-viewmodel-has-no-ui-dependency)
6. [MVVM vs MVC](#mvvm-vs-mvc)
7. [Where MVVM Struggles](#where-mvvm-struggles)
8. [Quick Reference](#quick-reference)

---

## Why MVC's Controller Doesn't Fit Here

MVC's Controller is built around "one request comes in, one response
goes out." A rich client UI doesn't work in discrete requests — the user
types into a field, a value recalculates, a list filters, all
continuously, with no natural "request" to hang a Controller action on:

```
MVC's model: Controller action -> fetch data -> render a whole View
             (fits: page load, form submit)

Rich UI's reality: user types a character -> total recalculates ->
                    UI updates immediately, no full "request" occurred
                    (doesn't fit a per-request Controller model well)
```

MVVM's ViewModel is designed for this continuous, bidirectional
relationship instead of a one-shot request/response cycle.

## The Three Roles in MVVM

- **Model** — same role as in MVC: data and business logic, no UI
  awareness at all
- **View** — the actual UI markup/components; binds to the ViewModel's
  properties and forwards user actions to it, contains minimal logic of
  its own
- **ViewModel** — holds UI state and presentation logic, exposes it in a
  display-ready shape, and exposes commands/methods the View can invoke
  in response to user actions. Has no reference to the View at all — it
  doesn't know or care how (or even whether) it's being displayed.

```
View <--data binding (automatic sync)--> ViewModel <--calls into--> Model
```

## Data Binding: The Core Mechanism

The View doesn't manually pull data from the ViewModel or manually push
updates to it — a binding framework keeps them in sync automatically,
in both directions:

```javascript
// Vue example: `total` on the ViewModel automatically updates the View
// whenever it changes, with no manual DOM update code
const OrderViewModel = {
  data() {
    return { items: [], total: 0 };
  },
  computed: {
    formattedTotal() {
      return `$${this.total.toFixed(2)}`;
    }
  },
  methods: {
    addItem(item) {
      this.items.push(item);
      this.total += item.price * item.qty;   // View updates automatically
    }
  }
};
```

```html
<!-- View: binds directly to the ViewModel's state, no manual sync code -->
<div>
  <p>{{ formattedTotal }}</p>
  <button @click="addItem(newItem)">Add</button>
</div>
```

This two-way binding is what MVVM adds over MVC's one-directional
Controller-picks-a-View flow — changes to the ViewModel's state
propagate to the View automatically, and user input in the View (a
button click, a text field) propagates back to the ViewModel.

## A Concrete Example

```typescript
// Model — pure business logic, no UI concerns
class Order {
  constructor(public items: OrderItem[]) {}
  get total(): number {
    return this.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  }
}

// ViewModel — exposes UI-ready state and actions; NO reference to any
// specific View/UI framework component
class OrderViewModel {
  private order = new Order([]);
  totalDisplay = "$0.00";       // presentation-ready, not just raw data
  isCheckoutEnabled = false;

  addItem(item: OrderItem) {
    this.order.items.push(item);
    this.recalculate();
  }

  private recalculate() {
    this.totalDisplay = `$${this.order.total.toFixed(2)}`;
    this.isCheckoutEnabled = this.order.items.length > 0;
  }
}

// View — binds to the ViewModel; this is framework-specific glue code,
// kept as thin as possible
```

`totalDisplay` (a formatted string) and `isCheckoutEnabled` (a UI-state
boolean) are examples of presentation logic that lives in the
ViewModel — not raw domain data, but not UI framework code either.

## Testability: The ViewModel Has No UI Dependency

Because the ViewModel never references the actual View/UI framework, it
can be tested exactly like any other plain object — no rendering
engine, no DOM, no UI test harness required:

```typescript
test("adding an item updates the total display", () => {
  const vm = new OrderViewModel();
  vm.addItem({ price: 10, qty: 2 });

  expect(vm.totalDisplay).toBe("$20.00");
  expect(vm.isCheckoutEnabled).toBe(true);
});
```

This mirrors the same testability payoff
[Dependency Injection](../principles/dependency-injection.md) and the
[Repository pattern](../design-patterns/repository-pattern.md) give
elsewhere — pushing a dependency (here, the UI itself) out of the object
under test makes it trivial to exercise directly.

## MVVM vs MVC

| Aspect                                | MVC                                          | MVVM                                              |
| :----------------------------------------- | :------------------------------------------------ | :------------------------------------------------------- |
| What mediates between input and data          | Controller (one action per request)                 | ViewModel (continuous, bidirectional binding)               |
| Best fit                                       | Server-rendered pages, discrete request/response      | Rich client UIs (SPA, mobile, desktop) with continuous state |
| Does the mediator know about the View?           | Controller picks a View, somewhat aware of it           | ViewModel has zero reference to the View at all               |
| How does the View update?                        | Full re-render per request                              | Automatic, granular updates via data binding                    |

## Where MVVM Struggles

- **Over-binding** — putting too much logic into bindings/computed
  properties scattered across many small ViewModel properties can become
  as hard to trace as a tangled Controller, just distributed differently
- **Simple, mostly-static pages** — the overhead of a binding framework
  and a ViewModel layer isn't worth it for a page with little dynamic
  state; [MVC](mvc.md) (or no formal pattern at all) is simpler and
  sufficient there, per [KISS](../principles/kiss.md)
- **Debugging binding chains** — when a UI update doesn't happen as
  expected, tracing *why* through several layers of automatic binding
  can be harder than following an explicit Controller's imperative code

---

## Quick Reference

| Question                                                   | Answer                                                     |
| :-------------------------------------------------------------------- | :------------------------------------------------------------------ |
| Building a rich, continuously-updating client UI (SPA, mobile app)?      | MVVM is a strong fit                                                    |
| Building a traditional server-rendered page, one response per request?    | [MVC](mvc.md) fits more naturally                                        |
| Does the ViewModel know about the specific View/framework?                 | No — that's what keeps it independently testable                          |
| How does the View stay in sync with the ViewModel's state?                  | Data binding, automatic in both directions                                 |
| My page is simple and mostly static                                         | Skip the ViewModel layer — not worth the overhead                            |

**Bottom line:** MVVM swaps MVC's request-oriented Controller for a
ViewModel built around continuous, bidirectional data binding — the
right fit once a UI has enough ongoing, dynamic state that a per-request
Controller model stops making sense. The ViewModel's complete UI
independence is what makes it directly unit-testable, the same payoff
dependency injection gives elsewhere in the codebase.
