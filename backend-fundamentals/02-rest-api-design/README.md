# Part 2 — REST & API Design

Part 1 gave you the raw materials: methods, status codes, headers, bodies.
This part is about the shape you build out of them.

An API is a contract. Once another team, a mobile app, or a paying customer
starts calling your endpoints, your URL names and your JSON field names stop
being your private business. They become promises. Changing them breaks
someone else's software, often at the worst time.

Good API design is mostly about making the boring decisions once, writing them
down, and then never surprising anyone. Where do IDs go? What does an error
look like? How does a client ask for page 3? If a new developer can guess the
answer for an endpoint they have never seen, the design is working.

## Files

1. [REST Principles](01-rest-principles.md) — what REST actually is, the five
   constraints that matter, statelessness in practice, and an honest look at
   the Richardson Maturity Model and HATEOAS.
2. [Resource Naming and URLs](02-resource-naming-and-urls.md) — nouns not
   verbs, nesting depth, non-CRUD actions, ID formats, and a full endpoint
   list for the SaaS domain used across this track.
3. [Pagination, Filtering, Sorting](03-pagination-filtering-sorting.md) — why
   an unbounded list is an outage waiting to happen, offset vs cursor
   pagination, safe filters, and allow-listed sort columns.
4. [API Versioning](04-api-versioning.md) — what counts as a breaking change,
   URL vs header vs query versioning, deprecation timelines, and how to avoid
   needing a `/v2` at all.
5. [Error Response Design](05-error-response-design.md) — a stable error body,
   field-level validation errors, RFC 7807, status code mapping, and what must
   never leak out of an error.
6. [REST vs GraphQL vs RPC](06-rest-vs-graphql-vs-rpc.md) — the three styles
   compared honestly, with a decision flowchart and advice for a small team.

## Read in this order

Read 1 → 6, one file per sitting.

Files 2 and 3 are the ones you will use every single week, so do not rush
them. File 4 (versioning) only makes sense after file 2, because versioning is
really about what happens when a URL or a field name has to change. File 6 is
a comparison file — read it last, when you already know what REST costs.

## What you should be able to do after this part

- Explain, in plain words, why your server must not remember what a client did
  on the previous request — and what to do instead.
- Design the full endpoint list for a new feature (paths, methods, purpose)
  before writing any controller code, and defend each choice.
- Choose between offset and cursor pagination for a specific endpoint and say
  exactly why.
- Look at a proposed change to an API and say immediately whether it is
  breaking, and therefore whether it needs a new version.
- Write one error response shape that every endpoint in your API uses, and
  explain which parts clients are allowed to depend on.
- Say out loud when GraphQL would genuinely help you and when it would just
  add work.

## Where this connects

- Status codes, methods, and headers come from Part 1 —
  [HTTP Foundations](../01-http-foundations/).
- The implementation side of errors lives in Part 7 —
  [Error Handling](../07-error-handling/).
- Input validation for the request bodies you design here is Part 4 —
  [Validation & Input Handling](../04-validation-and-input/).
- Database-side pagination cost is in
  [pagination-performance](../../databases/query-optimization/pagination-performance.md).
- If several services sit behind one public API, the routing and auth layer is
  an [api-gateway](../../system-design/foundational/api-gateway.md).

## Next

Part 3 — [Request Lifecycle](../03-request-lifecycle/) follows a single
request through middleware, routing, controller, service, and back out.
