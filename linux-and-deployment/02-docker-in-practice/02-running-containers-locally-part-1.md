# Running Containers Locally — Part 1

You have an image. Now you need to run it, reach it from your browser, get a
shell inside it when it misbehaves, and read what it printed. That is this file.

A running container is like a sealed room inside a building. The room has its
own door numbers, its own post box and its own light switches. Nothing in the
room is reachable from the street until the building manager writes down which
street number leads to which room. `-p` is how you write that down, and a large
part of this file is that one idea.

There are about forty Docker subcommands. You will use nine of them every day
and never think about the rest. Part 1 covers those nine and the `docker run`
flags that cause the most confusion. It also covers the networking mistake that
costs people a whole afternoon the first time. An app that listens on
`127.0.0.1` inside a container is unreachable, no matter how you publish the
port.

> **📌 In one line:** `-p 8080:3333` maps *host* port to *container* port, and
> none of it works unless the process inside is listening on `0.0.0.0`.

## Table of Contents

1. [The Nine Commands](#the-nine-commands)
2. [docker run Flags in Depth](#docker-run-flags-in-depth)
3. [Port Publishing: Which Side Is Which](#port-publishing-which-side-is-which)
4. [The 127.0.0.1 Trap](#the-127001-trap)
5. [Getting Inside a Running Container](#getting-inside-a-running-container)
6. [Reading Logs](#reading-logs)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)
9. [Related](#related)

---

## The Nine Commands

A quick reference first, then each one with real output.

| Command | What it does |
|---|---|
| `docker build` | Turn a Dockerfile into an image |
| `docker run` | Start a new container from an image |
| `docker ps` | List running containers (`-a` for stopped ones too) |
| `docker logs` | Print what the container wrote to stdout and stderr |
| `docker exec` | Run a command inside an already-running container |
| `docker stop` | `SIGTERM`, then `SIGKILL` after 10 seconds |
| `docker rm` | Delete a stopped container |
| `docker images` | List local images |
| `docker rmi` | Delete a local image |

Those nine commands move a container between four states, or read something out
of it.

```mermaid
stateDiagram-v2
    [*] --> Created: docker run
    Created --> Running: the process starts
    Running --> Exited: the process ends, or docker stop
    Exited --> Running: docker start
    Exited --> [*]: docker rm
```

The state to remember is `Exited`. A container that died still exists on disk,
with its logs and its exit code, until you remove it.

### build

```bash
docker build -t invoicing-api:1.4.0 .
```

`-t` is the tag: `name:version`. The final `.` is the build context — the
directory sent to the Docker daemon, filtered by `.dockerignore`. Tag every
build. An untagged image shows up as `<none>` and you will not know what it was.

### run

```bash
docker run -d --name api -p 3333:3333 --env-file .env invoicing-api:1.4.0
```

```text
a3f91c7e2b4d8e105c9a7b3d2f1e8c04a9b7d6e5f4c3b2a1908f7e6d5c4b3a29
```

That long string is the container ID. You will almost never type it — use
`--name` and refer to the container by name.

### ps

```bash
docker ps
```

```text
CONTAINER ID   IMAGE                 COMMAND                  STATUS                 PORTS                    NAMES
a3f91c7e2b4d   invoicing-api:1.4.0   "node dist/server.js"    Up 3 minutes (healthy) 0.0.0.0:3333->3333/tcp   api
```

Two columns do the real work. `STATUS` says `Up 3 minutes (healthy)`: the
container has been running for three minutes and its `HEALTHCHECK` is passing.
`PORTS` says `0.0.0.0:3333->3333/tcp`: host port 3333 forwards to container port
3333, over TCP.

If `PORTS` is empty, nothing is published, and no browser on your laptop can
reach the app.

```bash
docker ps -a        # includes stopped and exited containers
```

```text
CONTAINER ID   IMAGE                 STATUS                        NAMES
a3f91c7e2b4d   invoicing-api:1.4.0   Up 3 minutes (healthy)        api
8b2c4d6e1f90   invoicing-api:1.3.2   Exited (137) 2 hours ago      api-old
```

`docker ps -a` is the first command to run when something "did not start". A
container that exited still exists and still has its logs. The number inside
`Exited (137)` is the exit code. 137 means the process was killed from outside,
which Part 2 explains.

### logs

```bash
docker logs api            # everything so far
docker logs -f api         # follow, like tail -f
docker logs --tail 50 api  # last 50 lines only
docker logs --since 10m api
```

### exec

```bash
docker exec -it api sh
```

`-i` keeps stdin open, `-t` allocates a terminal. Together they give you an
interactive shell. Without them the command runs and returns immediately.

### stop, rm, images, rmi

```bash
docker stop api            # graceful: SIGTERM, then SIGKILL after 10s
docker stop -t 30 api      # give it 30 seconds instead
docker rm api              # delete the stopped container
docker rm -f api           # stop and delete in one step (SIGKILL, no grace)
```

```bash
docker images
```

```text
REPOSITORY      TAG     IMAGE ID       CREATED        SIZE
invoicing-api   1.4.0   3f8a1c0d9e22   2 hours ago    268MB
invoicing-api   1.3.2   91ff02ad7c61   3 days ago     265MB
postgres        16      d4e7c1b89a03   2 weeks ago    432MB
```

`REPOSITORY` and `TAG` are the two halves of the name you passed to `-t`.
`IMAGE ID` is the real identity, and two tags can point at the same ID. `SIZE`
is the uncompressed size on disk. Images that share base layers do not each pay
for those layers, so the column does not add up to your disk usage.

```bash
docker rmi invoicing-api:1.3.2
```

> **⚠️ Warning:** `docker rm -f` sends `SIGKILL` immediately. Your `SIGTERM`
> handler never runs. Use `docker stop` when you care about a clean shutdown,
> and `rm -f` only for throwaway containers.

## docker run Flags in Depth

These are the flags that cause the most confusion.

| Flag | Meaning | Typical use |
|---|---|---|
| `-d` | Detached. Start it and return the shell | Anything long-running |
| `-p host:container` | Publish a container port on a host port | Reaching the app from your browser |
| `-e KEY=value` | Set one environment variable | A quick override |
| `--env-file path` | Load many variables from a file | Your normal local config |
| `-v name:/path` | Mount a volume or host directory | Database data, source for hot reload |
| `--name api` | Give the container a stable name | Always |
| `--rm` | Delete the container automatically when it exits | One-off commands, foreground runs |
| `--network app-net` | Attach to a named network | Letting containers reach each other |

### -d and when not to use it

```bash
docker run -d --name api -p 3333:3333 invoicing-api:1.4.0   # detached
docker run --rm -p 3333:3333 invoicing-api:1.4.0            # foreground, logs on screen
```

Run it in the **foreground** the first time you try a new image. You see the
logs immediately and `Ctrl+C` stops it. Switch to `-d` once it works.

### -e and --env-file

```bash
docker run -d --name api \
  --env-file .env \
  -e LOG_LEVEL=debug \
  invoicing-api:1.4.0
```

`-e` after `--env-file` wins, which makes it useful for one-off overrides.

The `.env` file format is plain `KEY=value` lines. Two things surprise people:

- **No quotes are stripped.** `PASSWORD="abc"` sets the password to `"abc"`
  including the quote characters.
- **No shell expansion.** `DATABASE_URL=postgres://user:${PASS}@db/app` is
  passed through literally, `${PASS}` and all.

Check what the container actually received:

```bash
docker exec api env | sort
```

```text
DATABASE_URL=postgres://invoicing:secret@postgres:5432/invoicing
LOG_LEVEL=debug
NODE_ENV=production
PORT=3333
```

> **💡 Tip:** this one command answers "is the variable actually set?", which is
> the cause of a large share of "it works locally" problems.

## Port Publishing: Which Side Is Which

`-p 8080:3333`.

```text
-p 8080:3333
   ^^^^ ^^^^
   |    └─ CONTAINER port — where the app inside is listening
   └────── HOST port — what you type in your browser
```

**Host first. Container second.** The rule to remember: it reads left to right
in the direction traffic travels — from your machine, into the container.

```bash
docker run -d -p 8080:3333 invoicing-api:1.4.0
curl http://localhost:8080/health/ready     # host port 8080
```

The container port is fixed by your app — it is whatever `server.listen()` was
given. The host port is yours to choose. You can run three versions at once:

```bash
docker run -d --name api-1 -p 3001:3333 invoicing-api:1.4.0
docker run -d --name api-2 -p 3002:3333 invoicing-api:1.3.2
docker run -d --name api-3 -p 3003:3333 invoicing-api:1.2.0
```

Three containers, same container port, three different host ports. Swap the
order by mistake and you get `-p 3333:8080`. That forwards host 3333 to
container 8080, where nothing is listening. You get a connection refused, and
the error never mentions that the two numbers are swapped.

Other forms:

```bash
-p 3333:3333              # all host interfaces (reachable from your network)
-p 127.0.0.1:3333:3333    # host loopback only — safer on a shared network
-p 3333:3333/udp          # UDP instead of TCP
```

The host-side binding question is the same one as in
[04-networking-ports-and-firewalls-part-1.md](../01-linux-essentials/04-networking-ports-and-firewalls-part-1.md),
just applied to the Docker proxy rather than your own process.

## The 127.0.0.1 Trap

This one section can save you an afternoon.

Your app has always listened on `localhost`. That is correct and safe on your
laptop. Put it in a container and it becomes unreachable.

The symptom is confusing. `docker ps` shows the port published, the container is
healthy, and the logs say the server started. Then `curl` says connection
reset.

```ts
// ❌ BROKEN - listens on the CONTAINER's loopback only
server.listen(3333, '127.0.0.1')
```

```ts
// ✅ FIXED - listens on every interface the container has
server.listen(3333, '0.0.0.0')
```

### Why

A container has its own network namespace: its own interfaces, its own
loopback, its own IP. `127.0.0.1` inside the container is **the container's own
loopback**, not yours. It is a different interface on a different machine, as
far as the kernel is concerned.

```mermaid
flowchart TD
    A[Your browser on the host] --> B[Host port 3333]
    B --> C[Docker forwards to the container's eth0]
    C --> D{App bound to what?}
    D -->|0.0.0.0| E[eth0 accepts: request served]
    D -->|127.0.0.1| F[eth0 has no listener: connection reset]
```

Docker forwards traffic to the container's **eth0** interface, which is its
network card. If your process only listens on `lo`, the container's own
loopback, then nothing is listening on eth0. The connection is refused at the
last hop, after `docker ps` has already told you the port is published.

### Proving it from inside

```bash
docker exec -it api sh
ss -tulpn
```

Broken:

```text
Netid  State   Local Address:Port    Process
tcp    LISTEN  127.0.0.1:3333        users:(("node",pid=1,fd=20))
```

Fixed:

```text
Netid  State   Local Address:Port    Process
tcp    LISTEN  0.0.0.0:3333          users:(("node",pid=1,fd=20))
```

`127.0.0.1:3333` means loopback only. `0.0.0.0:3333` means every interface.
That one line is the whole diagnosis.

### Do it properly

```ts
// src/server.ts
const port = Number(process.env.PORT ?? 3333)
// Containers must bind every interface. Keep it configurable so a bare-metal
// deploy behind nginx on the same host can still bind loopback only.
const host = process.env.HOST ?? '0.0.0.0'

server.listen(port, host, () => {
  console.log(JSON.stringify({ level: 'info', msg: 'listening', host, port }))
})
```

> **📌 Remember:** "bind `0.0.0.0`" does not mean "exposed to the internet". The
> container's interfaces are still only reachable through whatever you published
> with `-p`. The host firewall decides who reaches that.

## Getting Inside a Running Container

```bash
docker exec -it api sh
```

```text
$ ls dist
server.js  app.js  controllers  services  repositories
$ node -e "console.log(process.env.DATABASE_URL)"
postgres://invoicing:secret@postgres:5432/invoicing
$ exit
```

Use `sh`, not `bash`. Alpine has no `bash`. `sh` exists in both Alpine and
Debian-based images, so it always works.

Three things to know:

**`exec` runs in an existing container.** `docker run` starts a new one. Run
`docker run -it invoicing-api:1.4.0 sh` and you get a shell in a *fresh*
container. Your app is not running inside it. This is a very common source of
"but the file is not there".

**Changes you make are temporary.** Editing a file inside a running container
changes only that container's writable layer, and it is gone when the container
is replaced. See
[image-vs-container.md](../../cloud-devops/docker/image-vs-container.md).

**Distroless images have no shell at all.**

```bash
docker exec -it api sh
```

```text
OCI runtime exec failed: exec: "sh": executable file not found in $PATH
```

That is not a broken container. It is a deliberately minimal image. The fix is
an ephemeral debug container that attaches to the same namespaces, covered in
[04-debugging-containers-part-2.md](./04-debugging-containers-part-2.md).

## Reading Logs

```bash
docker logs -f --tail 100 api
```

```text
{"level":"info","msg":"listening","host":"0.0.0.0","port":3333}
{"level":"info","msg":"request","method":"POST","path":"/invoices","status":201,"ms":34}
{"level":"error","msg":"stripe charge failed","invoiceId":"inv_8812","code":"card_declined"}
```

`docker logs` shows exactly one thing: what the container's PID 1 wrote to
**stdout** (standard output) and **stderr** (standard error). Nothing else.
That one rule has a consequence.

```ts
// ❌ BROKEN - writes to a file inside the container
const logger = pino(pino.destination('/app/logs/app.log'))
```

```ts
// ✅ FIXED - writes to stdout, where the platform collects it
const logger = pino()   // pino defaults to stdout
```

With the broken version, `docker logs api` prints nothing. The logs exist, but
inside the container's writable layer. When the container is replaced on the
next deploy, they are deleted — including the ones explaining why it crashed.

Writing to stdout hands the problem to the platform, which already solves it.
Docker captures the stream. Log drivers ship it somewhere. `docker logs`,
Compose and every orchestrator then read that one source.

Structured JSON on stdout is the format that makes all of this useful, and it is
covered in
[01-logging-basics.md](../../backend-fundamentals/08-logging-and-observability/01-logging-basics.md).

> **💡 Tip:** `docker logs` reads a file on the host that grows forever by
> default. On a long-running server, set `--log-opt max-size=10m --log-opt
> max-file=3` or the disk fills up quietly.

> **➡️ Continued in [Part 2](./02-running-containers-locally-part-2.md)** —
> ephemeral containers and lost uploads, volumes and bind mounts, container
> networking by name, memory and CPU limits, and cleaning up safely.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| `server.listen(3333, '127.0.0.1')` in a container | Only the container's own loopback is listening, so published traffic hits nothing | Bind `0.0.0.0` |
| `-p 3333:8080` when the app listens on 3333 | Host and container sides are swapped, so the host forwards to a port nothing is using | `-p 8080:3333` reads host first, container second |
| `docker run` when you meant `docker exec` | You get a shell in a brand new container, not the one that is running | `docker exec -it <name> sh` |
| Logging to a file inside the container | `docker logs` shows nothing and the file dies with the container | Log JSON to stdout |
| Not using `--name` | You end up copying container IDs by hand and killing the wrong one | `--name api` on every run |
| `docker rm -f` on a container you care about | `SIGKILL` with no grace period, so in-flight requests are dropped | `docker stop`, then `docker rm` |
| Assuming `docker ps` showing a port means the app is reachable | Publishing is only the first of four hops | Check the bind address with `ss -tulpn` inside the container |

## Questions to Test Yourself

1. `docker ps` shows `0.0.0.0:3333->3333/tcp`, the container is healthy, and
   `curl localhost:3333` is refused. What is the next command you run, and what
   are you looking for in its output?
2. Explain in one sentence why `127.0.0.1` inside a container is not the same
   address as `127.0.0.1` on your laptop.
3. A colleague publishes an app that listens on 3333 with `-p 3333:8080`.
   `docker ps` shows a published port and `curl localhost:3333` is refused.
   Explain the mapping to them in two sentences.
4. Why does `docker run -it myimage sh` not help you debug a container that is
   already running and misbehaving?
5. A teammate says logging to `/app/logs/app.log` is fine because the file is
   persisted. What two things do you ask them?
6. `docker exec -it api sh` returns `executable file not found in $PATH`. What
   kind of image is this, and is anything actually broken?
7. What is the difference between `docker stop api` and `docker rm -f api` from
   your application's point of view?

## Related

- [Part 2](./02-running-containers-locally-part-2.md) — ephemeral filesystems,
  volumes, container-to-container networking, resource limits, cleanup.
- [04-networking-ports-and-firewalls-part-1.md](../01-linux-essentials/04-networking-ports-and-firewalls-part-1.md)
  — binding, listening and `ss` output, outside Docker.
- [01-a-dockerfile-for-node-part-2.md](./01-a-dockerfile-for-node-part-2.md) —
  the `SIGTERM` handling that makes `docker stop` clean.
- [01-logging-basics.md](../../backend-fundamentals/08-logging-and-observability/01-logging-basics.md)
  — why stdout, and what to put in each line.
- [image-vs-container.md](../../cloud-devops/docker/image-vs-container.md) — the
  writable layer that makes edits inside a container temporary.
- [overview.md](../../cloud-devops/docker/overview.md) — the command reference
  this file expands on.
