# Part 6 — Authorization

Part 5 got the caller through the front door: you now know *who* they are. This
part decides *what they are allowed to do once inside* — and it is where the
most damaging API bugs live.

Not dramatic bugs. Quiet ones. A logged-in user changes `/invoices/4182` to
`/invoices/4183` in the address bar and reads another company's invoice. Nothing
crashed. No alert fired. The request was perfectly authenticated — it just was
not authorized. This single mistake, checking *who you are* but never *whether
this record is yours*, is consistently the most common serious vulnerability
found in real APIs.

The other half of this part is the version of the same problem that scales: when
one application serves many customer organisations, every single query needs to
be scoped to the right tenant, and forgetting the scope once leaks another
customer's data.

> **📌 The whole part in one line:** authentication proves who is asking;
> authorization must be re-checked against the specific record being touched,
> on every route, including the ones that only read.

## Files

1. [Authentication vs Authorization](01-authn-vs-authz.md) — the distinction in
   plain words, 401 vs 403, where the check belongs, fail-closed defaults, and
   the broken-object-level-authorization bug in full, including why filtering in
   the query is safer than checking after you fetch.
2. [Role-Based Access Control](02-rbac.md) — users, roles and permissions, why
   you should check a permission rather than a role name, the schema for it,
   loading permissions without three queries per request, and scoped roles for a
   user who is an admin of one company and a viewer of another.
3. Ownership, ABAC, and Multi-Tenancy —
   [Part 1](03-ownership-abac-and-multi-tenancy-part-1.md): where roles stop
   being enough, attribute-based rules, and the policy-object pattern. ·
   [Part 2](03-ownership-abac-and-multi-tenancy-part-2.md): the three tenant
   isolation models, defence in depth from the repository layer down to
   PostgreSQL row-level security, and the tenant-leak test you should write for
   every resource.

## Read in this order

Strictly 1 → 3. File 1 defines the problem, file 2 handles the common case, file
3 handles everything the common case cannot express.

```text
01 who vs what        →  02 roles & permissions  →  03 ownership & tenants
   (the IDOR bug)         (the 80% case)             (the rules roles can't express)
```

## What you should be able to do after this part

- Explain why an authenticated request can still be a security hole, and
  demonstrate the bug with a URL change.
- Choose 401 or 403 correctly, and say when hiding a record behind a 404 is the
  better answer.
- Design a permissions schema that lets you add a role without changing code.
- Write an authorization check that lives in one place and cannot be forgotten
  on a new route.
- Pick a multi-tenancy isolation model and defend the choice on cost, blast
  radius, and operational burden.
- Write the test that proves tenant A cannot reach tenant B's record.

## Where this connects

- **Proving identity in the first place** → [05-authentication/](../05-authentication/)
- **Enforcing the tenant scope where it cannot be skipped** →
  [09-application-architecture/03-repository-layer-part-1.md](../09-application-architecture/03-repository-layer-part-1.md)
- **Making cross-tenant references impossible in the schema itself** —
  composite tenant foreign keys →
  [databases/data-modeling/](../../databases/data-modeling/)
- **The wider catalogue of API risks** →
  [11-api-security/01-owasp-top-10-for-apis.md](../11-api-security/01-owasp-top-10-for-apis.md)
