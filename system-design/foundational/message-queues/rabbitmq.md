# RabbitMQ Deep Dive

RabbitMQ is a traditional message broker built around **queues** and
**exchanges**. Producers never send directly to a queue — they publish to
an exchange, which routes the message to zero, one, or many queues based
on rules you define. That routing layer is what makes RabbitMQ flexible
enough to do both simple task queues and pub/sub-style fanout.

## Table of Contents

1. [Core Architecture](#core-architecture)
2. [Exchange Types](#exchange-types)
3. [Acknowledgments and Redelivery](#acknowledgments-and-redelivery)
4. [Prefetch: Controlling Worker Load](#prefetch-controlling-worker-load)
5. [Dead-Letter Exchanges](#dead-letter-exchanges)
6. [Durability: Surviving a Restart](#durability-surviving-a-restart)
7. [Clustering and Quorum Queues](#clustering-and-quorum-queues)
8. [Common Use Cases](#common-use-cases)
9. [Operational Gotchas](#operational-gotchas)
10. [Quick Reference](#quick-reference)

---

## Core Architecture

```
Producer -> [ Exchange ] --(binding: routing rule)--> [ Queue A ] -> Consumer 1
                         --(binding: routing rule)--> [ Queue B ] -> Consumer 2
```

- **Exchange** — receives published messages and routes them; has a type
  that determines the routing logic (direct, topic, fanout, headers)
- **Queue** — durable buffer that holds messages until a consumer acks them
- **Binding** — the rule connecting an exchange to a queue (e.g., "route
  messages with routing key `orders.us` to this queue")
- **Routing key** — a string attached to a message that bindings match
  against

## Exchange Types

**Direct** — routes to queues whose binding key exactly matches the
message's routing key. The simplest case, effectively a named queue:

```python
channel.exchange_declare(exchange='direct_logs', exchange_type='direct')
channel.queue_bind(exchange='direct_logs', queue='error_queue', routing_key='error')

channel.basic_publish(exchange='direct_logs', routing_key='error', body='Disk full')
# Only queues bound with routing_key='error' receive this
```

**Topic** — routes by pattern match on the routing key using `*` (one
word) and `#` (zero or more words):

```python
channel.exchange_declare(exchange='orders_topic', exchange_type='topic')

# Binds catch different slices of the same event stream
channel.queue_bind(exchange='orders_topic', queue='us_orders', routing_key='orders.us.*')
channel.queue_bind(exchange='orders_topic', queue='all_orders', routing_key='orders.#')

channel.basic_publish(exchange='orders_topic', routing_key='orders.us.placed', body='...')
# us_orders AND all_orders both receive this; a queue bound to 'orders.eu.*' would not
```

**Fanout** — ignores the routing key entirely and broadcasts to every
bound queue. This is RabbitMQ's pub/sub:

```python
channel.exchange_declare(exchange='order_events', exchange_type='fanout')
channel.queue_bind(exchange='order_events', queue='email_queue')
channel.queue_bind(exchange='order_events', queue='analytics_queue')
channel.queue_bind(exchange='order_events', queue='fraud_queue')

channel.basic_publish(exchange='order_events', routing_key='', body='order_placed:1020')
# All three queues get their own copy
```

**Headers** — routes based on message header key/value matches instead of
the routing key; used less often, mainly for complex multi-attribute
routing rules.

## Acknowledgments and Redelivery

A consumer must explicitly acknowledge a message, or RabbitMQ assumes it
wasn't processed and redelivers it (to the same or another consumer):

```python
def callback(ch, method, properties, body):
    try:
        process(body)
        ch.basic_ack(delivery_tag=method.delivery_tag)
    except Exception:
        # requeue=True puts it back for another attempt;
        # requeue=False sends it to a dead-letter exchange if configured
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

channel.basic_consume(queue='send_email', on_message_callback=callback)
```

**`auto_ack=True`** (acking immediately on delivery, before processing)
trades safety for simplicity — a crash mid-processing loses the message
silently. Prefer explicit acks for anything that matters.

## Prefetch: Controlling Worker Load

By default RabbitMQ pushes messages to a consumer as fast as the network
allows, which can overwhelm a slow worker. `prefetch_count` caps how many
unacknowledged messages a consumer can hold at once:

```python
channel.basic_qos(prefetch_count=1)
```

`prefetch_count=1` means: don't send this consumer a new message until it
acks the current one — the simplest way to spread work evenly across a
pool of workers with uneven processing times.

## Dead-Letter Exchanges

Messages that are rejected, expire (TTL), or exceed a max retry count can
be automatically routed to a separate exchange instead of being dropped —
your safety net for "this message keeps failing, stop retrying it forever":

```python
channel.queue_declare(
    queue='send_email',
    durable=True,
    arguments={
        'x-dead-letter-exchange': 'dlx',
        'x-dead-letter-routing-key': 'send_email.failed',
        'x-message-ttl': 60000  # also dead-letters if unconsumed after 60s
    }
)
```

Consume from the dead-letter queue separately (alerting, manual review,
or a limited number of automated retries) instead of losing failed
messages silently.

## Durability: Surviving a Restart

Three separate switches all need to be on for a message to survive a
broker restart — missing any one of them means "durable" isn't actually
durable:

```python
channel.queue_declare(queue='send_email', durable=True)   # 1. queue survives restart

channel.basic_publish(
    exchange='',
    routing_key='send_email',
    body='...',
    properties=pika.BasicProperties(delivery_mode=2)        # 2. message persisted to disk
)
# 3. the exchange itself also needs durable=True if you declared one explicitly
```

## Clustering and Quorum Queues

A single RabbitMQ node is a single point of failure. **Quorum queues**
(replacing the older "mirrored queues") replicate a queue's data across
multiple cluster nodes using a Raft-based consensus protocol, so a node
failure doesn't lose in-flight messages:

```python
channel.queue_declare(
    queue='send_email',
    durable=True,
    arguments={'x-queue-type': 'quorum'}
)
```

Use quorum queues for anything where losing the queue's messages on a
node failure is unacceptable; classic queues are lighter-weight and fine
for less critical, higher-churn queues.

## Common Use Cases

- Background job processing (image resizing, PDF generation, sending email)
- Request/reply patterns via RPC-style queues
- Complex routing between services (topic exchanges matching on region,
  tenant, or event subtype)
- Task queues needing fine-grained retry/dead-letter control

## Operational Gotchas

- **Unbounded queues eat memory.** A queue with no consumer just grows —
  set `x-max-length` or monitor queue depth alerts before it becomes an
  outage.
- **`auto_ack=True` looks fine until a worker crashes.** Silent message
  loss under load is the most common RabbitMQ production surprise.
- **No native replay.** Once a message is acked and removed, it's gone —
  unlike Kafka, there's no "rewind and reprocess" without your own
  separate audit log.

---

## Quick Reference

| Question                                 | Answer                                                |
| :-------------------------------------------- | :---------------------------------------------------------- |
| How do I distribute work across workers?     | Direct exchange (or default) + multiple consumers, `prefetch_count=1` |
| How do I broadcast to multiple services?     | Fanout exchange                                              |
| How do I route by pattern (e.g., region)?    | Topic exchange with wildcard bindings                         |
| How do I stop retrying a poison message?     | Dead-letter exchange + max retry count                        |
| How do I survive a broker restart?           | `durable=True` on queue + `delivery_mode=2` on message         |
| How do I survive a node failure in a cluster? | Quorum queues                                                 |

**Bottom line:** RabbitMQ's exchange types are the whole story — direct
for simple task queues, topic for pattern-based routing, fanout for
broadcast. Explicit acks + prefetch control keep work evenly and safely
distributed; dead-letter exchanges keep a bad message from looping forever.
