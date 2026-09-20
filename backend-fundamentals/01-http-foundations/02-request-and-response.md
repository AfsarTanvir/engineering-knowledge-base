# Request and Response

An HTTP request is not a magic object your framework hands you. It is a block of
plain text that arrived over a socket. A response is another block of plain text
going the other way.

Once you have seen the raw text, framework objects like `request.body` stop
being mysterious. You will know exactly which bytes they came from, and why they
are sometimes empty.

> **📌 In one line:** every HTTP message is a first line, then headers, then a
> blank line, then an optional body — and that blank line is the only thing
> separating metadata from content.

## Table of Contents

1. [A Letter in an Envelope](#a-letter-in-an-envelope)
2. [The Raw Request](#the-raw-request)
3. [The Raw Response](#the-raw-response)
4. [Where Does the Body End](#where-does-the-body-end)
5. [Content Types](#content-types)
6. [Reading Request Data in Node](#reading-request-data-in-node)
7. [Advanced: Negotiation and Compression](#advanced-negotiation-and-compression)
8. [BROKEN vs FIXED: the Empty Body](#broken-vs-fixed-the-empty-body)
9. [Common Mistakes](#common-mistakes)
10. [Questions to Test Yourself](#questions-to-test-yourself)
11. [Related](#related)

---

## A Letter in an Envelope

Picture posting a paper letter.

- The **envelope** says where it goes and who sent it. That is the request line
  plus the headers.
- The **letter inside** is the actual message. That is the body.
- The post office reads only the envelope. It never opens the letter.

Proxies, caches, and load balancers behave exactly like that post office. They
route on the envelope. This is why the interesting decisions in HTTP — caching,
authentication, content type, routing — all live in headers, not in the body.

```text
┌──────────────────────────────────────────┐
│ POST /api/projects HTTP/1.1              │  ← start line (the address)
├──────────────────────────────────────────┤
│ Host: app.acme.com                       │
│ Content-Type: application/json           │  ← headers (envelope markings)
│ Content-Length: 41                       │
├──────────────────────────────────────────┤
│                                          │  ← ONE blank line. Required.
├──────────────────────────────────────────┤
│ {"name":"Website redesign","teamId":7}   │  ← body (the letter)
└──────────────────────────────────────────┘
```

---

## The Raw Request

Here is a real request, exactly as it travels over the connection. Every line is
labelled.

```text
POST /api/projects HTTP/1.1
Host: app.acme.com
User-Agent: curl/8.4.0
Accept: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
Content-Length: 58

{"name":"Website redesign","companyId":7,"status":"active"}
```

| Line | Name | Meaning |
|---|---|---|
| `POST /api/projects HTTP/1.1` | Request line | Method, path (+ query string), protocol version |
| `Host: app.acme.com` | Header | Which site — one IP can serve many domains |
| `User-Agent: curl/8.4.0` | Header | What software is calling |
| `Accept: application/json` | Header | What format the client wants back |
| `Authorization: Bearer ...` | Header | Who is calling (Part 5) |
| `Content-Type: application/json` | Header | What format the body is in |
| `Content-Length: 58` | Header | How many bytes the body has |
| *(blank)* | Separator | Marks the end of headers |
| `{"name":...}` | Body | The actual data |

Three rules worth memorising:

1. **The request line is one line, with three parts, separated by spaces.** The
   method is always uppercase. The path always starts with `/`.
2. **Headers are `Name: value`, one per line.** Names are case-insensitive.
   `Content-Type` and `content-type` are the same header.
3. **Exactly one blank line separates headers from body.** Not zero, not two.
   A `GET` usually has no body, so the message just ends after the blank line.

> **💡 Tip:** you can see this yourself. Run
> `curl -v https://app.acme.com/api/projects`. Lines starting with `>` are the
> raw request, lines starting with `<` are the raw response.

---

## The Raw Response

The response has the same shape. Only the first line differs.

```text
HTTP/1.1 201 Created
Date: Tue, 04 Mar 2025 09:12:44 GMT
Content-Type: application/json; charset=utf-8
Content-Length: 96
Location: /api/projects/42
X-Request-Id: 7f1c9b2e-5c0a-4a1d-9d31-2b5f0c8a71ee

{"id":42,"name":"Website redesign","companyId":7,"status":"active","createdAt":"2025-03-04"}
```

| Line | Name | Meaning |
|---|---|---|
| `HTTP/1.1 201 Created` | Status line | Version, status code, reason phrase |
| `Date` | Header | When the server produced this |
| `Content-Type` | Header | Format of the body, plus character encoding |
| `Content-Length` | Header | Body size in bytes |
| `Location` | Header | Where the newly created thing lives |
| `X-Request-Id` | Header | Correlation ID for tracing across logs |
| *(blank)* | Separator | End of headers |
| `{"id":42,...}` | Body | The created resource |

The reason phrase (`Created`, `Not Found`) is for humans only. No client should
ever branch on it — only on the number. See [status-codes](04-status-codes.md).

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    C->>S: POST /api/projects (headers + JSON body)
    Note over S: parse headers
    Note over S: read Content-Length bytes as body
    Note over S: validate, insert row
    S-->>C: 201 Created + Location + JSON body
```

---

## Where Does the Body End

TCP gives the server a stream of bytes, not a neatly wrapped message. After
reading the headers, the server must know when to stop reading. There are two
mechanisms.

### 1. `Content-Length`

The sender counts the body's bytes in advance and declares the number.

```text
Content-Type: application/json
Content-Length: 27

{"status":"active","id":42}
```

The server reads exactly 27 bytes and stops. Simple, and it lets the receiver
reject something too large before reading it all.

The limitation: you must know the full size before you send the first byte. That
is impossible when you are streaming a generated report or a live export.

### 2. `Transfer-Encoding: chunked`

The sender does not declare a total. It sends the body in pieces. Each piece
starts with its own size in hexadecimal. A zero-size piece means "finished".

```text
Transfer-Encoding: chunked

1a
{"page":1,"rows":[1,2,3]}
18
{"page":2,"rows":[4,5]}
0

```

Here `1a` is hex for 26 bytes, `18` is 24 bytes, and the final `0` ends the
body. Your framework handles this for you; you will see it when you stream a
file download or a large CSV export.

| | `Content-Length` | `Transfer-Encoding: chunked` |
|---|---|---|
| Size known upfront | Yes, required | No |
| Good for | Normal JSON APIs | Streaming, generated exports, large files |
| Receiver can reject early | Yes, by size | Only while reading |
| HTTP/2 and HTTP/3 | Used | Not used — framing is built into the protocol |

> **⚠️ Warning:** never send both headers. A mismatch between them is the basis
> of "request smuggling" attacks, where a proxy and an app disagree about where
> one request ends and the next begins. Let your framework set these.

---

## Content Types

`Content-Type` tells the receiver how to interpret the bytes in the body. The
same bytes mean nothing without it.

| Content type | Used for | Body looks like |
|---|---|---|
| `application/json` | Nearly all APIs | `{"name":"Website redesign"}` |
| `application/x-www-form-urlencoded` | Plain HTML `<form>` posts | `name=Website+redesign&companyId=7` |
| `multipart/form-data` | Forms with file uploads | Several parts split by a boundary string |
| `text/html` | Server-rendered pages | `<html>...</html>` |
| `text/plain` | Logs, simple text | `ok` |
| `application/octet-stream` | Unknown binary | Raw bytes |

### JSON

```text
Content-Type: application/json

{"name":"Website redesign","companyId":7,"dueDate":"2025-06-01"}
```

Nested objects, arrays, numbers, booleans and `null` all survive. This is why
APIs use it.

### Form-urlencoded

```text
Content-Type: application/x-www-form-urlencoded

name=Website+redesign&companyId=7&dueDate=2025-06-01
```

The same format as a query string, only in the body. Spaces become `+`, special
characters become `%XX`. Everything is a string, and there is no clean way to
express nested data or arrays.

### Multipart

```text
Content-Type: multipart/form-data; boundary=----Boundary7MA4YWxk

------Boundary7MA4YWxk
Content-Disposition: form-data; name="projectId"

42
------Boundary7MA4YWxk
Content-Disposition: form-data; name="attachment"; filename="brief.pdf"
Content-Type: application/pdf

%PDF-1.7 ...binary bytes...
------Boundary7MA4YWxk--
```

Each field is its own mini-message with its own headers. That is what lets one
body carry both a text field and a binary file. The `boundary` string is chosen
by the client and must not appear inside the data.

> **📌 Remember:** JSON for APIs, urlencoded for simple HTML forms, multipart
> only when a file is involved. Multipart has real overhead — do not use it for
> plain JSON data.

---

## Reading Request Data in Node

Data arrives in four different places. Mixing them up is one of the most common
beginner bugs.

| Source | Comes from | Example | Typical use |
|---|---|---|---|
| **Route params** | The path | `/projects/42` → `42` | Identify one resource |
| **Query string** | After `?` | `?status=open&page=2` | Filter, sort, paginate |
| **Body** | After the blank line | `{"name":"..."}` | Create or update data |
| **Headers** | The envelope | `Authorization: Bearer ...` | Auth, content type, tracing |

All four in one AdonisJS handler:

```ts
import type { HttpContext } from '@adonisjs/core/http'

export default class TasksController {
  async update({ params, request, response }: HttpContext) {
    const projectId = params.id                      // from the path
    const notify = request.input('notify') === 'true' // from ?notify=true
    const payload = request.body()                    // from the JSON body
    const requestId = request.header('x-request-id')  // from the headers

    // Query values are strings. Body values are whatever JSON.parse produced.
    return response.ok({ projectId, notify, payload, requestId })
  }
}
```

The Express equivalent is `req.params.id`, `req.query.notify`, `req.body`, and
`req.get('x-request-id')` — same four buckets, different names.

### Why the body is sometimes empty

The raw body is a stream of bytes. Something must read the stream and parse it
according to `Content-Type`. That something is called a **body parser**, and in
Express it is not enabled by default.

```mermaid
flowchart TD
    A[Bytes arrive] --> B{Content-Type?}
    B -->|application/json| C[JSON parser] --> G[req.body is an object]
    B -->|x-www-form-urlencoded| D[urlencoded parser] --> G
    B -->|multipart/form-data| E[multipart parser] --> H[fields + file handles]
    B -->|none matched| F[No parser runs] --> I[req.body is undefined]
```

That last branch is the bug in the next section.

---

## Advanced: Negotiation and Compression

### Content negotiation

Two headers describe format, and people mix them up constantly:

- **`Content-Type`** describes the body **I am sending you right now**. It
  appears on both requests and responses.
- **`Accept`** describes what the sender **wants back**. It appears on requests
  only.

```text
Accept: application/json;q=1.0, text/html;q=0.8, */*;q=0.1
```

The `q` value is a preference weight from 0 to 1. This client prefers JSON,
accepts HTML, and will tolerate anything. A server that cannot produce any
acceptable format should answer `406 Not Acceptable`.

In practice most JSON APIs ignore `Accept` and always return JSON. That is fine
— just be aware that browsers send `Accept: text/html,...` by default, which is
why a browser sometimes gets an HTML error page from a framework while `curl`
gets JSON from the same URL.

### Compression

JSON compresses extremely well — often 70–90% smaller.

```text
Request:   Accept-Encoding: gzip, br
Response:  Content-Encoding: gzip
```

The client advertises what it can decompress. The server picks one, compresses,
and says which it used. If the server ignores the header and sends plain text,
nothing breaks — it is just bigger.

Compress at the reverse proxy, not in your Node process. Compression burns CPU,
and your app's CPU is better spent on requests. See
[nginx reverse-proxy-config](../../cloud-devops/nginx/reverse-proxy-config.md).

> **⚠️ Warning:** do not compress responses that contain secrets on a page that
> also reflects user input. That combination enables the BREACH attack. Modern
> defence: keep authentication tokens out of response bodies you also compress
> alongside attacker-controlled text.

### Sending the wrong content type

The body is just bytes. If the label is wrong, the receiver parses wrongly:

| Actual body | Declared type | Result |
|---|---|---|
| JSON | `x-www-form-urlencoded` | One giant key, no useful fields |
| Form data | `application/json` | `SyntaxError: Unexpected token n` → 400 |
| JSON | *(header missing)* | No parser runs; body is empty |
| Anything | Wrong `charset` | Non-ASCII characters turn into garbage |

---

## BROKEN vs FIXED: the Empty Body

A real bug: the endpoint works in Postman and fails from the HTML form.

```ts
// ❌ BROKEN — no body parser is registered, and the code assumes JSON anyway.
import express from 'express'
const app = express()

app.post('/api/projects', async (req, res) => {
  // req.body is undefined: nothing read the byte stream.
  const name = req.body.name        // TypeError: Cannot read properties of undefined
  const project = await Project.create({ name })
  res.status(201).json(project)
})
```

Two separate faults are hiding here. No parser is registered, so `req.body` is
`undefined`. And even with a JSON parser, an HTML form posts
`x-www-form-urlencoded`, which the JSON parser ignores.

```ts
// ✅ FIXED — register parsers for both types, then validate before use.
import express from 'express'
const app = express()

app.use(express.json({ limit: '1mb' }))              // parses application/json
app.use(express.urlencoded({ extended: true }))      // parses HTML form posts

app.post('/api/projects', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (!name) {
    // 422 = shape was understood, values were not acceptable. See file 04.
    return res.status(422).json({ errors: [{ field: 'name', rule: 'required' }] })
  }
  const project = await Project.create({ name })
  res.status(201).location(`/api/projects/${project.id}`).json(project)
})
```

Note the `limit: '1mb'`. Without a size limit, one client can send a 2 GB body
and exhaust your server's memory. Always cap it.

AdonisJS registers a body parser by default and reads all three common types
from its config file, so you rarely hit this there — but the underlying rule is
identical: something must parse the bytes, and it decides based on
`Content-Type`.

> **📌 Remember:** an empty `req.body` is almost never the client's fault. It is
> a missing parser, or a `Content-Type` the parser you registered does not
> handle.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Reading `req.body` with no parser registered | Nothing consumed the byte stream | Register the parser for each type you accept |
| Sending a JSON body without `Content-Type` | The parser skips it; the body is silently empty | Always set `Content-Type: application/json` |
| No body size limit | One large request can exhaust server memory | Set an explicit limit like `1mb` |
| Using `multipart/form-data` for plain JSON | Much larger and slower to parse, for nothing | Use multipart only when a file is present |
| Expecting numbers from query or form data | Both are text formats; `page=2` is `"2"` | Convert and validate at the edge (Part 4) |
| Branching on the reason phrase (`"Not Found"`) | It is free text and servers vary | Branch on the numeric status code |
| Compressing responses inside the Node process | Wastes CPU that should serve requests | Compress at nginx or the CDN |
| Setting both `Content-Length` and `Transfer-Encoding` | Proxy and app can disagree — request smuggling | Let the framework set framing headers |

---

## Questions to Test Yourself

1. Write out, from memory, the four structural parts of an HTTP request in
   order. What separates the headers from the body, and what happens if it is
   missing?
2. Your endpoint works in Postman but `req.body` is empty from the browser
   form. Give two different causes and how you would tell them apart.
3. What is the difference between `Content-Type` and `Accept`? Which one can
   appear on a response?
4. Why does a streaming CSV export use `Transfer-Encoding: chunked` instead of
   `Content-Length`?
5. You must upload a PDF together with a `projectId` field in one request. Which
   content type do you need, and why can JSON not do this on its own?
6. A client sends form-urlencoded data but labels it `application/json`. What
   status code comes back, and from which layer of your app?
7. Where should gzip compression happen, and what is the argument against doing
   it inside your Node process?
8. Route params, query string, body, headers — for each one, give a realistic
   example from a `PATCH /api/projects/42` call.

---

## Related

- [How the Web Works](01-how-the-web-works.md) — how the connection carrying
  this text gets opened in the first place.
- [HTTP Methods](03-http-methods.md) — the first word of the request line.
- [Status Codes](04-status-codes.md) — the number on the response's first line.
- [Headers](05-headers.md) — a full reference for the envelope.
- [nginx reverse-proxy-config](../../cloud-devops/nginx/reverse-proxy-config.md)
  — where compression and body size limits are usually configured.
- [error-handling](../../typescript-fundamentals/error-handling/error-handling.md)
  — turning a parse failure into a clean response instead of a crash.
