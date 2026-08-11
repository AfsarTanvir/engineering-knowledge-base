# Kafka Deep Dive

Kafka is a distributed, partitioned, append-only log. Unlike a traditional
broker, it doesn't delete a message once it's read — consumers track their
own position (offset) in the log, which is the single design choice that
makes replay, multiple independent consumers, and high throughput all
possible at once.

## Table of Contents

1. [Core Architecture](#core-architecture)
2. [Partitions and Ordering](#partitions-and-ordering)
3. [Consumer Groups: Queue vs Pub/Sub Behavior](#consumer-groups-queue-vs-pubsub-behavior)
4. [Producer Acknowledgments](#producer-acknowledgments)
5. [Delivery Semantics](#delivery-semantics)
6. [Retention and Compaction](#retention-and-compaction)
7. [Consumer Lag](#consumer-lag)--
8. [Common Use Cases](#common-use-cases)
9. [Operational Gotchas](#operational-gotchas)
10. [Quick Reference](#quick-reference)

---

## Core Architecture

```
Topic "orders"
  Partition 0  [msg0][msg1][msg2][msg3] -> Leader: Broker 1, Replicas: Broker 2, 3
  Partition 1  [msg0][msg1][msg2]       -> Leader: Broker 2, Replicas: Broker 1, 3
  Partition 2  [msg0][msg1][msg2][msg3][msg4] -> Leader: Broker 3, Replicas: Broker 1, 2
```

- **Topic** — a named stream of messages (e.g., `orders`, `page_views`)
- **Partition** — an ordered, immutable log; a topic is split across N
  partitions for parallelism
- **Broker** — a Kafka server; a cluster has many, each hosting some
  partitions
- **Replication** — each partition has a leader (handles reads/writes) and
  followers (replicas for failover), spread across brokers

## Partitions and Ordering

Kafka guarantees order **within a partition only** — never across an
entire topic. Messages with the same key always land on the same
partition (via a hash of the key), which is how you get ordering for a
specific entity while still parallelizing across everything else:

```python
from kafka import KafkaProducer

producer = KafkaProducer(bootstrap_servers='localhost:9092')

# All messages for order_id=1020 go to the same partition —
# guaranteed to be processed in the order they were sent
producer.send('orders', key=b'1020', value=b'{"status": "placed"}')
producer.send('orders', key=b'1020', value=b'{"status": "shipped"}')
```

More partitions = more parallel consumers = higher throughput, but also
more overhead and weaker per-topic ordering guarantees. Choose partition
count based on target consumer parallelism, not "as many as possible."

## Consumer Groups: Queue vs Pub/Sub Behavior

This is Kafka's key flexibility — the same topic can behave like a queue
or like pub/sub, depending on how consumers are grouped.

**Same `group_id` → queue behavior.** Partitions are divided among the
group's consumers; each message is handled once *by the group*:

```python
from kafka import KafkaConsumer

# Run 3 instances of this with the SAME group_id — Kafka assigns each
# instance a subset of the topic's partitions automatically
consumer = KafkaConsumer(
    'orders',
    group_id='email-service',
    bootstrap_servers='localhost:9092'
)
for message in consumer:
    send_email(message.value)
```

With 6 partitions and 3 consumer instances in `email-service`, each
instance gets ~2 partitions. Add a 4th instance and Kafka rebalances
automatically. Add more consumers than partitions and the extras sit idle
— partition count is the hard ceiling on consumer parallelism within one
group.

**Different `group_id` → pub/sub behavior.** Each group tracks its own
offset independently, so multiple groups can all read the full topic:

```python
# analytics-service has its own group_id — reads every message,
# completely independent of what email-service has consumed
consumer = KafkaConsumer(
    'orders',
    group_id='analytics-service',
    bootstrap_servers='localhost:9092'
)
```

## Producer Acknowledgments

The `acks` setting trades latency for durability:

```python
producer = KafkaProducer(
    bootstrap_servers='localhost:9092',
    acks='all'  # options: 0, 1, 'all'
)
```

| `acks` | Meaning                                              | Risk                                |
| :------- | :------------------------------------------------------ | :--------------------------------------- |
| `0`      | Fire and forget — don't wait for any confirmation          | Message can be lost silently on broker failure |
| `1`      | Wait for the partition leader to write it                   | Lost if leader fails before replicating   |
| `all`    | Wait for all in-sync replicas to write it                    | Slowest, but survives leader failure       |

Use `acks=all` for anything you can't afford to lose (orders, payments);
`acks=1` or `0` for high-volume, loss-tolerant data (metrics, clickstream).

## Delivery Semantics

- **At-least-once (default):** a consumer that crashes after processing
  but before committing its offset will reprocess that message on restart.
  Make handlers idempotent.
- **Exactly-once:** achievable with an idempotent producer
  (`enable.idempotence=true`) plus transactional writes — Kafka dedupes
  retried sends and can commit offset + output atomically. More setup,
  reach for it only when duplicates are genuinely unacceptable (e.g.
  financial transactions).

## Retention and Compaction

Messages stay in a partition until a retention policy removes them —
**not** until they're read:

```properties
# Time-based: keep 7 days regardless of consumption
log.retention.hours=168

# Size-based: keep the last 10GB per partition
log.retention.bytes=10737418240
```

**Compacted topics** keep only the *latest* value per key forever, instead
of expiring by time/size — useful for topics that represent current state
(e.g., "current profile for user X") rather than an event history:

```properties
cleanup.policy=compact
```

## Consumer Lag

Lag = how far behind a consumer group's offset is from the latest message
in the partition. It's the primary health metric for a Kafka consumer —
growing lag means the consumer can't keep up with the producer.

```bash
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --describe --group email-service
```

```
GROUP           TOPIC   PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
email-service   orders  0          10234           10500           266
email-service   orders  1          9800            9800            0
```

Partition 0 lagging while partition 1 is caught up usually means uneven
key distribution or a slow consumer instance — investigate before adding
more partitions blindly.

## Common Use Cases

- Event-driven microservices (multiple services reacting to `order_placed`)
- Activity/clickstream tracking at high volume
- Log/metrics aggregation pipelines
- CDC (Change Data Capture) streams from a database (e.g., via Debezium)
- Audit trails that need replay for reprocessing or debugging

## Operational Gotchas

- **Rebalancing pauses consumption.** Adding/removing a consumer in a
  group triggers a rebalance — all consumers in that group briefly stop
  processing while partitions are reassigned.
- **Partition count is hard to shrink.** You can add partitions to a
  topic later, but reducing them means recreating the topic — decide
  target throughput up front.
- **Big messages hurt.** Kafka is tuned for many small/medium messages,
  not a few huge ones — put large payloads in blob storage and send a
  reference instead.

---

## Quick Reference

| Question                                  | Answer                                                    |
| :-------------------------------------------- | :-------------------------------------------------------------- |
| How do I get queue behavior?                 | Same `group_id` across consumer instances                        |
| How do I get pub/sub behavior?               | Different `group_id` per independent consumer service            |
| How do I guarantee order for one entity?     | Use that entity's ID as the message key                          |
| How do I not lose messages on broker failure? | `acks=all` on the producer                                        |
| How do I replay old events?                  | New consumer group + `auto_offset_reset='earliest'`                |
| How do I know if a consumer is falling behind? | Monitor consumer group lag                                       |

**Bottom line:** Kafka's log-based model means the *consumer group* — not
the topic — decides whether you get queue or pub/sub semantics. Pick
partition count for your target parallelism, `acks` for your durability
needs, and monitor lag as the primary signal that something's wrong.
