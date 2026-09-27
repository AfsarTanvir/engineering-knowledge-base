# Part 4 — Validation & Input Handling

Your API is a front door that anyone on the internet can knock on. The React
app you wrote is only one of the things that will knock. `curl` will knock.
Postman will knock. A script someone wrote against your API at 2 AM will knock.
A retry from your own mobile app, with a half-filled form, will knock.

None of them are obliged to send you what your frontend sends. So the rule this
part is built on is short: **data from outside your server is untrusted until
your server has checked it** — including data from your own frontend.

This part is about three separate jobs that beginners tend to merge into one
word, "validation":

- **Validation** — reject data that is wrong.
- **Sanitization** — remove parts of data that are dangerous.
- **Normalization** — make valid data consistent before you store it.

Getting these confused is how you end up with two user accounts for the same
person, a `&amp;amp;` in a customer's company name, and a `role: "admin"` field
that a user set themselves.

> **📌 The whole part in one line:** never trust incoming data, describe the
> shape you accept once as a schema, and store it in a form you chose rather
> than the form the caller happened to send.

## Files

1. [Why Validation Matters](01-why-validation-matters.md) — why "the frontend
   already validates it" is not validation, trust boundaries, the mass
   assignment bug (`User.create(req.body)` letting someone make themselves an
   admin), and why the database, the API, and the client each catch different
   things.
2. [Schema Validation](02-schema-validation.md) — describing the shape of a
   request once and reusing it, deriving TypeScript types from the same schema
   so they cannot drift, using the *parsed* output instead of the raw body,
   coercing query strings, cross-field rules, and validating environment
   variables at boot.
3. [Sanitization and Normalization](03-sanitization-and-normalization.md) — the
   three-way distinction above, lowercasing emails before the uniqueness check,
   why escaping belongs at the destination rather than in your database, why
   allow-lists beat deny-lists for rich text, and size limits as a defence
   against denial-of-service.

## Read in this order

Strictly 1 → 3. File 1 is the argument, file 2 is the tool, file 3 is the part
everyone forgets.

```text
01 why (the threat)  →  02 schemas (the tool)  →  03 clean & consistent (the polish)
```

## What you should be able to do after this part

- Explain why validating in the browser protects the user's experience but not
  your data.
- Spot a mass assignment bug in a code review, and fix it with an allow-list.
- Write one schema that both validates at runtime and types the handler at
  compile time.
- Say where a rule belongs: a schema, the service layer, or a database
  constraint — and why "this email is already taken" cannot live in a schema.
- Normalize an email or phone number before checking uniqueness, and explain the
  duplicate-account bug that happens if you do not.
- Name the destination that decides how a value must be escaped.

## Where this connects

- **Turning a validation failure into a good HTTP response** →
  [07-error-handling/](../07-error-handling/)
- **The attacks that unvalidated input enables** →
  [11-api-security/02-injection-attacks-part-1.md](../11-api-security/02-injection-attacks-part-1.md)
- **Constraints as the last line of defence** →
  [databases/data-modeling/](../../databases/data-modeling/)
- **The language-level type story** →
  [typescript-fundamentals/unknown-any/](../../typescript-fundamentals/unknown-any/)
