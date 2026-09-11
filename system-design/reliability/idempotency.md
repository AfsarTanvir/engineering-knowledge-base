# Idempotency in Distributed Systems

An idempotent operation produces the same result no matter how many times
it's applied. In a distributed system, this isn't a nice-to-have — network
failures make "did that request actually go through?" a question you
genuinely can't always answer, and retrying safely requires the retried
operation to not cause harm if the original secretly succeeded.

## Table of Contents

1. [Why This Matters: The Retry-Ambiguity Problem](#why-this-matters-the-retry-ambiguity-problem)
2. [Naturally Idempotent Operations](#naturally-idempotent-operations)
3. [Idempotency Keys](#idempotency-keys)
4. [Implementing an Idempotency Key Store](#implementing-an-idempotency-key-store)
5. [Database-Level Idempotency](#database-level-idempotency)
6. [Idempotency in Message Consumers](#idempotency-in-message-consumers)
7. [What Idempotency Doesn't Solve](#what-idempotency-doesnt-solve)
8. [Quick Reference](#quick-reference)

---

## Why This Matters: The Retry-Ambiguity Problem

```
Client sends "charge $50" -> Server processes it, charges $50 -> Response lost in transit
Client sees a timeout -> Client retries "charge $50" -> Server charges $50 AGAIN
```

The server did its job correctly both times — the request said "charge
$50" and it charged $50. The bug is that the client can't tell "the
request never arrived" apart from "the request arrived and succeeded, but
the response didn't make it back." Both look identical from the client's
side: a timeout.

Combined with the guidance in
[circuit-breakers-and-retries.md](circuit-breakers-and-retries.md) —
retry on transient failures — you need every retried write to be safe to
apply more than once, or retrying becomes as dangerous as the failure it
was meant to recover from.

## Naturally Idempotent Operations

Some operations are idempotent by construction — no extra work needed:

```sql
-- Idempotent: setting a value to X always results in X, no matter how many times
UPDATE users SET status = 'active' WHERE id = 1020;

-- Idempotent: DELETE on an already-deleted row is a no-op, not an error
DELETE FROM sessions WHERE token = 'abc123';

-- NOT idempotent: each call adds another 10, changing the result every time
UPDATE accounts SET balance = balance + 10 WHERE id = 1020;
```

**HTTP method semantics map to this directly:** `GET`, `PUT`, and `DELETE`
are supposed to be idempotent by the spec; `POST` is not — which is
exactly why "charge $50" (a `POST`) is the dangerous case and "set status
to active" (a `PUT`) isn't.

Where possible, phrase an operation as "set to this value" or "ensure
this state" rather than "add/increment/create" — it removes the problem
before you need any extra machinery.

## Idempotency Keys

When the operation is inherently non-idempotent (charge a card, create an
order, send an email), attach a unique key the client generates once per
logical operation and reuses on every retry of that same operation:

```python
import uuid

idempotency_key = str(uuid.uuid4())  # generated ONCE, before the first attempt

def charge_card(amount, idempotency_key):
    response = requests.post(
        "https://api.payments.com/charges",
        json={"amount": amount},
        headers={"Idempotency-Key": idempotency_key}
    )
    return response

# Retry reuses the SAME key — the server can recognize "I've seen this before"
for attempt in range(3):
    try:
        return charge_card(50, idempotency_key)
    except TimeoutError:
        continue  # same idempotency_key on every retry
```

This is exactly how Stripe, PayPal, and most payment APIs work — the key
lives in a header, generated per logical operation, not per HTTP attempt.

## Implementing an Idempotency Key Store

On the server side, record which keys have already been processed and
what the result was, so a repeated key returns the original result
instead of redoing the work:

```python
def handle_charge_request(amount, idempotency_key):
    existing = db.query(
        "SELECT response FROM idempotency_keys WHERE key = %s", idempotency_key
    )
    if existing:
        return existing.response  # already handled — return the same result, don't redo it

    result = actually_charge_card(amount)

    db.execute(
        "INSERT INTO idempotency_keys (key, response, created_at) VALUES (%s, %s, NOW())",
        idempotency_key, result
    )
    return result
```

**The check-and-insert must be atomic** — two concurrent requests with the
same key arriving at nearly the same time could both pass the "not found"
check before either inserts, and both proceed to charge the card. Use a
unique constraint on the key column and let the second insert fail:

```sql
CREATE TABLE idempotency_keys (
    key VARCHAR(64) PRIMARY KEY,   -- uniqueness enforced by the database, not app logic
    response JSONB,
    created_at TIMESTAMP
);
```

```python
try:
    db.execute("INSERT INTO idempotency_keys (key, response) VALUES (%s, %s)",
               idempotency_key, None)  # reserve the key first
except UniqueViolation:
    return wait_for_or_fetch_existing_result(idempotency_key)

result = actually_charge_card(amount)
db.execute("UPDATE idempotency_keys SET response = %s WHERE key = %s",
           result, idempotency_key)
return result
```

**Expire old keys** (e.g., after 24 hours) — keeping them forever isn't
necessary once enough time has passed that a client would never
realistically retry that old a request.

## Database-Level Idempotency

For simpler cases, a unique constraint alone can make an operation
idempotent without a separate key store — let the database reject the
duplicate:

```sql
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    client_request_id VARCHAR(64) UNIQUE,  -- client generates this once per order attempt
    total DECIMAL
);
```

```python
try:
    db.execute(
        "INSERT INTO orders (client_request_id, total) VALUES (%s, %s)",
        client_request_id, total
    )
except UniqueViolation:
    return db.query("SELECT * FROM orders WHERE client_request_id = %s", client_request_id)
```

This works well when the idempotent unit *is* the row itself (creating an
order) rather than an arbitrary action with a separate response payload
to remember (like a charge that also needs to return a transaction ID).

## Idempotency in Message Consumers

Message queues typically guarantee at-least-once delivery (see
[message-queues/overview.md](../foundational/message-queues/overview.md)) —
meaning a consumer *will* eventually see the same message twice. The fix
is the same principle applied to message processing instead of HTTP
retries: track which message IDs have already been processed.

```python
def process_message(message):
    message_id = message.attributes["MessageId"]

    if redis.set(f"processed:{message_id}", "1", nx=True, ex=86400):
        # First time seeing this ID — actually do the work
        handle_order_placed(message.body)
    else:
        # Already processed — safe to skip
        pass
```

`SET ... NX` (set-if-not-exists) gives you the same atomic
check-and-record behavior as the unique-constraint pattern above, just in
Redis instead of a relational table.

## What Idempotency Doesn't Solve

- **It doesn't prevent the original failure.** Idempotency makes retries
  *safe*, not successful — if the downstream dependency is actually down,
  retrying an idempotent request still fails every time until it recovers.
- **It doesn't replace the need for backoff.** An idempotency key stops a
  retry storm from duplicating side effects, but the requests still add
  load — pair with the backoff/jitter guidance in
  [circuit-breakers-and-retries.md](circuit-breakers-and-retries.md).
- **It requires client cooperation.** The client must generate the key
  once and reuse it across attempts — if each retry generates a *new*
  key, the server has no way to recognize the duplicate.

---

## Quick Reference

| Operation type                        | Idempotency approach                                     |
| :----------------------------------------- | :-------------------------------------------------------------- |
| "Set to value X" (PUT-style)                | Naturally idempotent — no extra work needed                       |
| "Delete X" (DELETE-style)                   | Naturally idempotent — make deleting an already-gone row a no-op    |
| "Create a resource" (POST-style)             | Unique constraint on a client-generated request ID                  |
| "Perform an action with a result to return" (charge, send) | Idempotency key + stored-response table, atomic insert       |
| Message queue consumer                      | Track processed message IDs (e.g., `SET NX` in Redis)               |

**Bottom line:** any write you might retry needs a way to recognize "I've
already done this" — either because the operation is naturally
idempotent, or because you attach a key the client reuses across retries
and the server checks atomically before acting.
