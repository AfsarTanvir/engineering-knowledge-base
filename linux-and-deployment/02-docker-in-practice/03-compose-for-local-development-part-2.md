# Compose for Local Development — Part 2

> **⬅️ This continues [Part 1](./03-compose-for-local-development-part-1.md).**

Part 1 produced a stack that starts with one command and waits for Postgres
properly. It has one flaw that makes it unusable for actual development: every
code change needs a rebuild.

This part fixes that with a bind mount and a watcher. That immediately runs into
the most confusing problem in containerised Node development: the host
`node_modules` hides the container's. Then come the commands you run beside the
stack — migrations, seeds, a shell, the test suite. Then an honest answer to
"should I use Compose in production, or learn Kubernetes?"

> **📌 In one line:** mount your source for instant reload, keep
> `node_modules` out of that mount, and run migrations and tests with
> `docker compose run --rm`.

## Table of Contents

1. [A Development Image](#a-development-image)
2. [The node_modules Masking Problem](#the-node_modules-masking-problem)
3. [Running One-Off Commands](#running-one-off-commands)
4. [Compose in Production, Honestly](#compose-in-production-honestly)
5. [Profiles and Multiple Files](#profiles-and-multiple-files)
6. [Common Mistakes](#common-mistakes)
7. [Questions to Test Yourself](#questions-to-test-yourself)
8. [Related](#related)

---

## A Development Image

The production image from
[01-a-dockerfile-for-node-part-2.md](./01-a-dockerfile-for-node-part-2.md) runs
compiled JavaScript from `dist/` and carries no dev dependencies. For
development you want the opposite: the TypeScript source, a watcher, and every
dev dependency available.

Add a stage to the same Dockerfile rather than writing a second one:

```dockerfile
# ---------- Stage: development ----------
FROM node:22-slim AS dev
WORKDIR /app
ENV NODE_ENV=development

COPY package.json package-lock.json ./
RUN npm ci                              # all dependencies, dev included

COPY . .
CMD ["npx", "tsx", "watch", "src/server.ts"]
```

Then point the Compose service at that stage:

```yaml
  api:
    build:
      context: .
      target: dev          # stop at the dev stage, not the runtime stage
    ports:
      - "3333:3333"
    volumes:
      - .:/app             # your source, live
    environment:
      DATABASE_URL: postgres://invoicing:localdev@postgres:5432/invoicing
```

Save a file in your editor, `tsx` notices, the process restarts, and the change
is live in under a second. No rebuild.

```mermaid
sequenceDiagram
    participant E as Your editor
    participant H as Host folder
    participant C as api container
    participant W as tsx watch
    E->>H: save src/services/invoice-service.ts
    H->>C: the bind mount shows the new file
    C->>W: file change event
    W->>W: restart the server process
```

That is the idea. Run it and it fails.

## The node_modules Masking Problem

```bash
docker compose up api
```

```text
api-1  | Error: Cannot find module 'tsx'
api-1  | Require stack:
api-1  | - /app/node_modules/.bin/tsx
api-1 exited with code 1
```

The image definitely installed `tsx`. The `RUN npm ci` is right there in the
build output. And it is gone.

### Why

Think of a bind mount as a sheet of paper laid over one page of a book. The page
underneath is still there. You simply cannot see or read it any more.

A bind mount does not merge directories. It **replaces** the mount point with
the host directory, and hides whatever the image put there.

```text
Inside the image, after RUN npm ci:
  /app/package.json
  /app/src/
  /app/node_modules/        <- 600 packages, compiled for Linux

Then  - .:/app  mounts your project folder over /app:

  /app  ──────▶ /home/you/invoicing-api   (your laptop)
                 ├── package.json
                 ├── src/
                 └── node_modules/ ?      <- whatever is on YOUR machine
```

Two outcomes, both bad:

- **You have no `node_modules` on the host** (because you only ever ran the app
  in Docker). `/app/node_modules` is now empty. Nothing can be imported.
- **You do have `node_modules` on the host**, installed on macOS or Windows.
  Some packages ship a compiled binary — `bcrypt`, `sharp`, a database driver.
  Those were built for the wrong operating system. They fail at import with a
  missing `.node` file, or an "invalid ELF header" message. ELF is the Linux
  executable format, so that message means "this file is not a Linux binary".

The container's `node_modules` is not deleted. It is underneath the mount,
unreachable.

### The fix

```yaml
# ❌ BROKEN - the host directory hides the container's node_modules
    volumes:
      - .:/app
```

```yaml
# ✅ FIXED - a second mount puts the container's node_modules back on top
    volumes:
      - .:/app
      - /app/node_modules
```

The second line has **no host path**. That makes it an *anonymous volume*
mounted at `/app/node_modules`, and because it is mounted after (more specific
than) `.:/app`, it takes precedence at that path. The container keeps the
`node_modules` the image built, and everything else comes from your laptop.

Mount order is not what matters — specificity is. `/app/node_modules` is deeper
than `/app`, so it wins.

Two alternatives worth knowing:

| Approach | How | Trade-off |
|---|---|---|
| Anonymous volume | `- /app/node_modules` | Standard, one line. Stale after a dependency change until you recreate it |
| Named volume | `- node_modules:/app/node_modules` | Same, but inspectable and explicitly removable with `down -v` |
| Mount only source | `- ./src:/app/src` | No masking possible at all. You lose live edits to config files outside `src` |

> **⚠️ Warning:** after adding or removing an npm package, the anonymous volume
> still holds the old `node_modules`. Rebuild and recreate:
> `docker compose up -d --build --force-recreate api`. "I installed the package
> and it still says module not found" is almost always this.

> **💡 Tip:** on macOS and Windows, bind mounts are much slower than native
> disk, and a watcher scanning thousands of files makes it worse. Keep
> `node_modules` out of the mount (which you are now doing) and, if the watcher
> still struggles, narrow the mount to `./src`.

## Running One-Off Commands

Two commands, and the difference matters.

| Command | Runs in | Use for |
|---|---|---|
| `docker compose exec api <cmd>` | The **already running** container | A shell, inspecting live state |
| `docker compose run --rm api <cmd>` | A **new** container from the same config | Migrations, seeds, tests, scripts |

`run --rm` is the one you want for tasks. It starts a fresh container, runs the
command, and deletes it. `--rm` matters: without it every migration you ever ran
is still sitting in `docker ps -a`.

### Migrations

```bash
docker compose run --rm api node ace migration:run
```

```text
❯ migrated database/migrations/1712_create_companies_table
❯ migrated database/migrations/1713_create_invoices_table
❯ migrated database/migrations/1714_add_status_to_invoices
```

One line per migration file, in filename order. The number prefix is what fixes
that order. Run the same command again and it prints nothing, because the
migrations table already records all three as applied.

```bash
docker compose run --rm api node ace migration:rollback --batch=0
```

Run migrations as a **separate step**, not from inside the app's startup. Two
API replicas starting at once both try to migrate, and you get a lock conflict
or a half-applied schema. The reasoning is in
[02-migrations-part-1.md](../../backend-fundamentals/10-database-integration/02-migrations-part-1.md).

### Seeds and a shell

```bash
docker compose run --rm api node ace db:seed
docker compose exec api sh                     # shell in the running container
docker compose exec postgres psql -U invoicing -d invoicing
```

```text
invoicing=# select status, count(*) from invoices group by status;
 status  | count
---------+-------
 draft   |    14
 sent    |     3
```

`invoicing=#` is the psql prompt, and it shows which database you are connected
to. Real rows here prove two things: the seed ran, and `compose exec` reached
the right container rather than a second, empty Postgres.

### The test suite

Tests need a database that can be wiped, which is not the one holding your
development data.

```yaml
  postgres-test:
    image: postgres:16
    environment:
      POSTGRES_USER: invoicing
      POSTGRES_PASSWORD: localdev
      POSTGRES_DB: invoicing_test
    tmpfs:
      - /var/lib/postgresql/data     # in memory: fast, and wiped on restart
    profiles: ["test"]
```

```bash
docker compose --profile test run --rm \
  -e DATABASE_URL=postgres://invoicing:localdev@postgres-test:5432/invoicing_test \
  api npm test
```

`tmpfs` puts the test database in RAM. It is noticeably faster and there is no
volume to clean up. How the suite should isolate itself between tests —
transactions, truncation, a database per worker — is covered in
[03-integration-and-api-testing-part-1.md](../../backend-fundamentals/13-testing-and-quality/03-integration-and-api-testing-part-1.md).

## Compose in Production, Honestly

Compose is genuinely good for two things:

1. **Local development.** No other tool is this simple for the job.
2. **A single small server running one application.** One rented virtual server
   (a VPS), an API, a worker, Postgres, Redis, and nginx in front. Compose runs
   this well, and plenty of real businesses are served by exactly that.

What it does not give you: rolling updates without a gap, automatic restarts
across machines, scheduling across a cluster, or self-healing. If a single
server is enough for your traffic, you do not need any of that.

```mermaid
flowchart TD
    A[One application, one server] --> B[Compose. Stop here.]
    C[One application, traffic grew] --> D[Bigger server first]
    D --> E[Then a load balancer and a few servers]
    E --> F[Only then consider an orchestrator]
```

> **📌 Remember:** Kubernetes is not the next step after Compose for one
> application. It is the step after you have several services, several teams
> deploying independently, and a real need to schedule across many machines.
> Adopting it early gives you a second system to run and keep alive.

The concepts, for when it is genuinely time:
[kubernetes/](../../cloud-devops/kubernetes/). The question underneath is
whether you should have several services at all. That one is in
[monolith-vs-microservices.md](../../system-design/foundational/monolith-vs-microservices.md),
and the honest answer for one team is usually "not yet".

Two things change if you do run Compose on a server. Use pre-built, tagged
images from a registry rather than `build:`, because you do not want to compile
on the production machine. And set `restart: unless-stopped` on every service.

## Profiles and Multiple Files

### Profiles

A profile keeps a service out of the default `up`.

```yaml
  postgres-test:
    profiles: ["test"]

  mailhog:
    image: mailhog/mailhog
    ports: ["8025:8025"]
    profiles: ["tools"]
```

```bash
docker compose up -d                      # api, worker, postgres, redis only
docker compose --profile tools up -d      # also starts mailhog
```

Useful for things most people do not need running all day. A fake email server
that catches outgoing mail. A database admin page. A one-off load generator.

### Override files

Compose automatically merges `docker-compose.yml` with
`docker-compose.override.yml` if the second exists.

```yaml
# docker-compose.yml  -- shared, production-shaped
services:
  api:
    image: invoicing-api:1.4.0
    restart: unless-stopped
```

```yaml
# docker-compose.override.yml  -- local only, gitignored or committed as a sample
services:
  api:
    build:
      context: .
      target: dev
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      LOG_LEVEL: debug
```

Keys merge, scalars are replaced, and lists are replaced wholesale — so an
override's `volumes:` replaces the base `volumes:` rather than adding to it.

For anything other than the automatic override, name the files explicitly:

```bash
docker compose -f docker-compose.yml -f docker-compose.ci.yml up -d
```

```bash
docker compose -f docker-compose.yml -f docker-compose.ci.yml config
```

Always check with `config` when merging files. The result is frequently not
what you expected.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| `- .:/app` with no second volume | The host directory hides the container's `node_modules`, so nothing imports | Add `- /app/node_modules` |
| Host `node_modules` reused inside the container | Native modules compiled for macOS or Windows do not load on Linux | Keep the anonymous volume, and `node_modules` in `.dockerignore` |
| Expecting a new package to appear after `npm install` on the host | The anonymous volume still holds the old tree | `docker compose up -d --build --force-recreate api` |
| `docker compose run` without `--rm` | Every task leaves a dead container behind | Always `run --rm` |
| Running migrations from application startup | Two replicas migrate at once and conflict | A separate `compose run --rm` step before the app starts |
| Running tests against the development database | Wipes your seed data, and tests interfere with each other | A `postgres-test` service, ideally on `tmpfs` |
| `build:` in a production Compose file | Compiles on the server, so the running version depends on what is checked out there | Pre-built tagged images from a registry |
| Reaching for Kubernetes to deploy one API | Adds a cluster, a control plane and a new vocabulary to a problem one server solves | Compose on one server until something concrete forces a change |

## Questions to Test Yourself

1. You add `- .:/app` and the container cannot find `tsx`, which you can see
   being installed in the build output. Explain what happened to it.
2. Why does `- /app/node_modules` take precedence over `- .:/app` when one is a
   subpath of the other?
3. You `npm install dayjs` on your laptop and the container still says the
   module is missing. What is stale, and what is the command?
4. When do you use `compose exec` and when do you use `compose run --rm`?
5. Why should migrations not run from your application's startup code when two
   replicas start together?
6. Your team has one API, one worker, one database and four developers. What is
   your argument against moving to Kubernetes this quarter?
7. You merge two Compose files and a service loses its volumes. What merge rule
   explains it, and which command would have shown you before you ran it?

## Related

- [Part 1](./03-compose-for-local-development-part-1.md) — the stack itself,
  service names, `depends_on` and healthchecks, `.env`, volumes.
- [01-a-dockerfile-for-node-part-2.md](./01-a-dockerfile-for-node-part-2.md) —
  the multi-stage Dockerfile the `dev` target is added to.
- [volumes.md](../../cloud-devops/docker/volumes.md) — bind mounts versus named
  volumes, and why an anonymous volume behaves the way it does.
- [02-migrations-part-1.md](../../backend-fundamentals/10-database-integration/02-migrations-part-1.md)
  — running migrations as a deliberate, separate step.
- [03-integration-and-api-testing-part-1.md](../../backend-fundamentals/13-testing-and-quality/03-integration-and-api-testing-part-1.md)
  — the disposable test database this file starts for you.
- [kubernetes/](../../cloud-devops/kubernetes/) — the concepts, for when there
  is a real reason.
- [monolith-vs-microservices.md](../../system-design/foundational/monolith-vs-microservices.md)
  — the architectural question behind "do I need an orchestrator?".
- [04-debugging-containers-part-1.md](./04-debugging-containers-part-1.md) —
  what to do when any of this does not behave.
