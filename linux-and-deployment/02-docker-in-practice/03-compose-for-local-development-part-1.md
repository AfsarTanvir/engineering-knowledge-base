# Compose for Local Development — Part 1

Your API needs PostgreSQL. It needs Redis for caching. It needs a second Redis
for the job queue. It needs a worker process.

That is five things to start every morning, in roughly the right order, with
matching credentials.

The traditional answer is a page in the README: "install Postgres 16, install
Redis, create a database called `invoicing`, run the migrations". Six months
later one developer is on Postgres 14 and another has Redis 6 with a different
eviction default. Then a bug appears that reproduces on one laptop only, and it
costs the team two days.

Compose is the stage directions for a play. One file lists every actor, says
which one walks on first, and says how they speak to each other. You run one
command and the whole scene starts.

Compose replaces that README page with one file that is committed to the
repository.
Part 1 builds that file service by service, then deals with the thing that
breaks first: `depends_on` does not mean what you think it means.

> **📌 In one line:** one `docker-compose.yml` in the repository means every
> developer runs the same Postgres, the same Redis and the same API, started
> with one command.

## Table of Contents

1. [What Compose Actually Is](#what-compose-actually-is)
2. [Building the File, Service by Service](#building-the-file-service-by-service)
3. [Service Names Are Hostnames](#service-names-are-hostnames)
4. [depends_on Is Not Enough](#depends_on-is-not-enough)
5. [Environment Variables and .env](#environment-variables-and-env)
6. [Volumes and Wiping Everything](#volumes-and-wiping-everything)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)
9. [Related](#related)

---

## What Compose Actually Is

Compose is a thin layer over the `docker run` commands from
[02-running-containers-locally-part-1.md](./02-running-containers-locally-part-1.md).
Every flag you typed there has a key in a YAML file — a plain-text
configuration format that uses indentation instead of brackets. The
[Compose section of overview.md](../../cloud-devops/docker/overview.md#docker-compose-running-multiple-containers-together)
has the concept note. What matters here is that Compose adds three things on top
of plain `docker run`:

- **A network, created for you**, with every service attached and reachable by
  name.
- **A project namespace**, so containers, volumes and networks are grouped and
  can be torn down together.
- **A file under version control**, so the setup is reviewed in pull requests
  like any other code.

```bash
docker compose up -d       # start everything
docker compose ps          # what is running
docker compose logs -f api # follow one service
docker compose down        # stop and remove containers and the network
```

```text
NAME            IMAGE           STATUS                   PORTS
api-1           invoicing-api   Up 2 minutes             0.0.0.0:3333->3333/tcp
postgres-1      postgres:16     Up 2 minutes (healthy)   0.0.0.0:5432->5432/tcp
redis-cache-1   redis:7         Up 2 minutes             0.0.0.0:6379->6379/tcp
```

`NAME` is the service name from the file plus a replica number, so `postgres-1`
is the first container of the `postgres` service. The word in brackets in
`STATUS` appears only for services that declare a `healthcheck`, which the
`depends_on` section below adds.

> **💡 Tip:** it is `docker compose` (two words, the built-in plugin), not
> `docker-compose` (the old standalone Python tool). Commands are nearly
> identical; prefer the plugin.

## Building the File, Service by Service

### Step 1: the database

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: invoicing
      POSTGRES_PASSWORD: localdev
      POSTGRES_DB: invoicing
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

`ports` is here only so you can connect from your laptop with a graphical
client such as TablePlus or pgAdmin. The API does not need it. The API reaches
Postgres over the Compose network.

### Step 2: two Redis instances

```yaml
  redis-cache:
    image: redis:7
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    ports:
      - "6379:6379"

  redis-queue:
    image: redis:7
    command: redis-server --maxmemory-policy noeviction
    volumes:
      - redisqueue:/data
    ports:
      - "6380:6379"
```

Two Redis containers, deliberately. They are configured for opposite jobs.

The cache instance is told to **evict** keys when it runs out of memory. That is
the whole point of a cache. `allkeys-lru` drops the keys nobody has read
recently.

The queue instance is told to **never evict**. An evicted key there is a deleted
job: an invoice that is never emailed, with nothing in any log. One shared
instance means one eviction policy for both, and whichever you pick is wrong for
the other. The full argument is in
[05-memory-and-operations-part-1.md](../../caching-and-background-jobs/02-redis-in-practice/05-memory-and-operations-part-1.md).

Note the host ports: `6379` and `6380` both map to container port `6379`. Inside
the Compose network both are plain `6379` on different hostnames.

### Step 3: the API

```yaml
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3333:3333"
    env_file:
      - .env
    environment:
      DATABASE_URL: postgres://invoicing:localdev@postgres:5432/invoicing
      CACHE_REDIS_URL: redis://redis-cache:6379
      QUEUE_REDIS_URL: redis://redis-queue:6379
    depends_on:
      - postgres
      - redis-cache
      - redis-queue
```

`build` instead of `image`: Compose builds from your Dockerfile. The hostnames
in those URLs are the service names from the file. We fix `depends_on` shortly.

### Step 4: the worker

```yaml
  worker:
    build:
      context: .
      dockerfile: Dockerfile
    command: ["node", "dist/worker.js"]
    env_file:
      - .env
    environment:
      DATABASE_URL: postgres://invoicing:localdev@postgres:5432/invoicing
      QUEUE_REDIS_URL: redis://redis-queue:6379
    depends_on:
      - postgres
      - redis-queue
```

Same image, different `command`. The worker processes jobs; it serves no HTTP,
so it has no `ports`. This mirrors how it should be deployed: one image, two
process types, as described in
[02-anatomy-of-a-job-system-part-1.md](../../caching-and-background-jobs/03-background-jobs/02-anatomy-of-a-job-system-part-1.md).

```mermaid
flowchart LR
    B[Browser] --> A[api :3333]
    A --> P[(postgres :5432)]
    A --> RC[(redis-cache)]
    A -->|enqueue| RQ[(redis-queue)]
    W[worker] -->|dequeue| RQ
    W --> P
```

## Service Names Are Hostnames

Compose creates one network for the project and registers every service name in
its DNS. `postgres`, `redis-cache`, `redis-queue`, `api` and `worker` are all
resolvable hostnames from inside any of those containers.

```bash
docker compose exec api sh -c "getent hosts postgres"
```

```text
172.19.0.3       postgres
```

The IP changes every time you recreate the stack. The name never does. That is
the entire reason to use names.

```yaml
# ❌ BROKEN - localhost inside the api container is the api container
DATABASE_URL: postgres://invoicing:localdev@localhost:5432/invoicing
```

```yaml
# ✅ FIXED - the postgres service name, resolved by Compose's DNS
DATABASE_URL: postgres://invoicing:localdev@postgres:5432/invoicing
```

Two port numbers matter here, and they are not the same:

| From | Host to use | Port to use |
|---|---|---|
| Your laptop (psql, a GUI client) | `localhost` | `5432`, the published host port |
| The `api` container | `postgres` | `5432`, the container port |
| The `api` container, to queue Redis | `redis-queue` | `6379`, **not** the published `6380` |

The last row is the one people get wrong. `6380` exists only on your laptop.
Inside the Compose network, every Redis listens on `6379`.

## depends_on Is Not Enough

This is the most common Compose failure, and the error message points at your
application rather than the real cause.

```yaml
# ❌ BROKEN - waits for the container to start, not for Postgres to be ready
  api:
    depends_on:
      - postgres
```

```bash
docker compose up
```

```text
api-1       | Error: connect ECONNREFUSED 172.19.0.3:5432
api-1       |     at TCPConnectWrap.afterConnect
api-1 exited with code 1
postgres-1  | database system is ready to accept connections
```

Read the order of those lines. The API gave up *before* Postgres finished
starting.

`depends_on` only guarantees start **order**. Compose starts the `postgres`
container first, then immediately starts `api`. It does not wait for the
Postgres process inside to finish setting up, run its first-boot scripts and
open the socket.

That work takes a few seconds. Your app connects in milliseconds.

It is also intermittent, which makes it worse. On a warm cache Postgres starts
in two seconds and everything works. After a `down -v`, first boot takes eight
seconds, and the API starts and dies over and over.

### Fix 1: a healthcheck and a condition

```yaml
# ✅ FIXED - wait until Postgres actually answers
  postgres:
    image: postgres:16
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U invoicing -d invoicing"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

  redis-queue:
    image: redis:7
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 10

  api:
    depends_on:
      postgres:
        condition: service_healthy
      redis-queue:
        condition: service_healthy
      redis-cache:
        condition: service_started
```

`service_healthy` waits for the healthcheck to pass. `service_started` is the
old behaviour, and it is fine for the cache — the app should survive a missing
cache anyway.

`pg_isready` is a small tool shipped in the Postgres image that returns 0 when
the server accepts connections. `redis-cli ping` returns `PONG`.

### Fix 2: retry in the application, which is the real answer

The healthcheck fixes startup on your laptop. It does **not** fix a database
that restarts at 3 AM, a failover, a short network outage, or a connection pool
that loses every connection at once. None of those re-run `depends_on`.

```ts
// src/database.ts
import { setTimeout as sleep } from 'node:timers/promises'

export async function connectWithRetry(maxAttempts = 10): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query('select 1')
      return
    } catch (error) {
      if (attempt === maxAttempts) throw error
      // Exponential backoff, capped, so a long outage does not spin the CPU.
      const delayMs = Math.min(1_000 * 2 ** (attempt - 1), 15_000)
      console.warn(JSON.stringify({ level: 'warn', msg: 'db not ready', attempt, delayMs }))
      await sleep(delayMs)
    }
  }
}
```

```mermaid
flowchart TD
    A[Container starts] --> B[Try a connection]
    B --> C{Succeeded?}
    C -->|yes| D[Start serving traffic]
    C -->|no| E{Attempts left?}
    E -->|yes| F[Wait with backoff] --> B
    E -->|no| G[Exit non-zero so the platform restarts us]
```

> **📌 Remember:** the healthcheck makes local startup pleasant. The retry loop
> makes the app correct. Do both, and understand that only one of them is a real
> fix.

## Environment Variables and .env

Compose uses `.env` in two different ways, and confusing them wastes an hour.

**1. Interpolation into the YAML.** Compose automatically reads a file named
`.env` next to `docker-compose.yml` and substitutes `${VAR}` in the file itself.

```yaml
  postgres:
    image: postgres:${POSTGRES_VERSION:-16}
```

**2. Passing variables into a container.** That is `env_file:`, and it is a
different mechanism with a different file list.

```yaml
  api:
    env_file:
      - .env            # passed into the container's environment
    environment:
      LOG_LEVEL: debug  # wins over the same key in env_file
```

Precedence, highest first: `environment:` in the YAML, then `env_file:`, then
whatever is baked into the image with `ENV`.

### Keeping real secrets out

```text
# .gitignore
.env
.env.local
```

```bash
# .env.example  -- this one IS committed
POSTGRES_VERSION=16
DATABASE_URL=postgres://invoicing:localdev@postgres:5432/invoicing
STRIPE_SECRET_KEY=sk_test_replace_me
SENDGRID_API_KEY=replace_me
JWT_SECRET=generate_your_own
```

Commit `.env.example` with fake values. Never commit `.env`. Local-only
passwords like `localdev` are fine in the committed Compose file; a real Stripe
key is not, even a test one. Where production secrets actually belong is in
[05-secrets-and-configuration-part-1.md](../../backend-fundamentals/11-api-security/05-secrets-and-configuration-part-1.md).

```bash
docker compose config
```

That prints the fully resolved file with every `${VAR}` substituted — the
fastest way to find out why a value is not what you expected.

## Volumes and Wiping Everything

```yaml
volumes:
  pgdata:
  redisqueue:
```

Declared at the bottom of the file, referenced by services above. `pgdata` holds
your local database. It survives `docker compose down`, restarts, and rebuilds.

| Command | Containers | Network | Named volumes | Images |
|---|---|---|---|---|
| `docker compose stop` | Stopped, kept | Kept | Kept | Kept |
| `docker compose down` | Removed | Removed | **Kept** | Kept |
| `docker compose down -v` | Removed | Removed | **Deleted** | Kept |
| `docker compose down --rmi local` | Removed | Removed | Kept | Built images deleted |

```bash
docker compose down -v && docker compose up -d
```

That is the "start completely clean" command every developer needs: a brand new
database, no rows, migrations from zero. Use it when a migration went wrong
locally, or when your seeded data no longer makes sense.

> **⚠️ Warning:** `-v` deletes the named volumes for this project. Every row in
> your local Postgres is gone, with no confirmation prompt and no undo. If you
> have test data you spent an hour creating, dump it first:
> `docker compose exec postgres pg_dump -U invoicing invoicing > backup.sql`.

> **➡️ Continued in [Part 2](./03-compose-for-local-development-part-2.md)** —
> hot reload and the `node_modules` masking problem, running migrations and
> tests with `compose run`, dev versus production, profiles and override files.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| `localhost` in a service's connection string | Resolves to that container, not the database | Use the service name: `postgres`, `redis-queue` |
| Using the published host port inside the network | `6380` exists only on your laptop | Inside the network, use the container port: `6379` |
| Relying on plain `depends_on` | Waits for the container to start, not for the service to accept connections | `condition: service_healthy` plus an application retry loop |
| One Redis for cache and queue | One eviction policy serves both, so either the cache cannot evict or the queue silently loses jobs | Two services with opposite `maxmemory-policy` |
| Committing `.env` | Real keys land in git history forever | Commit `.env.example`, gitignore `.env` |
| `docker compose down -v` out of habit | Deletes the local database with no prompt | Plain `down` unless you mean to wipe data |
| Confusing `.env` interpolation with `env_file` | Variables appear in the YAML but not in the container, or the reverse | `docker compose config` to see what actually resolved |

## Questions to Test Yourself

1. Your API connects fine after the second `docker compose up`, but always fails
   on the first one after `down -v`. What is happening, and which two fixes
   apply?
2. `psql` from your laptop uses `localhost:5432` and the API uses
   `postgres:5432`. Explain why both are correct.
3. Why does the queue Redis get `noeviction` while the cache Redis gets
   `allkeys-lru`, and what breaks if you swap them?
4. A teammate adds `condition: service_healthy` and says the retry loop in the
   app is now redundant. What scenario do you describe to change their mind?
5. What is the difference between `env_file:` and the `.env` file Compose reads
   automatically?
6. What exactly does `docker compose down` leave behind, and what does `-v`
   add?
7. The worker and the API use the same `build:` block. Why is that correct
   rather than duplication?

## Related

- [Part 2](./03-compose-for-local-development-part-2.md) — hot reload, one-off
  commands, dev versus production, profiles and overrides.
- [overview.md](../../cloud-devops/docker/overview.md) — the Compose concept
  note this file implements.
- [02-running-containers-locally-part-2.md](./02-running-containers-locally-part-2.md)
  — the networking and volume behaviour Compose is wrapping.
- [05-memory-and-operations-part-1.md](../../caching-and-background-jobs/02-redis-in-practice/05-memory-and-operations-part-1.md)
  — why the cache and the queue cannot share one Redis.
- [05-secrets-and-configuration-part-1.md](../../backend-fundamentals/11-api-security/05-secrets-and-configuration-part-1.md)
  — configuration and secrets beyond a local `.env`.
- [01-connection-pooling-part-1.md](../../databases/operations/01-connection-pooling-part-1.md)
  — what the pool is doing while your retry loop waits.
