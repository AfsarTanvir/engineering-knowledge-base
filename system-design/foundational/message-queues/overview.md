# Message Queues vs Pub/Sub: Kafka, RabbitMQ, SQS

Both patterns decouple producers from consumers, but they solve different
problems. A **queue** hands each message to exactly one consumer (work
distribution). **Pub/Sub** broadcasts each message to every subscriber
(event distribution). Picking the wrong one either drops work on the floor
or spams every service with messages it didn't need.

This page covers the concept and how to choose. For implementation detail
on a specific technology, see:

- [Kafka Deep Dive](kafka.md) — log-based, partitions, consumer groups
- [RabbitMQ Deep Dive](rabbitmq.md) — exchanges, routing, acknowledgments
- [SQS Deep Dive](sqs.md) — visibility timeout, FIFO, SNS fanout

## Table of Contents

1. [Queue vs Pub/Sub: The Core Difference](#queue-vs-pubsub-the-core-difference)
2. [The Three Options at a Glance](#the-three-options-at-a-glance)
3. [Delivery Guarantees](#delivery-guarantees)
4. [Choosing One](#choosing-one)
5. [Quick Reference](#quick-reference)

---

## Queue vs Pub/Sub: The Core Difference

**Queue (point-to-point):** one message, one consumer. If 3 workers listen
on the same queue, each message goes to exactly one of them — this is how
you distribute work across a pool.

```
Producer -> [ Queue ] -> Worker A  (message 1)
                       -> Worker B  (message 2)
                       -> Worker C  (message 3)
```

**Pub/Sub (broadcast):** one message, every subscriber. If 3 services
subscribe to the same topic, all 3 receive a copy of every message — this
is how you fan a single event out to multiple independent reactions.

```
Producer -> [ Topic ] -> Email Service   (gets a copy)
                       -> Analytics       (gets a copy)
                       -> Fraud Check     (gets a copy)
```

Neither pattern is "better" — they answer different questions:
*"who should do this piece of work?"* (queue) vs *"who needs to know this
happened?"* (pub/sub).

---

## The Three Options at a Glance

- **[RabbitMQ](rabbitmq.md)** — queue-first broker with flexible routing
  (exchanges). Gets pub/sub via a fanout exchange. Self-hosted, no replay.
- **[Amazon SQS](sqs.md)** — fully-managed queue. Gets pub/sub by pairing
  with SNS. Zero infrastructure to operate, no replay.
- **[Kafka](kafka.md)** — partitioned, append-only log. Naturally supports
  both: same consumer group behaves like a queue, different groups behave
  like pub/sub. Only one of the three that supports replaying old messages.

---

## Delivery Guarantees

| Guarantee            | Meaning                                                     | Who provides it                          |
| :---------------------- | :-------------------------------------------------------------- | :------------------------------------------- |
| At-most-once            | Message might be lost, never duplicated                          | Rare — usually a deliberate fire-and-forget config |
| At-least-once           | Message might be duplicated, never lost                          | RabbitMQ, SQS Standard, Kafka (default)        |
| Exactly-once            | Message processed exactly one time                               | SQS FIFO, Kafka (with idempotent producer + transactional consumer) |

**At-least-once is the practical default** across all of these — which
means your consumer logic should be idempotent (safe to process the same
message twice) rather than relying on the broker to guarantee it never
happens. See duplicate-handling patterns like storing a processed-message
ID with a unique constraint.

---

## Choosing One

- **Distributing discrete units of work** (resize this image, send this
  email) across a worker pool, no replay needed → **RabbitMQ or SQS**
- **Already on AWS, want zero infrastructure to manage** → **SQS**
  (+ **SNS** if multiple independent consumers need the same event)
- **High-volume event stream that multiple services need independently,
  or you need replay/audit history** → **Kafka**
- **Complex routing rules** (route by header, pattern-match routing keys) →
  **RabbitMQ** (topic exchanges)
- **Strict ordering matters and volume is moderate** → **SQS FIFO** or a
  single **Kafka partition**

---

## Quick Reference

| Aspect                     | RabbitMQ                  | SQS                          | Kafka                              |
| :----------------------------- | :----------------------------- | :--------------------------------- | :--------------------------------------- |
| Core model                    | Queue (+ fanout for pub/sub)     | Queue (+ SNS for pub/sub)            | Partitioned log (queue or pub/sub via consumer groups) |
| Message removed after consume  | Yes                              | Yes                                  | No — retained per configured time/size     |
| Replay old messages            | No                                | No                                    | Yes                                        |
| Ordering                       | Per-queue (if single consumer)   | FIFO queues only                     | Per-partition                              |
| Ops overhead                  | Self-hosted broker                | Fully managed                        | Self-hosted or managed (MSK/Confluent), heavier |
| Best fit                      | Task queues, flexible routing     | AWS-native task queues                | Event streaming, multi-consumer, audit/replay |

**Bottom line:** reach for a queue (RabbitMQ/SQS) when you need work
split across a pool of workers exactly once each. Reach for Kafka (or
SNS+SQS) when multiple independent services all need to react to the same
event — and reach for Kafka specifically when you also need replay or
very high throughput.
