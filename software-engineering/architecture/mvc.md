# MVC (Model-View-Controller)

MVC splits an application into three roles: the Model holds data and
business logic, the View renders it, and the Controller mediates between
user input and the other two. The point of the split is the same one
behind [Single Responsibility](../principles/solid-principles.md#s--single-responsibility-principle) —
a change to how data is displayed shouldn't require touching the logic
that computes it, and vice versa.

## Table of Contents

1. [The Three Roles](#the-three-roles)
2. [A Concrete Example](#a-concrete-example)
3. [The Request Flow](#the-request-flow)
4. [Why the Model Shouldn't Know About the View](#why-the-model-shouldnt-know-about-the-view)
5. [Fat Models, Thin Controllers](#fat-models-thin-controllers)
6. [MVC on the Web vs Desktop/Mobile](#mvc-on-the-web-vs-desktopmobile)
7. [Where MVC Struggles](#where-mvc-struggles)
8. [Quick Reference](#quick-reference)

---

## The Three Roles

- **Model** — the data and the business logic that operates on it
  (validation, calculations, persistence). Has no idea how it's going to
  be displayed.
- **View** — presentation only. Renders whatever the Model gives it,
  contains no business logic of its own.
- **Controller** — receives input (an HTTP request, a button click),
  decides what the Model should do in response, and picks which View to
  render with the result.

```
User action -> Controller -> asks Model to do something / fetch data
                    |
                    v
              picks a View, hands it the Model's data
                    |
                    v
              View renders -> response back to the user
```

## A Concrete Example

```python
# Model: data + business logic, no knowledge of HTTP or templates
class Order:
    def __init__(self, id, items):
        self.id = id
        self.items = items

    def total(self):
        return sum(item.price * item.qty for item in self.items)

# Controller: mediates between the request and the model/view
def order_detail_view(request, order_id):
    order = Order.objects.get(id=order_id)   # ask the model layer for data
    if order is None:
        return render(request, "404.html", status=404)
    return render(request, "order_detail.html", {"order": order})   # pick a view

# View (template): presentation only, no business logic
# order_detail.html:
#   <h1>Order #{{ order.id }}</h1>
#   <p>Total: ${{ order.total }}</p>
```

The Controller's job is narrow and mechanical: fetch what's needed,
handle the "not found" case, choose a template. The actual business rule
(how a total is calculated) lives in the Model, not scattered between
the Controller and the template.

## The Request Flow

```
1. User visits /orders/42
2. Router maps this URL to order_detail_view (a Controller function)
3. Controller asks the Model layer for Order #42
4. Controller passes the Order to the View (a template)
5. View renders HTML using the Order's data
6. Response sent back to the user
```

This flow is the same shape whether it's a classic server-rendered web
app (Django, Rails), or a request-handling layer in front of an API
that returns JSON instead of HTML — the Controller/routing layer maps a
request to Model logic and picks a response format, regardless of what
that format is.

## Why the Model Shouldn't Know About the View

If `Order` knew how to render itself as HTML, changing the display
(a redesign, adding a mobile view, exposing the same data via a JSON
API) would require touching the Model — coupling business logic to
presentation concerns that should be independent:

```python
# Anti-pattern: Model knows about presentation
class Order:
    def total(self):
        return sum(item.price * item.qty for item in self.items)

    def render_html(self):    # this doesn't belong here
        return f"<p>Total: ${self.total()}</p>"
```

Keeping the Model presentation-agnostic means the same `Order.total()`
can back an HTML page, a JSON API response, and a PDF export without any
duplication of the actual calculation logic — this is the same principle
[DRY](../principles/dry.md) protects, applied to keeping one calculation
in one place regardless of how many ways it's eventually displayed.

## Fat Models, Thin Controllers

A common, well-earned piece of MVC guidance: business logic belongs in
the Model, not the Controller. A Controller that accumulates business
rules becomes hard to test (it's entangled with the web framework) and
hard to reuse (the same rule can't be invoked from a background job or a
CLI script without going through an HTTP request):

```python
# Fat Controller (anti-pattern): business logic embedded in request handling
def place_order_view(request):
    items = request.POST.get("items")
    total = 0
    for item in items:
        total += item["price"] * item["qty"]
    if total > 10000:
        discount = total * 0.05
        total -= discount
    # ...business logic buried in a function that's hard to call from anywhere else
```

```python
# Thin Controller: delegates the actual logic to the Model
def place_order_view(request):
    order = Order.create_from_request(request.POST)   # Model owns the logic
    return render(request, "order_confirmation.html", {"order": order})
```

The Model's logic (`create_from_request`, `apply_discount`) can now be
unit-tested directly, and reused from a management command, a background
worker, or a test — without needing a fake HTTP request to invoke it.

## MVC on the Web vs Desktop/Mobile

MVC originated in desktop GUI applications, where the View often
directly observes the Model (via the [Observer pattern](../design-patterns/observer-pattern.md))
and updates itself automatically when the Model changes — a tighter,
more bidirectional relationship than the typical web request/response
cycle:

```
Desktop MVC: Model changes -> notifies View directly -> View re-renders itself,
             without a "Controller" mediating every single update
```

Web frameworks (Rails, Django, ASP.NET MVC) adapted the pattern to a
request/response cycle where the Controller is invoked once per request,
rather than the View continuously observing the Model — the three-role
split is the same, but the mechanics differ from the original desktop
concept enough that it's worth not assuming they behave identically.

## Where MVC Struggles

- **Rich, stateful client-side UIs** — a single-page app with complex,
  continuously-updating UI state doesn't map cleanly onto "one
  Controller action per request" — this is exactly the gap
  [MVVM](mvvm.md) is designed to fill
- **"Fat Controller" drift** — without discipline, it's easy for
  business logic to accumulate in Controllers anyway (validation,
  authorization checks, orchestration logic) rather than being pushed
  into Models or a separate service layer

---

## Quick Reference

| Question                                                    | Answer                                                |
| :-------------------------------------------------------------------- | :------------------------------------------------------------ |
| Where does business logic (calculations, validation) belong?             | The Model                                                        |
| Where does HTML/template rendering logic belong?                          | The View                                                         |
| Where does "what should happen in response to this request" live?          | The Controller — but it should delegate, not implement, the logic  |
| Can the same Model logic back both an HTML page and a JSON API?             | Yes — that's the point of keeping the Model presentation-agnostic    |
| My app has complex, continuously-updating client-side UI state              | Look at [MVVM](mvvm.md) instead                                    |

**Bottom line:** MVC's value comes from keeping business logic (Model),
presentation (View), and request handling (Controller) as three separate
concerns — the most common way this breaks down in practice is
Controllers quietly accumulating business logic that belongs in the
Model instead.
