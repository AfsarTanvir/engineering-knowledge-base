# Amazon SQS Deep Dive

SQS is a fully-managed queue — no broker to provision, patch, or scale.
It gives you the same one-message-one-consumer model as RabbitMQ, but the
operational model is entirely different: you call an API, AWS handles
durability, scaling, and availability behind it.

## Table of Contents

1. [Standard vs FIFO Queues](#standard-vs-fifo-queues)
2. [Visibility Timeout](#visibility-timeout)
3. [Long Polling](#long-polling)
4. [Dead-Letter Queues](#dead-letter-queues)
5. [Batching](#batching)
6. [Message Attributes](#message-attributes)
7. [SNS + SQS: Fanout Pattern](#sns--sqs-fanout-pattern)
8. [Common Use Cases](#common-use-cases)
9. [Operational Gotchas](#operational-gotchas)
10. [Quick Reference](#quick-reference)

---

## Standard vs FIFO Queues

**Standard queue** — near-unlimited throughput, at-least-once delivery,
best-effort ordering (messages can occasionally arrive out of order or be
delivered more than once):

```python
import boto3
sqs = boto3.client('sqs')

sqs.send_message(
    QueueUrl='https://sqs.us-east-1.amazonaws.com/123456789/send-email',
    MessageBody='{"to": "user@example.com", "template": "welcome"}'
)
```

**FIFO queue** (`.fifo` suffix required) — strict ordering and
exactly-once processing *within a message group*, at the cost of capped
throughput (300 msg/sec by default, up to 3000/sec with batching):

```python
sqs.send_message(
    QueueUrl='https://sqs.us-east-1.amazonaws.com/123456789/orders.fifo',
    MessageBody='{"order_id": 1020, "status": "placed"}',
    MessageGroupId='order-1020',           # ordering guaranteed within this group
    MessageDeduplicationId='order-1020-placed'  # dedupes retries within a 5-min window
)
```

Messages with the same `MessageGroupId` are strictly ordered and
processed by only one consumer at a time; different group IDs process in
parallel — this is FIFO's version of Kafka's partition key.

**Default to Standard** unless a specific requirement (financial
transactions, sequential state machine updates) genuinely needs strict
ordering — FIFO's throughput ceiling is a real constraint at scale.

## Visibility Timeout

SQS's retry mechanism: when a consumer receives a message, it becomes
invisible to other consumers for the visibility timeout window — not
deleted. If the consumer doesn't explicitly delete it before the timeout
expires (because it crashed, hung, or failed), the message reappears for
another consumer to try:

```python
response = sqs.receive_message(
    QueueUrl=queue_url,
    MaxNumberOfMessages=10,
    VisibilityTimeout=30  # seconds
)

for msg in response.get('Messages', []):
    process(msg['Body'])  # if this raises/crashes, the message is NOT deleted
    sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=msg['ReceiptHandle'])
```

Set the timeout longer than your worst-case processing time — a timeout
too short causes duplicate processing (message reappears while still
being worked on); too long delays retry of a genuinely failed message.
For unpredictable processing times, extend it mid-flight:

```python
sqs.change_message_visibility(
    QueueUrl=queue_url,
    ReceiptHandle=msg['ReceiptHandle'],
    VisibilityTimeout=120  # "I need more time"
)
```

## Long Polling

Without long polling, `receive_message` returns immediately even if the
queue is empty, forcing consumers to poll constantly (wasting API calls
and money). Long polling waits up to 20 seconds for a message to arrive
before returning empty:

```python
response = sqs.receive_message(
    QueueUrl=queue_url,
    MaxNumberOfMessages=10,
    WaitTimeSeconds=20  # long polling — always set this
)
```

There's essentially no downside to `WaitTimeSeconds=20` — it reduces API
calls (and cost) without adding meaningful latency, since the call
returns immediately once a message is available.

## Dead-Letter Queues

After a message is received (and not deleted) more times than
`maxReceiveCount`, SQS automatically routes it to a configured
dead-letter queue (DLQ) instead of retrying forever:

```python
import json

redrive_policy = {
    'deadLetterTargetArn': 'arn:aws:sqs:us-east-1:123456789:send-email-dlq',
    'maxReceiveCount': '5'
}

sqs.set_queue_attributes(
    QueueUrl=queue_url,
    Attributes={'RedrivePolicy': json.dumps(redrive_policy)}
)
```

Monitor the DLQ's depth as an alert signal — a growing DLQ means a
class of message is consistently failing and needs investigation, not
just more retries.

## Batching

Sending or receiving one message per API call at high volume adds up in
both latency and cost. Batch operations handle up to 10 messages per call:

```python
sqs.send_message_batch(
    QueueUrl=queue_url,
    Entries=[
        {'Id': '1', 'MessageBody': '{"order_id": 1}'},
        {'Id': '2', 'MessageBody': '{"order_id": 2}'},
        # up to 10 entries
    ]
)
```

`receive_message` with `MaxNumberOfMessages=10` (shown earlier) is
already the batched form for reads.

## Message Attributes

Structured metadata alongside the body — useful for routing/filtering
logic without parsing the body itself:

```python
sqs.send_message(
    QueueUrl=queue_url,
    MessageBody='{"order_id": 1020}',
    MessageAttributes={
        'Priority': {'DataType': 'String', 'StringValue': 'high'},
        'RetryCount': {'DataType': 'Number', 'StringValue': '0'}
    }
)
```

## SNS + SQS: Fanout Pattern

SQS alone is point-to-point — only one consumer group gets each message.
To broadcast one event to multiple independent subscribers, pair it with
an SNS topic: SNS publishes once, and delivers a copy to every SQS queue
subscribed to it.

```python
sns = boto3.client('sns')

# Publish once...
sns.publish(
    TopicArn='arn:aws:sns:us-east-1:123456789:order_placed',
    Message=json.dumps({'order_id': 1020, 'total': 49.99})
)

# ...and email-queue, fraud-queue, analytics-queue (each subscribed
# to this topic) all receive their own independent copy, each with its
# own visibility timeout, retries, and DLQ.
```

This gives you pub/sub delivery semantics with per-subscriber queue
reliability — one slow or broken subscriber's queue backing up doesn't
affect the others.

## Common Use Cases

- Decoupling a web request from slow background work (image processing,
  report generation) without operating broker infrastructure
- Buffering between Lambda functions or microservices on AWS
- Fanning a single event out to multiple AWS-native consumers via
  SNS + SQS
- Smoothing traffic spikes — the queue absorbs bursts a downstream
  service couldn't handle synchronously

## Operational Gotchas

- **Standard queues can deliver duplicates.** Design consumers to be
  idempotent (e.g., dedupe on a message/order ID) rather than assuming
  each message arrives exactly once.
- **FIFO throughput ceiling is real.** 300-3000 msg/sec isn't a
  theoretical limit — high-volume ordered workloads can hit it. Consider
  whether ordering is truly required at the whole-queue level or just
  within a smaller group.
- **Empty receives still cost money without long polling.** Always set
  `WaitTimeSeconds`.
- **A message deleted too early is gone.** If processing can fail
  partway through, delete only after work is fully committed downstream,
  not before starting it.

---

## Quick Reference

| Question                                    | Answer                                                      |
| :----------------------------------------------- | :----------------------------------------------------------------- |
| Need strict ordering + exactly-once?             | FIFO queue with `MessageGroupId` + `MessageDeduplicationId`         |
| Need max throughput, order doesn't matter?       | Standard queue                                                       |
| Worker crashed mid-processing?                   | Message reappears automatically after `VisibilityTimeout` expires    |
| Reduce polling cost/latency?                     | `WaitTimeSeconds=20` (long polling)                                   |
| Stop retrying a permanently-failing message?     | Dead-letter queue + `maxReceiveCount`                                 |
| Need to broadcast one event to many services?    | SNS topic fanning out to multiple SQS queues                          |

**Bottom line:** SQS trades RabbitMQ/Kafka's flexibility for zero
operational overhead. Default to a Standard queue with long polling and a
DLQ; reach for FIFO only when ordering is a hard requirement, and pair
with SNS the moment more than one service needs to react to the same
event.
