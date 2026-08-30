# Docker Image vs Container

"Image" and "container" get used almost interchangeably in casual
conversation, but the distinction is exactly the class-vs-instance
relationship from object-oriented programming: an image is a blueprint,
a container is a running (or stopped) instance of that blueprint. One
image can produce any number of independent containers.

## Table of Contents

1. [The Core Distinction](#the-core-distinction)
2. [What's Actually in an Image](#whats-actually-in-an-image)
3. [What Changes When You Run a Container](#what-changes-when-you-run-a-container)
4. [The Writable Layer](#the-writable-layer)
5. [One Image, Many Containers](#one-image-many-containers)
6. [Container Lifecycle](#container-lifecycle)
7. [Quick Reference](#quick-reference)

---

## The Core Distinction

```
Image:      a read-only template — layered filesystem + metadata
            (what the app is, before anything runs)

Container:  a running instance of an image — the image's filesystem,
            plus a writable layer on top, plus an actual running process
            (the app, actually executing)
```

```bash
docker images        # lists templates — nothing is running
docker ps             # lists running instances — actual live processes
docker ps -a          # lists ALL instances, including stopped ones
```

Analogy: an image is like a class definition; a container is like an
object instantiated from that class. `docker run myapp:1.0` is
conceptually `new Container(myapp_1_0)` — and you can call it as many
times as you want, getting independent instances each time.

## What's Actually in an Image

An image is a stack of read-only layers (see the build-cache discussion
in [overview.md](overview.md)) plus metadata — the default command to
run, exposed ports, environment variable defaults:

```bash
docker inspect myapp:1.0   # shows layers, config, exposed ports, etc.
docker history myapp:1.0   # shows each layer and the instruction that created it
```

Images are identified by name:tag (`myapp:1.0`) and, underlying that, a
content-addressable hash (a `sha256:...` digest) — the same image content
always produces the same digest, which is how Docker knows whether a
layer is already cached locally or needs pulling.

## What Changes When You Run a Container

`docker run` takes an image and adds exactly what's needed to actually
execute it:

- **A writable layer** on top of the image's read-only layers
- **A process** — the command specified by `CMD`/`ENTRYPOINT` (or
  overridden at `docker run` time), actually running
- **Its own network namespace** — its own IP inside Docker's network,
  its own view of ports
- **A container ID** — a unique identifier for this specific running
  instance, distinct from the image it was created from

```bash
docker run -d --name web1 myapp:1.0
docker run -d --name web2 myapp:1.0
# web1 and web2 are two independent containers, same image, separate
# processes, separate writable layers, separate container IDs
```

## The Writable Layer

Any file changes a running container makes (writing a log file, creating
a temp file, modifying a config at runtime) go into that container's own
writable layer — **not** back into the shared, read-only image:

```
Image layers (read-only, shared across every container from this image):
  [ base OS ] [ dependencies ] [ app code ]

Container's writable layer (unique to THIS container):
  [ any file changes made while running ]
```

This is why stopping and removing a container discards any changes it
made unless they were explicitly persisted — the writable layer dies with
the container. **This is exactly the problem
[volumes](volumes.md) solve** — anything that needs to survive a
container being removed (a database's actual data, uploaded files)
belongs in a volume, not the writable layer.

```bash
docker run -d --name test myapp:1.0
docker exec test touch /app/temp_file.txt   # written to test's writable layer only
docker rm -f test                            # temp_file.txt is gone — the writable layer is destroyed
docker run -d --name test2 myapp:1.0         # fresh container, back to the image's original state
```

## One Image, Many Containers

Because the image itself never changes when a container runs, the same
image can safely back many containers simultaneously — this is exactly
how horizontal scaling of containerized apps works (see
[horizontal-vs-vertical-scaling.md](../../system-design/scale-patterns/horizontal-vs-vertical-scaling.md)):

```bash
docker run -d --name worker1 myapp:1.0
docker run -d --name worker2 myapp:1.0
docker run -d --name worker3 myapp:1.0
# 3 independent, identical containers from ONE image —
# this is the mechanism behind scaling replica count in Kubernetes
# (see kubernetes/deployment.md)
```

## Container Lifecycle

```
docker create  -> container exists, not running
docker start   -> container's process begins running
docker pause   -> process suspended, still resident in memory
docker stop    -> graceful shutdown (SIGTERM, then SIGKILL after a timeout)
docker kill    -> immediate shutdown (SIGKILL)
docker rm      -> container and its writable layer are deleted entirely
```

`docker run` is shorthand for `create` + `start` in one step — the most
common way containers actually get started, but understanding the
underlying states matters when debugging why a container that exists
isn't actually doing anything (it might be created but never started, or
stopped but not removed).

---

## Quick Reference

| Question                                          | Answer                                             |
| :-------------------------------------------------------- | :--------------------------------------------------------- |
| Is this a blueprint or a running thing?                       | Image = blueprint, Container = running instance                |
| Can one image produce many containers?                        | Yes — each independent, each with its own writable layer          |
| Do changes made inside a running container affect the image?  | No — they go to that container's own writable layer only             |
| What happens to those changes when the container is removed?  | Lost, unless stored in a volume                                        |
| How do I list images vs running containers?                    | `docker images` vs `docker ps`                                          |

**Bottom line:** an image is the immutable template; a container is a
live, disposable instance of it. Anything you need to survive beyond a
single container's lifetime — data, uploaded files, logs you actually
care about — needs to live outside the container's writable layer, in a
[volume](volumes.md).
