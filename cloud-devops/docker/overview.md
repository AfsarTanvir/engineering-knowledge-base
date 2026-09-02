# Docker

Docker packages an application with everything it needs to run — code,
runtime, libraries, system dependencies — into a single unit that behaves
the same on a developer's laptop, a CI runner, and a production server.
The problem it solves is "it works on my machine" — by making "my
machine" irrelevant to whether the application runs correctly.

## Table of Contents

1. [The Problem Docker Solves](#the-problem-docker-solves)
2. [Containers vs Virtual Machines](#containers-vs-virtual-machines)
3. [The Dockerfile](#the-dockerfile)
4. [Layers and the Build Cache](#layers-and-the-build-cache)
5. [Multi-Stage Builds](#multi-stage-builds)
6. [Basic Commands](#basic-commands)
7. [Docker Compose: Running Multiple Containers Together](#docker-compose-running-multiple-containers-together)
8. [Quick Reference](#quick-reference)

---

## The Problem Docker Solves

Before containers, "deploying an app" meant ensuring the target machine
had the right language runtime version, the right system libraries, the
right environment variables — and that nothing else on that machine
conflicted with any of it. Docker packages all of that into an image, so
"does this run correctly" stops depending on what else is installed on
the host.

```
Without Docker: app depends on the host having Python 3.11, libpq-dev,
                 specific env vars set correctly, no conflicting versions
                 of anything else installed system-wide

With Docker: app + Python 3.11 + libpq-dev + env vars, all bundled into
             one image — the host only needs Docker itself installed
```

## Containers vs Virtual Machines

A VM virtualizes an entire machine, including its own OS kernel — heavy,
but fully isolated. A container shares the host's kernel and only
isolates the process and its filesystem view — much lighter, starts in
milliseconds instead of minutes, but with a thinner isolation boundary
(more on the concept split between images and containers in
[image-vs-container.md](image-vs-container.md)):

```
VM:        [ Hardware ] -> [ Hypervisor ] -> [ Full Guest OS ] -> [ App ]
                                              (own kernel, GBs of overhead)

Container: [ Hardware ] -> [ Host OS + Kernel ] -> [ Container: App + deps only ]
                            (shared kernel, MBs of overhead)
```

## The Dockerfile

A Dockerfile is a recipe for building an image — a sequence of
instructions describing what goes into it:

```dockerfile
FROM python:3.11-slim              # start from a base image

WORKDIR /app                        # set the working directory inside the image

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt   # install dependencies

COPY . .                            # copy the rest of the application code

EXPOSE 8000                         # document which port the app listens on

CMD ["python", "app.py"]            # the command that runs when a container starts
```

```bash
docker build -t myapp:1.0 .         # build an image from this Dockerfile
docker run -p 8000:8000 myapp:1.0   # run a container from that image
```

## Layers and the Build Cache

Each instruction in a Dockerfile creates a new filesystem layer, cached
independently. Docker reuses a cached layer if nothing that would affect
it has changed — this is why instruction *order* in a Dockerfile matters
for build speed:

```dockerfile
# Good order: dependencies (change rarely) before app code (changes often)
COPY requirements.txt .
RUN pip install -r requirements.txt   # cached as long as requirements.txt is unchanged
COPY . .                               # only this layer rebuilds when code changes
```

```dockerfile
# Bad order: copying everything first invalidates the dependency-install
# cache on every single code change, even a one-line fix
COPY . .
RUN pip install -r requirements.txt   # re-runs on EVERY build, even for unrelated code changes
```

Putting the least-frequently-changing steps first (base image, system
packages, dependency installation) and the most-frequently-changing step
last (application source code) keeps rebuilds fast during everyday
development.

## Multi-Stage Builds

Compiling/building an application often needs tools (compilers, build
dependencies) that the final running image shouldn't carry — multi-stage
builds let you use one stage to build, and copy only the final artifact
into a clean, minimal final image:

```dockerfile
# Stage 1: build
FROM golang:1.21 AS builder
WORKDIR /app
COPY . .
RUN go build -o server .

# Stage 2: final image — no Go toolchain, just the compiled binary
FROM alpine:3.19
COPY --from=builder /app/server /usr/local/bin/server
CMD ["server"]
```

The final image only contains `alpine` plus the compiled binary — not
the entire Go toolchain, which can be hundreds of MBs. Smaller images
pull faster, start faster, and have a smaller attack surface.

## Basic Commands

```bash
docker build -t myapp:1.0 .          # build an image from a Dockerfile
docker images                         # list local images
docker run -d -p 8080:80 myapp:1.0    # run a container, detached, port-mapped
docker ps                              # list running containers
docker logs <container_id>             # view a container's stdout/stderr
docker exec -it <container_id> bash    # get a shell inside a running container
docker stop <container_id>             # stop a running container
docker rm <container_id>               # remove a stopped container
docker rmi myapp:1.0                   # remove an image
```

## Docker Compose: Running Multiple Containers Together

Real applications are rarely one container — a web app usually needs a
database, maybe a cache, maybe a background worker. Compose defines
multiple services and their relationships in one file:

```yaml
# docker-compose.yml
services:
  web:
    build: .
    ports:
      - "8000:8000"
    depends_on:
      - db
      - redis
    environment:
      - DATABASE_URL=postgresql://db:5432/myapp

  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data   # see volumes.md for why this matters

  redis:
    image: redis:7

volumes:
  pgdata:
```

```bash
docker compose up -d      # start everything defined in the file
docker compose down       # stop and remove everything
```

This is primarily a local-development and simple-deployment tool —
production multi-container orchestration at scale is what
[Kubernetes](../kubernetes/pod.md) is for.

---

## Quick Reference

| Task                                          | Command / concept                        |
| :-------------------------------------------------- | :----------------------------------------------- |
| Build an image from a Dockerfile                       | `docker build -t name:tag .`                        |
| Run a container from an image                          | `docker run image:tag`                               |
| Speed up rebuilds                                       | Order Dockerfile instructions least-to-most-changing   |
| Keep final image small                                  | Multi-stage build                                       |
| Run app + database + cache together locally              | Docker Compose                                            |
| Persist data across container restarts                    | Volumes — see [volumes.md](volumes.md)                       |

**Bottom line:** a Dockerfile describes how to build an image; instruction
order determines build-cache efficiency; multi-stage builds keep the
final image lean. Compose handles simple multi-container setups —
production-scale orchestration is Kubernetes' job.
