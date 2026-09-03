# Docker Volumes

Containers are meant to be disposable — stopped, removed, replaced with a
fresh one from the same image, without ceremony. But some data (a
database's actual rows, user-uploaded files) absolutely cannot be
disposable. Volumes are how Docker reconciles those two facts: they let
data live outside a container's writable layer, so it survives even when
the container itself doesn't.

## Table of Contents

1. [Why the Writable Layer Isn't Enough](#why-the-writable-layer-isnt-enough)
2. [Named Volumes](#named-volumes)
3. [Bind Mounts](#bind-mounts)
4. [Named Volumes vs Bind Mounts](#named-volumes-vs-bind-mounts)
5. [tmpfs Mounts](#tmpfs-mounts)
6. [Sharing a Volume Between Containers](#sharing-a-volume-between-containers)
7. [Volumes in Docker Compose](#volumes-in-docker-compose)
8. [Quick Reference](#quick-reference)

---

## Why the Writable Layer Isn't Enough

As covered in [image-vs-container.md](image-vs-container.md), any file a
running container writes goes into that specific container's own
writable layer — which is destroyed the moment the container is removed:

```bash
docker run -d --name db postgres:16
# ... database writes rows to its data directory inside the container ...
docker rm -f db
# every row is gone — the writable layer, and everything in it, no longer exists
```

For a database, that's catastrophic. Volumes fix this by redirecting a
specific path inside the container to storage that lives *outside* the
container's lifecycle entirely.

## Named Volumes

Docker manages the actual storage location; you refer to it by name.
This is the standard choice for anything Docker itself should own and
manage (database data directories, in most cases):

```bash
docker volume create pgdata
docker run -d --name db -v pgdata:/var/lib/postgresql/data postgres:16
```

```
docker rm -f db                     # remove the container...
docker run -d --name db2 -v pgdata:/var/lib/postgresql/data postgres:16
# ...and db2 sees the SAME data pgdata held, even though db is gone entirely
```

```bash
docker volume ls                     # list all named volumes
docker volume inspect pgdata          # see where it actually lives on the host
docker volume rm pgdata               # delete it (and the data with it)
```

## Bind Mounts

Instead of Docker-managed storage, a bind mount maps a specific path on
the *host* filesystem directly into the container:

```bash
docker run -d -v /home/user/myapp/src:/app/src myapp:1.0
```

Changes made on either side are immediately visible on the other — this
is the standard pattern for local development, where you want code
changes on your host machine to be picked up by a running container
without rebuilding the image every time:

```bash
# Local dev: mount your source code so live-reload tools inside the
# container pick up edits made in your normal editor on the host
docker run -d -v $(pwd):/app -p 8000:8000 myapp-dev:latest
```

## Named Volumes vs Bind Mounts

| Aspect                    | Named Volume                             | Bind Mount                                 |
| :---------------------------- | :-------------------------------------------- | :------------------------------------------------ |
| Storage location                | Managed by Docker, opaque path                    | Explicit host path you choose                          |
| Best for                        | Application data (databases, persistent state)     | Local development (live-editing source code)             |
| Portability                     | Works the same regardless of host OS/filesystem      | Tied to a specific host path — less portable               |
| Docker manages backup/lifecycle  | Yes — `docker volume` commands manage it directly    | No — it's just a regular directory on the host               |

**Default to named volumes for anything running in production**
(especially data you can't regenerate) and bind mounts for local
development convenience — mixing them up (a bind mount for a production
database's data directory tied to one specific server's filesystem path)
creates a hidden dependency on that exact machine.

## tmpfs Mounts

A third option: store data only in the host's memory, never written to
disk at all — for genuinely temporary, sensitive-enough-to-not-persist
data (e.g., a short-lived secret, scratch space that shouldn't outlive
the container even as a lingering file):

```bash
docker run -d --tmpfs /app/cache myapp:1.0
```

Gone immediately when the container stops — faster than disk, but capped
by available RAM and never durable across a restart.

## Sharing a Volume Between Containers

Multiple containers can mount the same named volume simultaneously —
useful when one container writes data another needs to read (e.g., a
container that generates static files, and an NGINX container that
serves them):

```bash
docker volume create static_files

docker run -d --name builder -v static_files:/output builder-image:1.0
docker run -d --name web -v static_files:/usr/share/nginx/html nginx:1.25
# builder writes to /output; web serves the same files from
# /usr/share/nginx/html — same underlying volume, two mount points
```

Docker doesn't coordinate concurrent writes for you — if both containers
write to the same files, you need your own coordination (or, more
commonly, one container writes and the other only reads).

## Volumes in Docker Compose

The Compose example from [overview.md](overview.md) used exactly this
pattern for the database:

```yaml
services:
  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data   # named volume

  web:
    build: .
    volumes:
      - ./src:/app/src                     # bind mount, for live dev reload

volumes:
  pgdata:   # declares the named volume so Compose manages its lifecycle
```

`docker compose down` leaves named volumes intact by default (the data
survives); `docker compose down -v` explicitly also removes volumes —
worth knowing before running it against a database you care about.

---

## Quick Reference

| Need                                                    | Use                                    |
| :------------------------------------------------------------- | :-------------------------------------------- |
| Persist a database's data across container restarts/removal      | Named volume                                     |
| Live-reload source code during local development                 | Bind mount                                        |
| Temporary, in-memory-only scratch data                            | `tmpfs` mount                                       |
| Share generated files between two containers                      | Named volume mounted by both                          |
| Accidentally deleting production data via `docker compose down -v` | Don't — check for `-v` before running it against prod    |

**Bottom line:** anything that needs to outlive a single container —
which is most application data — belongs in a named volume, not the
container's writable layer. Reserve bind mounts for local development
convenience, where tying storage to a specific host path is exactly what
you want.
