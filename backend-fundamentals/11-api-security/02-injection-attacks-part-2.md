# Injection Attacks — Part 2

Part 1 was about one destination: the database. It ended with a principle —
structure and data belong on separate channels — and that principle is the only
thing you need to carry into this part.

Everything here is the same bug pointed somewhere else: at a shell, at the file
system, at a browser, at an XML parser, at a log file, at a spreadsheet, and at
JavaScript's own object model. The destinations look unrelated. The fix is
always one of three moves: send the data on its own channel, escape it *for that
specific destination*, or refuse to accept the shapes that cause trouble.

> **⬅️ This continues [Part 1](02-injection-attacks-part-1.md).**

> **📌 In one line:** there is no such thing as "safe input" — only input that
> has been made inert *for the exact place it is going*, which is why escaping
> must happen at the destination and never at the front door.

## Table of Contents

1. [Command Injection](#command-injection)
2. [Path Traversal](#path-traversal)
3. [XSS From the Backend's Side](#xss-from-the-backends-side)
4. [Other Destinations, Other Escaping](#other-destinations-other-escaping)
5. [XML External Entities](#xml-external-entities)
6. [Log Injection](#log-injection)
7. [CSV and Formula Injection](#csv-and-formula-injection)
8. [Prototype Pollution in Node](#prototype-pollution-in-node)
9. [The Summary Table](#the-summary-table)
10. [Common Mistakes](#common-mistakes)
11. [Questions to Test Yourself](#questions-to-test-yourself)
12. [Related](#related)

---

## Command Injection

Sooner or later your API shells out: convert a PDF, resize an image, run
`ffmpeg`, call a CLI that has no library binding. The danger is not running an
external program. It is running it **through a shell**.

```ts
// ❌ BROKEN — exec() starts /bin/sh and hands it a sentence
import { exec } from 'node:child_process'

exec(`pdftoppm -png /var/app/uploads/${file.name} /tmp/out`)
```

A shell is an interpreter, exactly like a SQL parser. Characters such as `;`,
`|`, `&&`, backticks and `$(...)` are not part of a filename to a shell — they
are *separators and substitutions*. A filename containing one of them ends your
command and starts a second one, which runs as your server's user, with your
server's network access and your server's environment variables. That last part
matters: the environment is where your database password lives.

The fix is the same two-channel move as a prepared statement.

```ts
// ✅ FIXED — no shell; the program and its arguments are separate values
import { execFile } from 'node:child_process'

await execFile('pdftoppm', ['-png', absoluteInputPath, '/tmp/out'])
```

`execFile` and `spawn` (without `shell: true`) hand the operating system a
program name and an **array of arguments**. Nothing parses that array looking for
syntax. An argument containing `; rm -rf /` is a filename with a strange name,
passed to `pdftoppm` as one argument, and `pdftoppm` fails to open it. There is
no sentence for anything to re-read.

Three details that catch people out:

| Trap | What happens | Fix |
|---|---|---|
| `spawn(cmd, args, { shell: true })` | The shell is back, array or not | Drop the option |
| An argument that starts with `-` | The *program* reads it as a flag, not a filename | Validate the value; pass `--` before user paths |
| Building the argument array by `.split(' ')` | You reinvented shell parsing, badly | Build the array literally |

> **💡 Tip:** the best fix is usually to not shell out. A library binding takes
> the same input as data. When you must shell out, keep the user's value in a
> single array element and keep the command name a constant you wrote.

---

## Path Traversal

The user sends a filename. Your code turns it into a path. The file system is
the interpreter, and `..` is its syntax.

```ts
// ❌ BROKEN — the user decides where the path ends up
const filePath = path.join('/var/app/uploads', req.params.name)
return response.download(filePath)
```

`path.join` normalises the result, so a `name` of `../../../etc/passwd`
resolves cleanly to a path outside your upload directory. The function did
nothing wrong. It was asked to join, and it joined.

The reason this bug survives so long is that the obvious guard does not work:

```ts
// ❌ STILL BROKEN — three separate holes
if (!filePath.startsWith('/var/app/uploads')) throw new Error('nope')
```

1. If you check the *unresolved* string, `..` has not been collapsed yet, so the
   check passes and the read still escapes.
2. `startsWith` with no trailing separator also accepts
   `/var/app/uploads-public` and `/var/app/uploadsomething`. Same prefix,
   different directory.
3. A symlink inside the upload directory can point anywhere, and a string check
   never follows it.

The correct shape is **resolve first, then verify containment**:

```ts
// ✅ FIXED — resolve, follow symlinks, then check with a separator
import path from 'node:path'
import fs from 'node:fs/promises'

const UPLOAD_ROOT = path.resolve('/var/app/uploads')

async function resolveUploadPath(userSuppliedName: string) {
  const candidate = path.resolve(UPLOAD_ROOT, userSuppliedName)
  const real = await fs.realpath(candidate).catch(() => candidate)

  const rootWithSep = UPLOAD_ROOT + path.sep
  if (real !== UPLOAD_ROOT && !real.startsWith(rootWithSep)) {
    throw new ForbiddenError('Path is outside the upload directory')
  }
  return real
}
```

Order matters: `path.resolve` collapses `..`, `realpath` follows symlinks, and
only then does the prefix comparison mean anything — with `path.sep` appended so
a sibling directory cannot match.

> **📌 Remember:** the strongest version of this fix is to never use user text as
> a path at all. Store uploads under a generated ID, keep the original filename
> in a database column for display, and look up the ID. Then there is no path to
> traverse. See [file uploads](../12-files-and-integrations/01-file-uploads-part-2.md).

---

## XSS From the Backend's Side

**Cross-site scripting** is a browser problem, so it is tempting to file it
under "the frontend's job". That is half true, and the other half is where the
incidents come from.

Your API returns JSON. Somebody renders that JSON in a browser. If a stored
field contains markup and the renderer inserts it as HTML, the browser runs it —
inside your users' session, with their cookies.

**Stored vs reflected.**

| | Stored (persistent) | Reflected |
|---|---|---|
| Where the payload lives | Your database | Only in one response |
| Who is hit | Every user who views the record | Whoever follows a crafted link |
| Typical API source | A `bio`, `notes` or `companyName` field | An error message that echoes the input, a search term repeated back |
| Why it is worse | It fires again on every page view, for everyone | One victim at a time |

**The backend's actual responsibilities** are narrower than people think, but
each one is real:

**1. Do not escape at the front door.** Storing `&lt;b&gt;` instead of `<b>`
feels safe and is a bug: the correct escaping depends on where the value ends up
— HTML text, an HTML attribute, a JavaScript string, a URL, a CSS value — and
you do not know that at write time. Store what the user typed, escape at the
destination. This is the argument made in full in
[sanitization and normalization](../04-validation-and-input/03-sanitization-and-normalization.md).

**2. Always send `Content-Type: application/json`.** This matters more than it
looks. If a response containing user data is served with a missing or wrong
content type, a browser that *navigates* to that URL may parse it as HTML and
execute any script inside it — in your origin, with your cookies. Sending the
correct type, plus `X-Content-Type-Options: nosniff` so the browser does not
guess, closes that path.

**3. Do not return HTML from an API.** The moment an endpoint emits HTML, you
have taken on the escaping obligation for a context you cannot see. The usual
offenders are not templates but error pages and debug output that echo the
request back. An API should answer with JSON, including for errors.

**4. If you must accept rich text, sanitise on an allow-list.** A rich-text
editor really does send HTML. Sanitise it **server-side** with a maintained
library, configured as an allow-list of tags and attributes:

```ts
// ✅ Allow-list: everything not named here is removed, including attributes
const clean = sanitizeHtml(input, {
  allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'code'],
  allowedAttributes: { a: ['href', 'title'] },
  allowedSchemes: ['http', 'https', 'mailto'], // blocks javascript: and data:
})
```

Never write this with regular expressions, and never use a blocklist of tags —
the space of ways to express a script is much larger than the space you will
think of. Sanitise on the way in *and* render with a framework that escapes by
default; the two defences protect against different mistakes.

**5. Add the header layer.** A Content-Security-Policy turns a successful
injection into a blocked script. Not a substitute for the above, but the reason
a bug becomes a non-event: see
[security headers — Part 1](04-security-headers-part-1.md).

---

## Other Destinations, Other Escaping

Same principle, five more interpreters. The middle column is the thing to
memorise: escaping is defined by the destination, so "already escaped" is never
a complete sentence.

| Destination | What the input can become | Defence |
|---|---|---|
| LDAP filter | Filter syntax — `*`, `(`, `)`, `\`, `NUL` — widening a search | Escape per RFC 4515 with the library's own function; prefer parameterised bind APIs |
| XML parser | An external entity that reads local files or calls out | Disable DTDs and external entities on the parser |
| Template engine | An expression the engine evaluates on the server | Never build the template from input; only pass input as template *variables* |
| Log file | A forged log line, or terminal escape codes in a viewer | Structured logging, so values are fields not text |
| CSV export | A formula the spreadsheet runs on open | Escape leading formula characters, or export XLSX |
| Redirect URL | A jump to an attacker's site from your domain | Allow-list target paths; never redirect to a raw input URL |
| Email header | Extra headers, e.g. a second recipient, via a newline | Reject `\r` and `\n` in any value that becomes a header |

---

## XML External Entities

If you accept XML — SAML, an old partner integration, an RSS import — the parser
itself is the risk, before your code sees anything.

XML has a feature called an **external entity**: a document can define a
placeholder whose value is loaded from a URL or a local file path, and the
parser will helpfully fetch it. A document that defines an entity pointing at a
local file, then uses it inside an element, makes the parser read that file and
place the contents into the parsed result — which your application may then
store or echo back. The same feature pointed at an internal URL turns your
parser into an SSRF client.

The fix is configuration, not validation:

```ts
// ✅ FIXED — no DTD, no entity resolution, no network from the parser
const parser = new XMLParser({
  processEntities: false,
  // in Java/libxml-style parsers, the equivalents are:
  //   disallow-doctype-decl = true
  //   external-general-entities = false
  //   external-parameter-entities = false
})
```

Also cap the document size and nesting depth: entity expansion can be used to
blow up memory even with no file access at all.

> **⚠️ Warning:** check the default for the exact parser and version you use.
> Many libraries fixed their defaults years ago and many did not, and "it is
> probably safe now" is not a review note.

---

## Log Injection

Logs are read by humans, by `grep`, and by alerting systems. A log line is a
message in a format — and user input concatenated into that format can forge a
line that never happened.

```ts
// ❌ BROKEN — the message is built from input
logger.info(`Login failed for ${email}`)
```

An `email` containing a newline plus text shaped like your log format adds a
second, fake entry. On a bad day, that entry says a different user succeeded,
and it is now in the record that an investigation reads. Input containing
terminal escape sequences can also mangle a colleague's terminal when they `cat`
the file.

```ts
// ✅ FIXED — the value is a field, so the format cannot be forged
logger.info({ event: 'login_failed', email }, 'Login failed')
```

Structured logging fixes this for the same reason parameters fix SQL: the value
travels in its own slot and is serialised as a value. A newline inside a JSON
string is `\n`, not a new line. Detail in
[structured logging](../08-logging-and-observability/02-structured-logging.md).

---

## CSV and Formula Injection

Your API exports tasks to CSV. A user opens it in Excel. A cell that begins with
`=`, `+`, `-` or `@` is not text to a spreadsheet — it is a formula, and the
spreadsheet evaluates it on open.

The person harmed is your own user, on their own machine, using data your system
handed them. That is why this one gets forgotten: no server is touched.

```ts
// ✅ FIXED — neutralise the leading character, keep the value readable
function csvCell(value: string) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}
```

The leading apostrophe tells the spreadsheet "this is text". Wrapping in quotes
alone does **not** help — a quoted cell is still parsed as a formula. The
cleanest answer for a product feature is to export a real `.xlsx` with typed
cells, where a string cell is unambiguously a string.

---

## Prototype Pollution in Node

This one has no other language's equivalent, and it is worth the five minutes.

Every JavaScript object inherits from a prototype. Plain objects inherit from
`Object.prototype`. If something writes a property onto `Object.prototype`,
**every object in the process** appears to have that property — including
objects created before the write, and objects inside libraries you did not
write.

The usual way in is a recursive merge of untrusted JSON: config merging, "deep
assign" helpers, query-string parsers, and older versions of popular utility
libraries.

```ts
// ❌ BROKEN — a deep merge that trusts its source
function merge(target: any, source: any) {
  for (const key of Object.keys(source)) {
    if (typeof source[key] === 'object' && source[key] !== null) {
      merge((target[key] ??= {}), source[key])
    } else {
      target[key] = source[key] // assignment walks the prototype chain
    }
  }
  return target
}

merge(options, JSON.parse(rawBody))
```

Send a body whose top-level key is `__proto__` with an object value, and the
recursion reaches `target.__proto__` — which is not a normal property but an
accessor onto the prototype. The merge then writes fields onto
`Object.prototype`. From that moment, code elsewhere that checks
`if (obj.isAdmin)` or `if (!options.safeMode)` on a fresh object gets an answer
it never set.

The defences, cheapest first:

```ts
// ✅ 1. Refuse the dangerous keys in any merge or assignment helper
const BLOCKED = new Set(['__proto__', 'constructor', 'prototype'])
if (BLOCKED.has(key)) continue

// ✅ 2. Use prototype-less objects for anything keyed by user input
const counters = Object.create(null)   // no prototype chain at all
const byId = new Map()                 // even better: Map does not use keys as properties

// ✅ 3. Validate with a schema that strips unknown keys — the real fix
const body = ConfigSchema.parse(rawBody) // only the fields you declared survive

// ✅ 4. Belt and braces at boot, if your dependencies allow it
Object.freeze(Object.prototype)
```

A useful detail: `JSON.parse` on its own is safe. It creates an ordinary own
property called `__proto__` rather than invoking the setter. The pollution
happens in the code that *copies* that parsed object with plain assignment. So
the audit question is not "do we parse JSON" — it is "where do we deep-merge or
deep-assign something we received".

Background on how the chain actually works:
[prototypes](../../typescript-fundamentals/prototypes/prototypes.md).

---

## The Summary Table

One table for both parts. If you remember nothing else, remember the third
column.

| Injection type | Where the untrusted data lands | The defence |
|---|---|---|
| SQL | The database's SQL parser | Parameterised queries; allow-list for identifiers |
| NoSQL | A query object's operator slots | Validate types; reject objects where strings are expected |
| Command | `/bin/sh` | `execFile`/`spawn` with an argument array, no shell |
| Path traversal | The file system | Resolve, `realpath`, then verify containment with a separator |
| Stored XSS | A browser rendering your JSON | Escape at render; sanitise rich text on an allow-list; CSP |
| Reflected XSS | A browser navigating to your response | Correct `Content-Type`, `nosniff`, never return HTML |
| LDAP | The directory's filter parser | The library's escaping function; parameterised bind |
| XXE | The XML parser, before your code runs | Disable DTDs and external entities; cap size and depth |
| Template | The template engine, server-side | Input is a variable, never part of the template |
| Log | Your log file and its readers | Structured logging with fields |
| CSV formula | The user's spreadsheet | Prefix formula characters, or export XLSX |
| Open redirect | The browser's navigation | Allow-list of target paths |
| Prototype pollution | `Object.prototype`, process-wide | Block `__proto__`; schema-validate; `Object.create(null)` |

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| `exec()` with a template literal | It starts a shell and hands it a sentence | `execFile` with an argument array |
| `spawn(..., { shell: true })` | Undoes the array protection entirely | Remove the option |
| `path.join(root, userInput)` with no check | `..` is collapsed into a path outside the root | Resolve, `realpath`, verify with `path.sep` |
| `filePath.startsWith(root)` | Matches `uploads-public` too, and ignores symlinks | Append the separator and check the resolved path |
| HTML-escaping on the way into the database | Wrong escaping for most destinations, double-escaped output | Store raw; escape at the destination |
| Returning HTML error pages from a JSON API | Reflected XSS from an echoed request value | JSON errors, always |
| No `Content-Type` on a response with user data | The browser may sniff it as HTML and run it | `application/json` plus `nosniff` |
| A regex to strip `<script>` | The set of ways to write a script is unbounded | A maintained sanitiser, allow-list configured |
| `logger.info(\`user ${name} did X\`)` | Input can forge a whole log line | Structured fields |
| CSV export straight from the database | Formula characters execute in the user's spreadsheet | Prefix or export XLSX |
| Deep-merging a request body into config | `__proto__` reaches every object in the process | Block the key and validate with a schema |
| "We validated it already" | Validation and escaping answer different questions | Validate shape at entry, escape per destination |

---

## Questions to Test Yourself

1. Explain why `execFile('convert', [userPath])` is safe while
   `exec('convert ' + userPath)` is not. Name the component that differs.
2. Even with an argument array, a value starting with `-` can cause trouble.
   What is happening, and what is the fix?
3. Give three separate reasons `filePath.startsWith(UPLOAD_DIR)` is not a valid
   containment check.
4. What is the correct order of `resolve`, `realpath` and the prefix check, and
   why does the order matter?
5. Why is HTML-escaping user input before storing it a bug rather than a
   precaution? Give a destination where the stored value is now wrong.
6. Your API returns JSON containing a user's bio. Describe the path by which a
   missing `Content-Type` header turns that into executed script.
7. Stored and reflected XSS differ in more than persistence. Which one would you
   fix first in a multi-tenant SaaS, and why?
8. Your XML parser has never been configured. Name two things an uploaded XML
   document could do, and the one-line class of fix.
9. Why does structured logging solve log injection, and what does it have in
   common with a prepared statement?
10. `JSON.parse` is safe, yet prototype pollution arrives as JSON. Explain
    precisely where the pollution happens.
11. Name the three property keys any merge helper should refuse, and one reason
    `Object.create(null)` is a better map than `{}`.
12. A CSV export harms a user without any server being touched. Explain the
    mechanism and the one-character fix.

---

## Related

- [Injection Attacks — Part 1](02-injection-attacks-part-1.md) — the one idea,
  SQL injection, parameterisation, ORM escape hatches, least privilege, and
  NoSQL injection.
- [Sanitization and Normalization](../04-validation-and-input/03-sanitization-and-normalization.md)
  — escaping at the destination, and allow-list rich text, in depth.
- [Schema Validation](../04-validation-and-input/02-schema-validation.md) — the
  strip-unknown-keys behaviour that defuses prototype pollution.
- [File Uploads](../12-files-and-integrations/01-file-uploads-part-2.md) — storing
  uploads under generated IDs so no path is ever built from input.
- [Security Headers — Part 1](04-security-headers-part-1.md) — CSP and `nosniff`,
  the layer that turns a successful injection into a blocked one.
- [Structured Logging](../08-logging-and-observability/02-structured-logging.md)
  — fields instead of formatted strings.
- [Prototypes](../../typescript-fundamentals/prototypes/prototypes.md) — why a
  write to `Object.prototype` is visible everywhere.
- [OWASP Top 10 for APIs](01-owasp-top-10-for-apis.md) — SSRF and the wider list
  that these attacks feed into.
