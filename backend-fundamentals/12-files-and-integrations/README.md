# Part 12 — Files & Integrations

Up to now, every request in this track was small, textual, and produced by code
you control. This part is about the two moments where that stops being true.

The first is a **file**. A user hands your server a lump of bytes. It can be
2 KB or 2 GB. It can be a JPEG, or it can be an HTML page full of JavaScript
with `.jpg` glued to the end of its name. You cannot validate it the way you
validate a JSON body, you cannot hold it in memory, and you must never serve it
back carelessly.

The second is **another company's server**. Stripe calls your URL to say an
invoice was paid. You call your customer's URL to say a task was completed. You
call a mail provider to send an email that must arrive in an inbox, not a spam
folder. In all three cases the network is unreliable, the other side retries,
and "it worked on my machine" tells you nothing.

Both halves share one idea: **the bytes and the callers come from outside your
trust boundary, and the network between you and them will fail.** Everything in
this part follows from that.

## Files

1. **File Uploads**
   - [Part 1](01-file-uploads-part-1.md) — what `multipart/form-data` actually
     sends, the three upload architectures, why presigned direct-to-storage is
     the standard answer, and streaming instead of buffering.
   - [Part 2](01-file-uploads-part-2.md) — a serious security checklist for
     untrusted bytes, the `files` table as the source of truth, and resumable
     uploads.
2. [Object Storage and Serving Files](02-object-storage-and-serving-files.md) —
   why the local disk is the wrong home for user files, how buckets and keys
   work, designing a storage key, and the decision that matters most: public
   objects vs presigned downloads vs proxying through your app.
3. **Webhooks** — both sides of the topic. Receiving them safely (raw-body
   signature verification, idempotency, fast 2xx) and sending them to your own
   customers (signing, retries, delivery logs, SSRF protection).
   - [Part 1](03-webhooks-part-1.md) — polling vs webhooks, verifying the
     signature on the raw body, responding fast and working later,
     at-least-once delivery, out-of-order events, and honest status codes.
   - [Part 2](03-webhooks-part-2.md) — designing the event payload, signing and
     secret rotation, delivery infrastructure, endpoint health, logs and replay,
     SSRF, testing, and a polling fallback.
4. **Sending Email and Notifications** — deliverability, SPF/DKIM/DMARC in plain
   words, bounces and suppression lists, never sending inside a transaction,
   header injection, and designing a multi-channel notification system.
   - [Part 1](04-sending-email-and-notifications-part-1.md) — why deliverability
     is not a code problem, transactional vs marketing, SPF/DKIM/DMARC, sending
     identity and warm-up, bounces and suppression lists, never sending inside a
     request or a transaction, and idempotency.
   - [Part 2](04-sending-email-and-notifications-part-2.md) — templates and
     escaping, header injection, testing without emailing real customers,
     choosing a channel, designing a notification system, and tenant domains,
     quotas and tracking.

## Read in this order

Read 1 → 4, one file per sitting.

Files 1 and 2 are a pair and should be read close together: file 1 gets the
bytes in, file 2 gets them back out safely. File 3 is the longest and densest —
give it a full sitting, and read the "receiving" half before the "sending" half
even if you only plan to receive. File 4 depends on file 3, because bounce and
complaint handling arrives as a webhook.

## What you should be able to do after this part

- Draw the presigned-upload flow from memory and explain why your server never
  touching the bytes saves memory, bandwidth, and request time.
- List the reasons a client-supplied filename and `Content-Type` are both
  untrusted, and say what you use instead of each.
- Explain the stored-XSS risk of serving a user-uploaded SVG from your own
  domain, and name three defences.
- Choose between a public object, a presigned URL, and proxying through your
  API for a given file, and justify the choice.
- Write a webhook receiver that verifies a signature on the raw body, responds
  in milliseconds, and processes the same event twice without side effects.
- Explain SPF, DKIM, and DMARC to a teammate, and why sending mail inside a
  database transaction is a bug.

## Where this connects

- **Queues and background jobs are deliberately not taught here.** Uploads,
  webhooks, and email all need them. When they do, this part explains *why* and
  links to
  [message-queues/overview](../../system-design/foundational/message-queues/overview.md)
  (Weeks 9–10 of the roadmap).
- Retry behaviour, backoff, and giving up:
  [circuit-breakers-and-retries](../../system-design/reliability/circuit-breakers-and-retries.md).
- Processing the same event twice safely:
  [idempotency](../../system-design/reliability/idempotency.md).
- Serving files close to users:
  [cdn-and-edge-caching](../../system-design/scale-patterns/cdn-and-edge-caching.md).
- Who may read a file: Part 6, [Authorization](../06-authorization/).
- The attacks these features expose: Part 11, [API Security](../11-api-security/).

## Next

Part 13 — [Testing & Quality](../13-testing-and-quality/) — proving all of this
works without uploading a file by hand and waiting for an email.
