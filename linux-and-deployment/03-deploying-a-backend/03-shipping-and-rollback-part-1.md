# Shipping and Rollback — Part 1

The server is ready. Now you need to get a new version of your code onto it, and
then do that again tomorrow, and fifty more times after that. This part builds
the pipeline: the manual deploy first so you can see every step, then migrations
as their own stage, then a GitHub Actions workflow that does the whole thing
from a `git push`.

> **📌 In one line:** build one image, tag it with the commit SHA, run
> migrations as a separate step before the new code starts, and never let a
> human type the deploy commands twice.

## Table of Contents

1. [The Manual Deploy, Once](#the-manual-deploy-once)
2. [Which Parts Must Be Automated](#which-parts-must-be-automated)
3. [Migrations Are Their Own Step](#migrations-are-their-own-step)
4. [Tag by Commit SHA, Never `latest`](#tag-by-commit-sha-never-latest)
5. [The GitHub Actions Workflow](#the-github-actions-workflow)
6. [Secrets in CI](#secrets-in-ci)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)
9. [Related](#related)

---

## The Manual Deploy, Once

Do this by hand exactly once. Automating something you have never done by hand
means debugging two unknowns at the same time.

Six steps. On your laptop first:

```bash
# 1. Build the image, tagged with the exact commit you are shipping
SHA=$(git rev-parse --short HEAD)
docker build -t ghcr.io/afsartanvir/myapp-api:$SHA .

# 2. Push it to a registry so the server can pull it
echo "$GHCR_TOKEN" | docker login ghcr.io -u afsartanvir --password-stdin
docker push ghcr.io/afsartanvir/myapp-api:$SHA
```

Then on the server:

```bash
ssh afsar@203.0.113.10

# 3. Pull the exact image
docker pull ghcr.io/afsartanvir/myapp-api:a1b2c3d

# 4. Run migrations as a one-off container, using the SAME image
docker run --rm --env-file /srv/myapp/.env \
  ghcr.io/afsartanvir/myapp-api:a1b2c3d node ace migration:run --force

# 5. Restart the app with the new image
docker stop myapp-api && docker rm myapp-api
docker run -d --name myapp-api --restart unless-stopped \
  --env-file /srv/myapp/.env -p 127.0.0.1:3333:3333 \
  ghcr.io/afsartanvir/myapp-api:a1b2c3d

# 6. Verify
curl -fsS http://127.0.0.1:3333/health && echo " OK"
```

```text
{"status":"ok","version":"a1b2c3d","uptime":2}
 OK
```

A **registry** is a server that stores Docker images, the way npm stores
packages. GitHub Container Registry (`ghcr.io`) is free for your repositories
and already authenticated inside GitHub Actions, which is why this folder uses
it. Docker Hub works identically.

Notice what step 4 does **not** do: it does not use a different image, a
different Node version, or a script copied onto the server. It runs the same
artifact you are about to start, with a different command. That is the
twelve-factor "admin processes" rule from
[What Deployment Actually Is](01-what-deployment-actually-is.md#twelve-factor-ideas-worth-keeping),
and it is what stops a migration from being tested against a different version
of your ORM than the one that will run.

---

## Which Parts Must Be Automated

Look at those six steps again and mark the ones a tired human gets wrong.

| Step | Risk when done by hand | Severity |
|---|---|---|
| 1. Build | Building from a dirty working tree, so the image contains uncommitted code | **High** — the image matches no commit |
| 2. Push | Forgetting, then pulling yesterday's image and wondering why nothing changed | Medium |
| 3. Pull | Typing the wrong SHA | Medium |
| 4. Migrate | **Forgetting entirely**, or running it after the new code starts | **Critical** — every request 500s |
| 5. Restart | A gap of several seconds with nothing serving; forgetting `--restart` | **High** |
| 6. Verify | Skipping it because it "looked fine" | **High** — you find out from a user |

Steps 1 and 4 are the ones that cause real incidents. Step 1 because an image
built from uncommitted work can never be reproduced or rolled back to. Step 4
because the failure is total and immediate: new code queries a column that does
not exist, and every request fails.

```text
  Human deploy at 23:40:
    build (forgot to commit one file)  ->  push  ->  pull
    ->  restart  ->  [migration never ran]  ->  500s
    ->  roll back to... which image? the one that was "latest" yesterday?
```

The whole rest of this file is making that sequence impossible.

> **💡 Tip:** Write the automated version as a shell script on the server
> **first**, then have CI call the script. A script you can run by hand during
> an incident is far more useful than logic buried in YAML you cannot execute
> locally.

---

## Migrations Are Their Own Step

**Migrations run before the new code starts, as a separate step, never on
application boot.** The mechanics of writing them, and the expand/contract
pattern that makes them safe, are already covered in
[Migrations — Part 1](../../backend-fundamentals/10-database-integration/02-migrations-part-1.md)
and [Part 2](../../backend-fundamentals/10-database-integration/02-migrations-part-2.md).
This section is only about *where in the deploy* they go.

Here is why "run migrations on boot" fails.

```ts
// ❌ BROKEN - migrate on startup, inside the app
async function start(): Promise<void> {
  await runMigrations()        // every instance does this
  await server.listen(3333)
}
```

With one instance this works. With two — an API container and a worker
container, or old and new running together for ten seconds during a deploy — you
get this:

```mermaid
sequenceDiagram
    participant A as api container
    participant W as worker container
    participant DB as PostgreSQL
    A->>DB: SELECT * FROM migrations
    W->>DB: SELECT * FROM migrations
    Note over A,W: both read the same list, both see 0042 as pending
    A->>DB: ALTER TABLE invoices ADD COLUMN paid_at
    W->>DB: ALTER TABLE invoices ADD COLUMN paid_at
    DB-->>W: ERROR column paid_at already exists
    Note over W: worker crashes, restarts, crashes again
```

Some migration tools take an advisory lock and avoid the duplicate statement. It
still leaves you with the second instance blocked on a lock, waiting for a
migration it cannot see the progress of, and failing its health check while it
waits.

```ts
// ✅ FIXED - the app only serves; migrating is a separate command
async function start(): Promise<void> {
  await assertSchemaIsCurrent()   // read-only check: fail fast if behind
  await server.listen(3333)
}
```

The deploy order that works:

```text
  1. migrate   (one container, runs to completion, exits 0)
  2. start new code
  3. verify
```

And the rule that makes step 1 safe to run while the **old** code is still
serving: **every migration must be backward compatible with the version
currently in production.** Add a nullable column, do not rename one. Expand now,
contract in the next release. That is the expand/contract pattern, in full, in
[Migrations — Part 2](../../backend-fundamentals/10-database-integration/02-migrations-part-2.md).

> **⚠️ Warning:** A migration that takes a long lock on a large table will stall
> every request while it runs, and your deploy will look like an outage. Check
> what your migration locks before you ship it — a plain `ALTER TABLE ... ADD
> COLUMN` with a default used to rewrite the whole table in older PostgreSQL
> versions.

Make the migration step **fail the deploy**. If it exits non-zero, the new code
must not start, and the old code keeps serving. That is the safest possible
failure: nothing changed.

---

## Tag by Commit SHA, Never `latest`

This is the single most valuable habit in this file. It takes one line to get
right and makes two of the hardest problems in operations simple.

**`latest` is a mutable name.** It points at whatever was pushed most recently.
Three things follow from that, and all three are bad.

| Question | With `:latest` | With `:a1b2c3d` |
|---|---|---|
| What is running in production right now? | Unknown. "Whatever was latest when the container started" | `a1b2c3d` — one commit, one diff, one author |
| How do I roll back? | You cannot. The previous image has no name | `docker run ...:9f8e7d6` |
| Are staging and production the same build? | Probably not — each pulled `latest` at a different moment | Compare two strings |

```bash
# ❌ BROKEN - the tag moves, so the version is unknowable and unrollbackable
docker build -t ghcr.io/afsartanvir/myapp-api:latest .
docker push ghcr.io/afsartanvir/myapp-api:latest
docker pull ghcr.io/afsartanvir/myapp-api:latest    # which build is this?
```

```bash
# ✅ FIXED - an immutable tag per commit; latest is an extra alias, not the identity
docker build \
  -t ghcr.io/afsartanvir/myapp-api:$GITHUB_SHA \
  -t ghcr.io/afsartanvir/myapp-api:latest .
docker push --all-tags ghcr.io/afsartanvir/myapp-api
# deploys always reference the SHA; `latest` is only a convenience for humans
```

Bake the SHA into the image so the running app can tell you what it is:

```dockerfile
ARG GIT_SHA=unknown
ENV APP_VERSION=$GIT_SHA
```

```ts
// Health endpoint reports it, so `curl /health` answers "what is deployed?"
// without you having to SSH anywhere.
return { status: 'ok', version: process.env.APP_VERSION ?? 'unknown' }
```

> **📌 Remember:** rollback is not a feature you build. It is a thing you either
> can or cannot do, decided entirely by whether the previous artifact still has
> a name. Tag by SHA and rollback is free.

The same "promote one artifact" principle, as a general CI/CD idea, is in
[cloud-devops/ci-cd/overview.md](../../cloud-devops/ci-cd/overview.md#artifacts-what-actually-moves-through-the-pipeline).

---

## The GitHub Actions Workflow

What a workflow, job, step and runner are — and the YAML syntax for triggers,
matrices and caching — is covered in
[cloud-devops/ci-cd/github-actions.md](../../cloud-devops/ci-cd/github-actions.md).
What follows is one complete pipeline for this specific setup: test, build,
push, deploy over SSH, verify.

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:        # lets you re-run a deploy from the UI

concurrency:
  group: deploy-production
  cancel-in-progress: false   # never let two deploys overlap on one server

env:
  IMAGE: ghcr.io/${{ github.repository }}

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: test, POSTGRES_DB: myapp_test }
        options: >-
          --health-cmd pg_isready --health-interval 5s --health-retries 5
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
        env:
          DATABASE_URL: postgres://postgres:test@localhost:5432/myapp_test
```

The integration tests here are the real gate — see
[Integration and API Testing](../../backend-fundamentals/13-testing-and-quality/03-integration-and-api-testing-part-1.md).
A pipeline whose tests you do not trust is a pipeline you will start skipping.

```yaml
  build:
    needs: test                       # only build what passed
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write                 # required to push to ghcr.io
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}   # provided automatically
      - uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          build-args: GIT_SHA=${{ github.sha }}
          tags: |
            ${{ env.IMAGE }}:${{ github.sha }}
            ${{ env.IMAGE }}:latest
          cache-from: type=gha                    # reuse layers across runs
          cache-to: type=gha,mode=max
```

```yaml
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: production           # enables a manual approval gate if you want one
    steps:
      - name: Deploy over SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          # The server-side script is in git and does the real work.
          # Keeping logic out of YAML means you can run it by hand at 11pm.
          script: /srv/myapp/deploy.sh ${{ github.sha }}

      - name: Verify the public endpoint
        run: |
          for i in $(seq 1 20); do
            body=$(curl -fsS https://api.myapp.com/health) && break || sleep 3
          done
          echo "$body"
          echo "$body" | grep -q '"version":"${{ github.sha }}"'
```

That last step is not decoration. **A deploy that is not verified is a deploy
you will hear about from a user.** Checking that the health endpoint reports the
SHA you just shipped proves the new code is actually the thing serving traffic —
not the old container that never got replaced.

```mermaid
flowchart LR
    P[push to main] --> T[test<br/>lint, types, integration]
    T -->|pass| B[build and push<br/>tagged with the SHA]
    T -->|fail| X[stop, nothing deployed]
    B --> D[ssh: deploy.sh SHA]
    D --> V[verify /health reports SHA]
    V -->|fail| R[alert: roll back]
```

---

## Secrets in CI

A workflow file is committed to the repository. Anyone who can read the repo can
read it, and a public repo means everyone. So nothing secret ever appears in it.

GitHub stores them encrypted under **Settings → Secrets and variables →
Actions**, and injects them as `${{ secrets.NAME }}` at run time.

```yaml
# ❌ BROKEN - committed to git, visible in history forever, even if you delete it later
- run: ssh -i /tmp/key deploy@203.0.113.10 "docker pull ..."
  env:
    DEPLOY_SSH_KEY: "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1r..."
```

```yaml
# ✅ FIXED - the value lives in GitHub's encrypted store; the file holds only a reference
- uses: appleboy/ssh-action@v1
  with:
    key: ${{ secrets.DEPLOY_SSH_KEY }}
```

For this pipeline you need exactly three:

| Secret | What it is | How to limit the damage if it leaks |
|---|---|---|
| `DEPLOY_HOST` | Your server IP or hostname | Not really secret; a variable is fine |
| `DEPLOY_USER` | The deploy user on the server | Not root |
| `DEPLOY_SSH_KEY` | A private key **generated for CI only** | A dedicated key, restricted in `authorized_keys` |

The registry token you do not need: `secrets.GITHUB_TOKEN` is created per run,
scoped to this repository, and expires when the job ends.

Create the deploy key as its own key pair — never reuse your laptop's:

```bash
ssh-keygen -t ed25519 -f ./deploy_ci -N "" -C "github-actions-deploy"
# public half -> the server; private half -> the GitHub secret
```

On the server, restrict what that key is allowed to do:

```text
# ~/.ssh/authorized_keys on the server
restrict,pty,command="/srv/myapp/deploy.sh" ssh-ed25519 AAAAC3Nza... github-actions-deploy
```

`command=` means the key can only run that one script, whatever the client asks
for. `restrict` turns off port forwarding and agent forwarding. If the GitHub
secret ever leaks, the attacker gets to redeploy your app — not a root shell.

> **⚠️ Warning:** GitHub masks secret values in logs, but only exact matches. A
> secret that your script base64-encodes, splits or prints inside JSON will
> appear in plain text. Never `echo` a secret, even while debugging.

> **➡️ Continued in [Part 2](./03-shipping-and-rollback-part-2.md)** —
> zero-downtime restarts, draining connections, rollback decisions, workers and
> version skew.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Tagging images `:latest` | The running version is unknowable and rollback is impossible | Tag with the commit SHA; `latest` is only an alias |
| Running migrations in the app's startup path | Two instances race; a failed migration crash-loops the app | A separate one-off container that must exit 0 first |
| Building the image on the server | The build competes with the running app for memory and CPU | Build in CI, pull on the server |
| Building from a dirty working tree | The image contains code that is in no commit, so it cannot be rebuilt or rolled back | CI builds only from a pushed commit |
| Putting all the deploy logic in the workflow YAML | You cannot run it by hand during an incident | A `deploy.sh` in git; CI just calls it |
| Reusing your personal SSH key as the CI deploy key | A leaked CI secret becomes a leaked laptop key | A dedicated key, with `command=` and `restrict` |
| Not verifying after deploy | A container that failed to start looks exactly like a successful deploy | Poll `/health` and assert the SHA |
| Letting two deploys run at once | They fight over the same container name and leave an unknown state | A `concurrency` group on the workflow |

---

## Questions to Test Yourself

1. Walk through the six manual deploy steps and name the two whose failure
   causes a total outage. Explain why each one does.
2. Your app runs migrations on boot. It has worked for a year. You add a worker
   container. Describe exactly what happens on the next deploy.
3. Production is broken and you want yesterday's build. You have been tagging
   `:latest`. What are your options, and why are they all bad?
4. Why must the migration container use the same image as the app, rather than a
   script checked out on the server?
5. A migration runs successfully but the new container fails to start. What
   state is the system in, and is that safe? What makes it safe or unsafe?
6. The deploy workflow passes but users report the old behaviour. Which step was
   missing, and what exactly would it have checked?
7. Your `DEPLOY_SSH_KEY` leaks publicly. With `command=` and `restrict` set in
   `authorized_keys`, what can the attacker actually do?
8. Why does `concurrency: group: deploy-production` matter on a single server
   but much less on a Kubernetes cluster?

---

## Related

- [03-shipping-and-rollback-part-2.md](03-shipping-and-rollback-part-2.md) — zero downtime, draining, rollback, workers.
- [02-setting-up-the-server-part-2.md](02-setting-up-the-server-part-2.md) — the nginx and TLS layer this deploys behind.
- [cloud-devops/ci-cd/github-actions.md](../../cloud-devops/ci-cd/github-actions.md) — Actions syntax: triggers, jobs, matrices, caching.
- [cloud-devops/ci-cd/overview.md](../../cloud-devops/ci-cd/overview.md) — the pipeline concept and why one artifact is promoted.
- [backend-fundamentals/10-database-integration/02-migrations-part-1.md](../../backend-fundamentals/10-database-integration/02-migrations-part-1.md) — writing and running migrations.
- [backend-fundamentals/10-database-integration/02-migrations-part-2.md](../../backend-fundamentals/10-database-integration/02-migrations-part-2.md) — expand/contract on a live database.
- [backend-fundamentals/13-testing-and-quality/03-integration-and-api-testing-part-1.md](../../backend-fundamentals/13-testing-and-quality/03-integration-and-api-testing-part-1.md) — the tests that gate the pipeline.
- [02-docker-in-practice/01-a-dockerfile-for-node-part-1.md](../02-docker-in-practice/01-a-dockerfile-for-node-part-1.md) — the image being built here.
