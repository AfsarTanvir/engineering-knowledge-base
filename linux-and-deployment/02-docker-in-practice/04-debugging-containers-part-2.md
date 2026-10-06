# Debugging Containers — Part 2

> **⬅️ This continues [Part 1](./04-debugging-containers-part-1.md).**

Part 1 handled the container that will not start, the build that will not
finish, and the app you cannot reach. This part handles the slower ones, where
the symptom and the cause sit far apart. The app cannot reach its database. The
image refuses to start on the server. A mounted directory is suddenly read-only.
The image you shipped is 1.4 GB.

Then the tools — `inspect`, `diff`, `history` — and debugging an image with no
shell.

> **📌 In one line:** when the container itself is fine, the problem is almost
> always the network name, the CPU architecture, or a user ID — and each has a
> command that proves it in one line.

## Table of Contents

1. [It Cannot Reach the Database](#it-cannot-reach-the-database)
2. [It Works On My Machine But Not On The Server](#it-works-on-my-machine-but-not-on-the-server)
3. [Permission Denied On A Mounted Volume](#permission-denied-on-a-mounted-volume)
4. [inspect, diff and Stopped Containers](#inspect-diff-and-stopped-containers)
5. [Why Is This Image So Big](#why-is-this-image-so-big)
6. [Debugging An Image With No Shell](#debugging-an-image-with-no-shell)
7. [Common Mistakes](#common-mistakes)
8. [Questions to Test Yourself](#questions-to-test-yourself)
9. [Related](#related)

---

## It Cannot Reach the Database

```text
api-1 | Error: connect ECONNREFUSED 127.0.0.1:5432
api-1 | Error: getaddrinfo ENOTFOUND postgres
api-1 | Error: connect ETIMEDOUT 10.0.3.14:5432
api-1 | error: password authentication failed for user "invoicing"
```

Four different messages, four different causes. Read the message before doing
anything else — it narrows the problem to one of four checks.

```mermaid
flowchart TD
    A[Connection error] --> B{Which message?}
    B -->|ECONNREFUSED 127.0.0.1| C[Wrong hostname: localhost means this container]
    B -->|ENOTFOUND| D[Name does not resolve: wrong network or wrong service name]
    B -->|ETIMEDOUT| E[Packets dropped: firewall or security group]
    B -->|authentication failed| F[Credentials or database name mismatch]
```

**Check 1 — the hostname.**

```bash
# ❌ BROKEN - the api container dials itself
DATABASE_URL=postgres://invoicing:localdev@localhost:5432/invoicing
```

```bash
# ✅ FIXED - the database service's name on the Docker network
DATABASE_URL=postgres://invoicing:localdev@postgres:5432/invoicing
```

A `127.0.0.1` in the error message is the proof. Nothing else produces it.

**Check 2 — the same network.**

```bash
docker inspect api --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'
docker inspect postgres --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'
```

```text
invoicing_default
bridge
```

Different networks. The name cannot resolve, so you get `ENOTFOUND`. Containers
on the **default bridge** get no DNS between them at all. Attach both to the
same user-defined network, or let Compose do it.

**Check 3 — readiness, not just existence.**

```bash
docker compose ps
```

```text
NAME         IMAGE         STATUS                    PORTS
postgres-1   postgres:16   Up 3 seconds (starting)   5432/tcp
```

`(starting)` means the healthcheck has not passed yet. This is the
`depends_on` problem from
[03-compose-for-local-development-part-1.md](./03-compose-for-local-development-part-1.md),
and it is intermittent by nature.

**Check 4 — prove it from inside the container.**

This check gives a definite answer, so nobody has to guess.

```bash
docker compose exec api sh
```

```text
$ getent hosts postgres
172.19.0.3      postgres

$ node -e "require('net').connect(5432,'postgres').on('connect',()=>{console.log('tcp ok');process.exit(0)}).on('error',e=>{console.log(e.code);process.exit(1)})"
tcp ok
```

Name resolves and TCP connects, so the network is fine and the problem is
credentials or the database name. If you have `psql` available:

```bash
docker compose exec postgres psql -U invoicing -d invoicing -c "select current_database(), current_user;"
```

> **💡 Tip:** test from the **app** container, not from your laptop. Your laptop
> reaches Postgres through a published port; the app reaches it over the Docker
> network. They can succeed and fail independently.

## It Works On My Machine But Not On The Server

Containers were supposed to end that sentence for good. They did not. There are
four causes, and nobody expects the first one.

| Cause | Symptom on the server | How to confirm | Fix |
|---|---|---|---|
| **CPU architecture mismatch** | `exec format error`, or the container exits instantly with no logs | `docker image inspect <img> --format '{{.Architecture}}'` | Build for the target with `--platform` |
| Missing environment variable | `undefined` in a URL, or a config validation error at startup | `docker exec <name> env \| sort` | Set it, and fail fast at boot if it is absent |
| Different image tag | Old behaviour, old bugs, confusing logs | `docker inspect <name> --format '{{.Image}}'` and compare the digest | Deploy by digest, or never reuse a tag |
| Stale cached layer | The fix you shipped is not in the image | `docker history <img>` and check the dates | Rebuild the affected stage |

### The architecture mismatch

This is increasingly common and genuinely baffling the first time. An Apple
laptop builds **arm64** images by default. Most cloud servers are **amd64**
(also written `x86_64`). An arm64 image cannot run on an amd64 kernel.

```text
standard_init_linux.go:228: exec user process caused: exec format error
```

Or, just as often, there is no message at all. The container exits immediately
with an empty log, and you spend an hour reading application code for a bug that
is not there.

```bash
docker image inspect invoicing-api:1.4.0 --format '{{.Os}}/{{.Architecture}}'
```

```text
linux/arm64
```

```bash
# on the server
uname -m
```

```text
x86_64
```

There is the whole problem, in two commands.

```bash
# ❌ BROKEN - on an Apple laptop this produces an arm64 image
docker build -t invoicing-api:1.4.0 .
```

```bash
# ✅ FIXED - build explicitly for the architecture the server runs
docker build --platform linux/amd64 -t invoicing-api:1.4.0 .
```

For a build that runs everywhere, publish both:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t registry.example.com/invoicing-api:1.4.0 --push .
```

> **⚠️ Warning:** `--platform linux/amd64` on an arm64 laptop runs the build
> through emulation. It works, and it is slow — often several times slower.
> Building on a machine that is already `amd64`, such as your build server, is
> the better answer.

### Fail fast on missing configuration

```ts
// src/config.ts
function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  queueRedisUrl: required('QUEUE_REDIS_URL'),
  jwtSecret: required('JWT_SECRET'),
} as const
```

A container that refuses to start with one clear line beats a container that
runs for ten minutes and then writes `undefined` into an invoice.

## Permission Denied On A Mounted Volume

```text
Error: EACCES: permission denied, open '/app/uploads/inv_8812.pdf'
```

Your app runs as `node`, which is user ID (UID) 1000, from
[01-a-dockerfile-for-node-part-2.md](./01-a-dockerfile-for-node-part-2.md). The
host directory you bind-mounted is owned by a different UID. Both sides see the
**same numbers** but map them to different names. Linux checks the number, not
the name, and the container has no idea what your host calls UID 1000.

```bash
ls -ldn ./uploads
```

```text
drwxr-xr-x 2 0 0 4096 Oct  4 11:02 ./uploads
```

`-n` prints owner numbers instead of names, which is what matters here. The two
`0`s are the owner UID and the group ID: root created the directory, probably
because an earlier container ran as root. The `node` user cannot write there.

```bash
docker compose exec api id
```

```text
uid=1000(node) gid=1000(node)
```

Three fixes, in order of preference:

```bash
# ✅ Best: make the host directory match the container's UID
sudo chown -R 1000:1000 ./uploads
```

```yaml
# ✅ Also good: run the container as your own host user
  api:
    user: "${UID:-1000}:${GID:-1000}"
```

```bash
# ⚠️ Last resort: 777 on a development directory only. Never on a server.
chmod -R 777 ./uploads
```

The second option needs `UID` and `GID` exported in your shell (`export
UID=$(id -u)`), because Compose does not read them automatically.

> **📌 Remember:** this is ordinary Linux file permissions, not a Docker
> feature. The background is in
> [03-users-permissions-and-ssh-part-1.md](../01-linux-essentials/03-users-permissions-and-ssh-part-1.md).
> Named volumes mostly avoid the problem because Docker initialises their
> ownership from the image; bind mounts keep whatever the host already had.

## inspect, diff and Stopped Containers

A stopped container is still a complete record. Do not delete it until you have
read it.

```bash
docker logs api                  # still works after it exited
docker inspect api               # ~200 lines of JSON
docker cp api:/app/logs/out.log ./out.log   # copy files out of a dead container
```

`docker inspect` output is long. These are the fields that answer real questions:

| Query | Command |
|---|---|
| Why did it stop? | `--format '{{.State.ExitCode}} {{.State.OOMKilled}} {{.State.Error}}'` |
| What command is it running? | `--format '{{.Config.Cmd}} {{.Config.Entrypoint}}'` |
| What environment did it get? | `--format '{{range .Config.Env}}{{println .}}{{end}}'` |
| Which image exactly? | `--format '{{.Image}}'` |
| Which networks? | `--format '{{json .NetworkSettings.Networks}}'` |
| What is mounted where? | `--format '{{json .Mounts}}'` |
| Which user? | `--format '{{.Config.User}}'` |
| Health check result | `--format '{{json .State.Health}}'` |

```bash
docker inspect api --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -i database
```

```text
DATABASE_URL=postgres://invoicing:localdev@localhost:5432/invoicing
```

There is the bug, visible in one line: `localhost` where `postgres` belongs.

### docker diff

`docker diff` lists every change a running container made to its filesystem,
relative to the image.

```bash
docker diff api
```

```text
C /app
A /app/uploads
A /app/uploads/inv_8812.pdf
C /tmp
A /tmp/pdf-render-9912.tmp
```

`A` added, `C` changed, `D` deleted. Two uses:

- **Finding writes you did not know about.** Files appearing under `/app` are
  files that vanish on the next deploy. That list is your "what am I storing in
  the writable layer" audit.
- **Finding what is filling the disk.** A `D` on a file you expected, or a
  growing temp directory, both show up here.

## Why Is This Image So Big

```bash
docker images invoicing-api
```

```text
REPOSITORY      TAG     SIZE
invoicing-api   1.4.0   1.41GB
```

```bash
docker history invoicing-api:1.4.0
```

```text
IMAGE          CREATED BY                                      SIZE
3f8a1c0d9e22   CMD ["node" "dist/server.js"]                   0B
<missing>      COPY /app/dist ./dist # buildkit                 2.1MB
<missing>      RUN apt-get update && apt-get install -y buil…   684MB
<missing>      COPY . . # buildkit                              498MB
<missing>      RUN npm ci --omit=dev                            204MB
<missing>      /bin/sh -c #(nop) ADD file:... in /              74.8MB
```

Read it bottom to top — that is build order. Two lines explain almost all of it:

- `RUN apt-get install` added 684 MB of build tooling that the runtime does not
  need. It belongs in the builder stage, or it needs
  `--no-install-recommends` and `rm -rf /var/lib/apt/lists/*` in the same
  `RUN`.
- `COPY . .` added 498 MB, which means `node_modules` or `.git` came along —
  a `.dockerignore` problem.

| Cause | Typical cost | Fix |
|---|---|---|
| Dev dependencies in the final image | 200–400 MB | Multi-stage build, `npm ci --omit=dev` |
| Build toolchain in the runtime stage | 400–700 MB | Install it in the builder stage only |
| `apt-get` lists left behind | 40–60 MB | `rm -rf /var/lib/apt/lists/*` in the same `RUN` |
| `.git` or `node_modules` copied in | Varies, often huge | `.dockerignore` |
| npm cache | 50–200 MB | `npm cache clean --force` in the same `RUN` |

Each `RUN` is its own layer. Cleaning up in a *later* `RUN` shrinks nothing,
because the bytes are already committed in the earlier layer. Clean up inside
the same instruction that created the files.

## Debugging An Image With No Shell

```bash
docker exec -it api sh
```

```text
OCI runtime exec failed: exec: "sh": executable file not found in $PATH
```

Distroless and `scratch` images contain no shell, no `ls`, no package manager.
That is the point: there is nothing there for an attacker to use either.

### Attach a debug container to the same namespaces

```bash
docker run -it --rm \
  --pid=container:api \
  --network=container:api \
  nicolaka/netshoot
```

```text
 netshoot  ~  ss -tulpn
Netid State  Local Address:Port   Process
tcp   LISTEN 0.0.0.0:3333         users:(("node",pid=1,fd=20))

 netshoot  ~  ps aux
PID   USER     COMMAND
1     1000     node dist/server.js

 netshoot  ~  curl -s localhost:3333/health/ready
{"status":"ok","database":"ok"}
```

The debug image joins the target container's **process** and **network**
namespaces. You see its processes and its network as if you were inside it, with
every tool you wanted, and the target image stays minimal.

`--network=container:api` alone is enough for networking questions, and is the
fastest way to answer "can this container reach the database" without modifying
anything.

> **💡 Tip:** `docker debug` exists in recent Docker Desktop versions and
> attaches a toolbox to any container, including distroless. Check whether your
> version has it before setting up the manual approach.

### Keep a debug variant of your image

Build a second tag from the same Dockerfile, with a shell and tools inside.
Swap it in when something goes wrong.

```dockerfile
FROM gcr.io/distroless/nodejs22-debian12 AS runner
COPY --from=builder /app/dist ./dist
CMD ["dist/server.js"]

# Same application, with a shell. Never the default deploy target.
FROM node:22-slim AS runner-debug
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/server.js"]
```

```bash
docker build --target runner       -t invoicing-api:1.4.0 .
docker build --target runner-debug -t invoicing-api:1.4.0-debug .
```

Deploy `1.4.0`. When you need to look inside, run `1.4.0-debug` from the same
commit. Same code, same dependencies, one has a shell.

> **⚠️ Warning:** the debug variant is a bigger attack surface. Tag it clearly,
> never set it as the default, and do not leave one running in production after
> you have finished.

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Debugging connectivity from your laptop | Your laptop uses a published port, the app uses the Docker network | Run the test from inside the app container |
| Ignoring `exec format error` | It is an architecture mismatch, not a code bug | `docker image inspect` the architecture, rebuild with `--platform` |
| `chmod 777` as the first fix for `EACCES` | Hides the UID mismatch and is unsafe anywhere real | `chown` the host directory to the container's UID |
| Deleting a failed container before inspecting it | Logs, exit code, env and filesystem diff all go with it | `logs`, `inspect`, `diff`, `cp` first |
| Cleaning up files in a later `RUN` to shrink an image | The bytes are already committed to the earlier layer | Clean up inside the same `RUN` |
| Assuming the same tag means the same image | Tags get overwritten | Compare digests with `docker inspect` |
| Adding a shell to a distroless image to debug it | Throws away the reason you chose it | Attach a debug container to its namespaces |

## Questions to Test Yourself

1. Your app logs `ECONNREFUSED 127.0.0.1:5432`. Which of the four causes is it,
   and how do you know without running anything?
2. A container built on a MacBook exits instantly on the server with empty logs.
   What are the two commands that confirm the cause in under a minute?
3. Explain why `chmod 777` "fixes" a volume permission error and why it is still
   the wrong fix.
4. A container exited two hours ago. Name four things you can still learn from
   it before you delete it.
5. `docker history` shows a 684 MB layer from `apt-get install`. Where should
   that instruction have been, and why does a later `apt-get clean` not help?
6. How do you check which port a distroless container is listening on, given
   that it has no shell and no `ss`?
7. What does `docker diff` tell you about data your app will lose on the next
   deploy?

## Related

- [Part 1](./04-debugging-containers-part-1.md) — exit codes, build failures,
  and the "cannot reach it" checklist.
- [03-users-permissions-and-ssh-part-1.md](../01-linux-essentials/03-users-permissions-and-ssh-part-1.md)
  — the UID and GID model behind every volume permission error.
- [04-networking-ports-and-firewalls-part-1.md](../01-linux-essentials/04-networking-ports-and-firewalls-part-1.md)
  — refused versus timed out, and reading `ss` output on the host.
- [01-a-dockerfile-for-node-part-2.md](./01-a-dockerfile-for-node-part-2.md) —
  the multi-stage structure the image-size section keeps pointing back to.
- [03-compose-for-local-development-part-1.md](./03-compose-for-local-development-part-1.md)
  — healthchecks and readiness, which cause half the database errors here.
- [image-vs-container.md](../../cloud-devops/docker/image-vs-container.md) — the
  writable layer that `docker diff` is showing you.
