# Index Types Deep Dive: B-tree, Hash, GIN, GiST, BRIN

B-tree isn't the only index type — it's just the right default for most
columns. Full-text search, JSON, geometric data, and huge append-only tables
each have a purpose-built index type that a B-tree can't match. Using the
wrong type either silently fails to help or, in MySQL's case, isn't even
available.

## Table of Contents

1. [B-tree (the default)](#b-tree-the-default)
2. [Hash](#hash)
3. [GIN (PostgreSQL)](#gin-postgresql)
4. [GiST (PostgreSQL)](#gist-postgresql)
5. [BRIN (PostgreSQL)](#brin-postgresql)
6. [MySQL-Specific: Full-Text Index](#mysql-specific-full-text-index)
7. [Quick Reference](#quick-reference)

---

## B-tree (the default)

**Available in:** MySQL (InnoDB default), PostgreSQL (default)

Balanced tree structure — great for equality, range (`>`, `<`, `BETWEEN`),
sorting, and prefix matching (`LIKE 'abc%'`). This is what `CREATE INDEX`
gives you unless you say otherwise, and it's correct for the vast majority
of columns: primary keys, foreign keys, dates, status flags, names.

```sql
CREATE INDEX idx_orders_date ON orders (created_at);
```

If you're not sure which type to reach for, this is it. Everything below is
for a specific problem B-tree doesn't solve well.

---

## Hash

**Available in:** MySQL (`MEMORY` engine only — InnoDB doesn't support it),
PostgreSQL (as an explicit index type)

Stores a hash of the value instead of the value itself. Faster than B-tree
for pure equality (`=`) lookups, but **can't do range queries, sorting, or
prefix matching at all** — the hash discards ordering information.

```sql
-- PostgreSQL
CREATE INDEX idx_sessions_token ON sessions USING HASH (session_token);

-- Works: exact match
SELECT * FROM sessions WHERE session_token = 'abc123';

-- Does NOT use the hash index: no ordering to exploit
SELECT * FROM sessions WHERE session_token > 'abc123';
SELECT * FROM sessions ORDER BY session_token;
```

**In practice, reach for B-tree instead almost every time.** B-tree
equality lookups are already fast (O(log n)), and PostgreSQL's hash index
gives up range/sort support for a marginal gain that rarely shows up
outside of benchmarks. MySQL's InnoDB tables can't even create one —
InnoDB only offers B-tree (plus its own internal adaptive hash index that
you don't control directly).

---

## GIN (PostgreSQL)

**Generalized Inverted Index** — built for columns where each row contains
*multiple values to search within*: arrays, JSONB, and full-text search
vectors. Not available in MySQL.

```sql
-- JSONB: find rows where a key/value exists anywhere in the document
CREATE INDEX idx_products_attrs ON products USING GIN (attributes);

SELECT * FROM products
WHERE attributes @> '{"color": "red"}';

-- Array containment
CREATE INDEX idx_posts_tags ON posts USING GIN (tags);

SELECT * FROM posts WHERE tags @> ARRAY['postgresql'];

-- Full-text search
CREATE INDEX idx_articles_search ON articles USING GIN (to_tsvector('english', body));

SELECT * FROM articles
WHERE to_tsvector('english', body) @@ to_tsquery('english', 'database & performance');
```

A B-tree on a JSONB or array column can only match the *entire* value — it
can't look inside it. GIN indexes the individual elements/keys, so
"contains this element" queries become index lookups instead of full scans.

**Trade-off:** GIN indexes are slower to update than B-tree — every insert
touches multiple index entries (one per array element / JSON key / search
term). Fine for read-heavy tables; costly for write-heavy ones.

---

## GiST (PostgreSQL)

**Generalized Search Tree** — built for data where "closest," "overlapping,"
or "contains" matters more than exact equality: geometric data, ranges, and
(with the `pg_trgm` extension) fuzzy text search. Not available in MySQL.

```sql
-- Range overlap (e.g., booking date ranges that shouldn't conflict)
CREATE INDEX idx_bookings_range ON bookings USING GIST (date_range);

SELECT * FROM bookings
WHERE date_range && daterange('2025-06-01', '2025-06-10');

-- Geometric / geographic proximity (PostGIS builds on GiST)
CREATE INDEX idx_locations_geo ON locations USING GIST (coordinates);

SELECT * FROM locations
ORDER BY coordinates <-> ST_MakePoint(-122.4, 37.8)
LIMIT 10;

-- Fuzzy text similarity (needs the pg_trgm extension)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_products_name_trgm ON products USING GIST (name gist_trgm_ops);

SELECT * FROM products WHERE name % 'aple iphone';  -- typo-tolerant match
```

GIN and GiST overlap for full-text and array use cases; the rule of thumb
is GIN is faster to *query* but slower to *update*, GiST is the reverse —
GIN for mostly-static or read-heavy data, GiST when writes are frequent.

---

## BRIN (PostgreSQL)

**Block Range Index** — built for huge tables where the indexed column
correlates with physical row order, most commonly a `created_at` timestamp
on an append-only log or events table. Not available in MySQL.

Instead of indexing every row, BRIN stores a min/max summary per block of
disk pages. It's dramatically smaller than a B-tree (megabytes instead of
gigabytes on a billion-row table) at the cost of coarser precision.

```sql
CREATE INDEX idx_events_created ON events USING BRIN (created_at);

SELECT * FROM events
WHERE created_at BETWEEN '2025-06-01' AND '2025-06-02';
```

**When it works well:** append-only tables where new rows always have a
higher timestamp than old ones — the physical layout naturally correlates
with the indexed value, so each block's min/max range is tight and useful
for skipping irrelevant blocks.

**When it doesn't:** if rows are updated/reordered so the column no longer
correlates with physical position (e.g., `UPDATE`s scattered across the
table), BRIN's block ranges become wide and much less selective. Check
correlation before choosing BRIN:

```sql
SELECT attname, correlation FROM pg_stats
WHERE tablename = 'events' AND attname = 'created_at';
-- correlation near 1.0 or -1.0 -> BRIN works well
-- correlation near 0 -> BRIN won't help much, use B-tree
```

---

## MySQL-Specific: Full-Text Index

MySQL doesn't have GIN/GiST, but InnoDB and MyISAM both support a dedicated
`FULLTEXT` index type for text search — a different mechanism, same
general problem (searching words within a text column) as PostgreSQL's GIN
+ `tsvector` approach:

```sql
CREATE FULLTEXT INDEX idx_articles_body ON articles (body);

SELECT * FROM articles
WHERE MATCH(body) AGAINST('database performance' IN NATURAL LANGUAGE MODE);
```

For JSON columns, MySQL supports **generated column + regular B-tree index**
as its answer to indexing inside a JSON document — there's no equivalent to
GIN's native containment indexing:

```sql
ALTER TABLE products
ADD COLUMN color VARCHAR(50)
GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(attributes, '$.color'))) STORED;

CREATE INDEX idx_products_color ON products (color);

SELECT * FROM products WHERE color = 'red';
```

This only indexes the one JSON path you generated a column for — nowhere
near as flexible as GIN's "search any key," but it's the practical MySQL
equivalent for a known, fixed set of JSON fields you query often.

---

## Quick Reference

| Need                                                | PostgreSQL          | MySQL                                     |
| :------------------------------------------------------ | :---------------------- | :---------------------------------------------- |
| Equality, range, sort (the default case)                | B-tree                    | B-tree (InnoDB default)                          |
| Pure equality only, no range/sort                        | Hash (rarely worth it)    | Not available on InnoDB — use B-tree              |
| JSON key/value or array containment                      | GIN                       | Generated column + B-tree (single known path)     |
| Full-text search                                          | GIN + `tsvector`          | `FULLTEXT` index                                   |
| Range overlap, geometric/geographic, fuzzy text          | GiST                       | Not available                                       |
| Huge append-only table, timestamp-correlated column       | BRIN                       | Not available                                       |

**Bottom line:** default to B-tree. Reach for GIN/GiST/BRIN only once
you've identified a specific access pattern — "contains an element,"
"overlaps a range," "huge and append-only" — that a B-tree genuinely can't
serve well. In MySQL, `FULLTEXT` and generated-column indexing are the
practical substitutes where PostgreSQL would use GIN.
