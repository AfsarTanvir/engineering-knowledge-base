# Docker — Concepts

A deploy goes out on Thursday afternoon and every invoice attachment uploaded
that week is gone. Nobody deleted anything. A colleague says "the container was
replaced, the writable layer went with it" and you nod — but you could not have
predicted the incident that morning.

This folder is the vocabulary that makes that sentence predictive instead of
after-the-fact: three reference notes on what a container is, what an image is,
and where data lives.

> **📌 The whole folder in one line:** a container is a normal Linux process with
> a private view of the machine, an image is the immutable filesystem it starts
> from, and anything you need to keep has to live somewhere neither of them owns.

## Files

1. **[overview.md](overview.md)** — the problem containers solve, containers
   versus virtual machines, and what a container actually is at the kernel
   level: namespaces, cgroups and union filesystems. Then Dockerfiles, layers
   and the build cache, multi-stage builds, the command cheat-sheet, and
   Compose.
2. **[image-vs-container.md](image-vs-container.md)** — the template-and-instance
   split, what is really inside an image, tags versus digests and why `latest`
   is a moving pointer, the writable layer and copy-on-write, and why you
   rebuild instead of patching a running container.
3. **[volumes.md](volumes.md)** — why container filesystems are ephemeral by
   design, how to tell data you must keep from data you can rebuild, the three
   storage options and where the bytes physically live, and the single-host
   limit that pushes real user data out of Docker entirely.

## Read in this order

Strictly 1 → 2 → 3. Each one assumes the previous.

```text
overview  →  image vs container  →  volumes
 what a       what persists and      where state
 container    what does not          actually goes
 is
```

File 1 explains the union filesystem that file 2's writable layer is built on;
file 2 explains the writable layer that file 3 exists to work around.

## What you should be able to do after this folder

- Say what Docker asks the kernel to do, and explain why a container cannot run
  a different kernel than its host.
- Predict which Dockerfile layers will be rebuilt after a given change, before
  running the build.
- Explain why a file written inside a running container disappears, and name
  exactly what was deleted.
- Tell the difference between a tag and a digest, and say what is actually
  running in production.
- Classify a piece of data as "must keep", "can rebuild" or "scratch", and pick
  the writable layer, a named volume, or object storage accordingly.

## Where this connects

This folder is the **reference layer**: what things *are* and why they work that
way. The matching **practical layer** is
[../../linux-and-deployment/02-docker-in-practice/](../../linux-and-deployment/02-docker-in-practice/)
— nine files that take a real TypeScript API and containerise it, run it next to
Postgres and Redis, and debug it when it misbehaves. When a question here turns
into "how do I do this in my project?", the answer is there, not here. When
something there feels arbitrary, the reason is here.

- **Write the Dockerfile** →
  [01-a-dockerfile-for-node-part-1.md](../../linux-and-deployment/02-docker-in-practice/01-a-dockerfile-for-node-part-1.md)
- **Run it, publish ports, read logs** →
  [02-running-containers-locally-part-1.md](../../linux-and-deployment/02-docker-in-practice/02-running-containers-locally-part-1.md)
- **The whole stack with one command** →
  [03-compose-for-local-development-part-1.md](../../linux-and-deployment/02-docker-in-practice/03-compose-for-local-development-part-1.md)
- **When it breaks** →
  [04-debugging-containers-part-1.md](../../linux-and-deployment/02-docker-in-practice/04-debugging-containers-part-1.md)
- **Once one host is not enough** → [../kubernetes/](../kubernetes/),
  [../deployment-strategies/](../deployment-strategies/) and
  [../ci-cd/](../ci-cd/).
- **Where user files belong** → [02-object-storage-and-serving-files.md](../../backend-fundamentals/12-files-and-integrations/02-object-storage-and-serving-files.md)
