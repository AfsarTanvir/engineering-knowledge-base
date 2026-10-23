# Running Containers Locally — Part 2

> **⬅️ This continues [Part 1](./02-running-containers-locally-part-1.md).**

Part 1 got the container running and reachable. This part is about four things
that surprise people once it *is* running:

- Files written inside it disappear.
- Two containers cannot find each other by `localhost`.
- A container dies with no error message and exit code 137.
- Your laptop slowly runs out of disk.

None of these are advanced topics. They are the normal weekly experience of
working with containers. Each one has a short explanation that makes it stop
being mysterious.

> **📌 In one line:** a container's filesystem, network and memory are all its
> own — data needs a volume to survive, other containers are reached by name,
> and a container with no memory limit can take the whole machine down.

## Table of Contents

1. [Containers Are Ephemeral](#containers-are-ephemeral)
2. [Volumes and Bind Mounts: The Two Cases](#volumes-and-bind-mounts-the-two-cases)
3. [Container Networking](#container-networking)
4. [Resource Limits and Exit Code 137](#resource-limits-and-exit-code-137)
5. [Cleaning Up](#cleaning-up)
6. [Common Mistakes](#common-mistakes)
7. [Questions to Test Yourself](#questions-to-test-yourself)
8. [Related](#related)

---

## Containers Are Ephemeral

Think of a container as a hotel room. The furniture comes from the image and is
identical in every room. Anything you leave on the desk is yours alone, and the
cleaners throw it away when you check out.

In Docker terms: a container's filesystem is the image's read-only layers plus
one writable layer on top. That writable layer is deleted with the container.
The mechanism is described in
[image-vs-container.md](../../cloud-devops/docker/image-vs-container.md). Here
is what that looks like:

```bash
docker exec api sh -c "echo 'hello' > /app/note.txt && cat /app/note.txt"
```

```text
hello
```

```bash
docker rm -f api
docker run -d --name api -p 3333:3333 invoicing-api:1.4.0
docker exec api cat /app/note.txt
```

```text
cat: /app/note.txt: No such file or directory
```

Nothing went wrong. That is the design. A container is a disposable instance of
an image, and every deploy replaces it with a fresh one.

### What this breaks: file uploads

File uploads are usually the first feature where this hurts.

```ts
// ❌ BROKEN - the invoice attachment is written into the container
import { writeFile } from 'node:fs/promises'

async function storeAttachment(invoiceId: string, file: Buffer): Promise<string> {
  const path = `/app/uploads/${invoiceId}.pdf`
  await writeFile(path, file)
  return path            // a path that exists in exactly one container
}
```

It works. You test it, the file downloads, you ship it. Then:

- You deploy on Thursday. **Every attachment uploaded before Thursday is gone.**
- You scale to two containers. The upload lands on container A, the download
  request is routed to container B, and B returns 404 roughly half the time.
- The container restarts after a crash. Same data loss, no warning.

```ts
// ✅ FIXED - the file goes to object storage, the database stores the key
async function storeAttachment(invoiceId: string, file: Buffer): Promise<string> {
  const key = `invoices/${invoiceId}.pdf`
  await objectStorage.put(key, file, { contentType: 'application/pdf' })
  return key             // meaningful from any container, forever
}
```

```mermaid
flowchart TD
    A[Your app writes a file] --> B{Where does it land?}
    B -->|a plain container path| C[Writable layer: gone on the next deploy]
    B -->|a named volume| D[Survives this host, invisible to other replicas]
    B -->|object storage| E[Survives everything, readable by every replica]
```

Only the third row is safe for anything a user will ask for again. The full
treatment — signed URLs, serving files, what to store in the database — is in
[02-object-storage-and-serving-files.md](../../backend-fundamentals/12-files-and-integrations/02-object-storage-and-serving-files.md).

> **📌 Remember:** if your app writes a file that matters, ask immediately where
> it goes when the container is replaced. "Nowhere" is the default answer.

## Volumes and Bind Mounts: The Two Cases

A volume redirects a path inside the container to storage that outlives it. The
types — named volumes, bind mounts, `tmpfs` — and the trade-offs between them
are in [volumes.md](../../cloud-devops/docker/volumes.md). In day-to-day local
development you need exactly two patterns.

### Case 1: keeping your local database data

```bash
docker run -d --name postgres \
  -e POSTGRES_PASSWORD=secret \
  -e POSTGRES_DB=invoicing \
  -v invoicing_pgdata:/var/lib/postgresql/data \
  -p 5432:5432 \
  postgres:16
```

`invoicing_pgdata` is a **named volume**. Docker creates and manages it. Remove
the container, start a new one with the same `-v`, and every row is still there.
Without it, every `docker rm` wipes your local database and you re-run
migrations and seeds from scratch.

```bash
docker volume ls
```

```text
DRIVER    VOLUME NAME
local     invoicing_pgdata
```

`local` means the volume lives on this machine's own disk. The listing shows no
sizes; `docker system df -v` does.

### Case 2: mounting your source for hot reload

```bash
docker run -d --name api-dev \
  -p 3333:3333 \
  -v "$(pwd)/src:/app/src" \
  invoicing-api:dev
```

`$(pwd)/src:/app/src` is a **bind mount**: a real directory on your machine,
mapped into the container. Edit a file in your editor and the container sees it
instantly, so a watcher like `tsx watch` restarts the app without a rebuild.

Same left-to-right rule as ports: **host path first, container path second.**

> **⚠️ Warning:** bind-mounting your whole project directory, not just `src`,
> causes the `node_modules` masking problem. Mounting a host directory over a
> container directory hides what was underneath. The full explanation and the
> standard fix are in
> [03-compose-for-local-development-part-2.md](./03-compose-for-local-development-part-2.md),
> because that is where you will actually hit it.

## Container Networking

Two containers on the same Docker network reach each other by **container
name**. That is the whole mechanism, and it replaces every hardcoded IP address
you might be tempted to write.

```bash
docker network create invoicing-net

docker run -d --name postgres --network invoicing-net \
  -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=invoicing postgres:16

docker run -d --name api --network invoicing-net -p 3333:3333 \
  -e DATABASE_URL=postgres://postgres:secret@postgres:5432/invoicing \
  invoicing-api:1.4.0
```

The hostname `postgres` in that connection string is the container's name.
Docker runs a small DNS (Domain Name System) server on each network you create.
It turns container names into their current IP addresses.

Note that Postgres has **no `-p`**. The API reaches it over the Docker network,
not through the host. Publishing 5432 is only needed if you want to connect from
a GUI client on your laptop.

### localhost inside a container means that container

This is the second half of the `127.0.0.1` lesson from Part 1. Almost everyone
meets it once.

```bash
# ❌ BROKEN - "localhost" is the API container itself, where nothing listens on 5432
-e DATABASE_URL=postgres://postgres:secret@localhost:5432/invoicing
```

```bash
# ✅ FIXED - the Postgres container's name, resolved by Docker's DNS
-e DATABASE_URL=postgres://postgres:secret@postgres:5432/invoicing
```

```text
            HOST MACHINE (your laptop)
  ┌───────────────────────────────────────────────┐
  │  localhost:3333 ──┐                           │
  │                   │  published port           │
  │   ┌───────────────▼─────────┐  ┌───────────┐  │
  │   │ container: api          │  │ container │  │
  │   │  localhost = api itself │  │ postgres  │  │
  │   │  postgres  = ───────────┼─▶│ :5432     │  │
  │   └─────────────────────────┘  └───────────┘  │
  │            invoicing-net (Docker DNS)         │
  └───────────────────────────────────────────────┘
```

Three different meanings of "localhost" exist at the same time:

| Where you are | `localhost` means | To reach Postgres, use |
|---|---|---|
| Your laptop's terminal | Your laptop | `localhost:5432`, only if 5432 is published |
| Inside the `api` container | The `api` container | `postgres:5432` |
| Inside the `postgres` container | The `postgres` container | `localhost:5432` |

The broken version fails with `ECONNREFUSED 127.0.0.1:5432`. The `127.0.0.1` in
that message is the clue: the app tried to connect to itself.

> **💡 Tip:** containers on the **default bridge** network do *not* get name
> resolution. You must create a network, or use Compose, which creates one for
> you. If name lookups fail, check `docker inspect api` for the network it is
> actually attached to.

### Reaching the host from inside a container

Occasionally you need the opposite: code in a container calling something
running directly on your laptop.

```bash
docker run --rm --add-host=host.docker.internal:host-gateway \
  invoicing-api:1.4.0 node -e "fetch('http://host.docker.internal:9000/')"
```

`host.docker.internal` resolves to the host. On Docker Desktop it exists
already; on Linux you add it with `--add-host` as above.

## Resource Limits and Exit Code 137

By default a container can use **all** of your machine's memory and CPU. One
runaway query that loads 400,000 invoice rows into memory does not only kill
the container. It freezes the whole laptop.

```bash
docker run -d --name api \
  --memory=512m \
  --memory-reservation=256m \
  --cpus=1.5 \
  -p 3333:3333 invoicing-api:1.4.0
```

| Flag | Meaning |
|---|---|
| `--memory=512m` | Hard limit. Exceed it and the kernel kills the process |
| `--memory-reservation=256m` | Soft target the kernel tries to keep you under when the host is under pressure |
| `--cpus=1.5` | One and a half CPU cores' worth of time |

### What an out-of-memory kill looks like

```bash
docker ps -a
```

```text
CONTAINER ID   IMAGE                 STATUS                        NAMES
a3f91c7e2b4d   invoicing-api:1.4.0   Exited (137) 12 seconds ago   api
```

```bash
docker logs api --tail 5
```

```text
{"level":"info","msg":"request","method":"GET","path":"/invoices/export","status":200,"ms":18}
```

That is it. No stack trace, no error, no "out of memory" message. The last log
line is from a successful request.

The kernel's out-of-memory (OOM) killer ended the process with `SIGKILL`.
`SIGKILL` cannot be caught, so the process had no chance to write anything.

**137 = 128 + 9.** The 9 is `SIGKILL`. Confirm it was memory, not a manual kill:

```bash
docker inspect api --format '{{.State.OOMKilled}} {{.State.ExitCode}}'
```

```text
true 137
```

```mermaid
flowchart TD
    A[Container exited 137] --> B{OOMKilled is true?}
    B -->|yes| C[Kernel killed it for memory]
    C --> D[Raise --memory or fix the query that loads everything]
    B -->|no| E[Something outside sent SIGKILL]
    E --> F[docker kill, docker rm -f, or a failed graceful shutdown]
```

`true` means the kernel killed it for memory. `false` with 137 means something
else sent `SIGKILL`. That is a `docker kill`, a `docker rm -f`, or a platform
giving up on a container that ignored `SIGTERM`. It is the same reasoning as
reading an out-of-memory event in the host's own logs, covered in
[05-logs-disks-and-debugging-part-2.md](../01-linux-essentials/05-logs-disks-and-debugging-part-2.md).

> **⚠️ Warning:** Node does not read Docker's memory limit automatically in all
> versions. If you set `--memory=512m`, also set
> `NODE_OPTIONS=--max-old-space-size=384`, so that Node's JavaScript engine
> starts collecting garbage before the kernel starts killing. Check your Node
> version's behaviour.

## Cleaning Up

Docker never deletes anything on its own. Images, stopped containers, unused
volumes and build cache accumulate until a build fails with "no space left on
device".

```bash
docker system df
```

```text
TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          34        3         18.4GB    14.2GB (77%)
Containers      11        2         240MB     201MB (83%)
Local Volumes   7         2         3.1GB     2.4GB (77%)
Build Cache     219       0         9.8GB     9.8GB
```

Read the last two columns. `SIZE` is the total that type uses. `RECLAIMABLE` is
how much of it a prune would free, because nothing is using it right now.

`ACTIVE` is the count still in use: 3 images out of 34 here, which is why 77% of
the image space can go. Build cache is 100% reclaimable, so it is the safest
place to start.

Targeted cleanup, safest first:

```bash
docker container prune          # remove all stopped containers
docker image prune              # remove dangling images only (tagged <none>)
docker builder prune            # clear the build cache
docker image prune -a           # remove every image not used by a container
```

```bash
docker system prune
```

```text
WARNING! This will remove:
  - all stopped containers
  - all networks not used by at least one container
  - all dangling images
  - all build cache
Are you sure you want to continue? [y/N]
```

> **⚠️ Warning:** `docker system prune -a --volumes` also deletes **named
> volumes not currently attached to a running container**. If your Postgres
> container happens to be stopped at that moment, your local database goes with
> it. Read the warning text every time. There is no undo.

A dangling image is one that lost its tag because a newer build took the name.
Those are safe to remove. Removing *all* unused images with `-a` is also safe.
The cost is that your next build re-downloads every base layer, so expect it to
be slow.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Storing uploads on the container's local disk | They disappear on the next deploy and are invisible to other replicas | Object storage, with the key in the database |
| `localhost` in a connection string between containers | Resolves to the container itself, giving `ECONNREFUSED 127.0.0.1` | Use the other container's name |
| Expecting name resolution on the default bridge network | The default bridge has no DNS between containers | Create a network, or use Compose |
| Running Postgres without a named volume locally | Every `docker rm` wipes the database and the seeds | `-v invoicing_pgdata:/var/lib/postgresql/data` |
| No memory limit on a container | One runaway query takes the whole host down | `--memory` plus a matching `--max-old-space-size` |
| Reading exit 137 as an application crash | It is `SIGKILL` from outside, usually the OOM killer | Check `.State.OOMKilled` before debugging your code |
| `docker system prune -a --volumes` to free space | Can delete the volume holding your local database | Use `docker container prune` and `docker builder prune` first |

## Questions to Test Yourself

1. Your upload feature works perfectly for a week, then users report missing
   attachments every few days. What is the pattern you look for in the deploy
   times, and what is the fix?
2. An app container cannot reach Postgres. The connection error says
   `ECONNREFUSED 127.0.0.1:5432`. What does that specific IP tell you
   immediately?
3. What is the difference between a named volume and a bind mount, and which one
   do you use for your local Postgres data?
4. A container exits with 137 and the logs end mid-normal-operation. Which two
   causes are possible, and which command tells you which one it was?
5. Why does `-p 5432:5432` on the Postgres container make no difference to
   whether the API container can reach it?
6. You free up 20 GB with `docker system prune -a --volumes` and your local
   database is now empty. What exactly happened?
7. Your app logs show it listening, `docker ps` shows the port published, and
   another container still cannot reach it by name. What do you check first?

## Related

- [Part 1](./02-running-containers-locally-part-1.md) — the commands, the
  `docker run` flags, port publishing, and the `0.0.0.0` bind.
- [volumes.md](../../cloud-devops/docker/volumes.md) — named volumes, bind
  mounts and `tmpfs` in detail.
- [image-vs-container.md](../../cloud-devops/docker/image-vs-container.md) — the
  writable layer that makes containers ephemeral.
- [02-object-storage-and-serving-files.md](../../backend-fundamentals/12-files-and-integrations/02-object-storage-and-serving-files.md)
  — where uploaded files belong instead of the container.
- [05-logs-disks-and-debugging-part-1.md](../01-linux-essentials/05-logs-disks-and-debugging-part-1.md)
  — reading OOM events and disk pressure on the host itself.
- [03-compose-for-local-development-part-1.md](./03-compose-for-local-development-part-1.md)
  — the same networking and volumes, declared in one file instead of six flags.
