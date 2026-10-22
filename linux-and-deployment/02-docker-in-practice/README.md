# Part 2 — Docker in Practice

You have a TypeScript API, a worker, Postgres and two Redis instances. A new
developer joins on Monday and your README says "install Postgres 16". Your
deploys drop a few requests and nobody knows why. An image built on a MacBook
refuses to start on the server with no error message at all.

None of that is solved by understanding what a container is. It is solved by
writing a Dockerfile for *your* app, running it next to its dependencies, and
knowing what to check when it misbehaves. The concepts — containers versus
virtual machines, images and layers, the build cache, multi-stage builds, volume
types — are short reference notes in
[cloud-devops/docker/](../../cloud-devops/docker/). This folder links to them
and goes straight to the implementation.

> **📌 The whole part in one line:** package your Node app so it builds fast,
> runs as a non-root user, dies gracefully and starts next to its database with
> one command — and know what to check when it does not.

## Files

1. **A Dockerfile for Node** —
   [Part 1](./01-a-dockerfile-for-node-part-1.md): the file built line by line,
   base images, pinning, layer ordering, `npm ci`, `.dockerignore`. ·
   [Part 2](./01-a-dockerfile-for-node-part-2.md): the multi-stage build, the
   non-root user, the PID 1 signal trap that drops requests on every deploy,
   `EXPOSE`, `HEALTHCHECK`, and the build argument that leaks a secret.
2. **Running Containers Locally** —
   [Part 1](./02-running-containers-locally-part-1.md): the nine commands,
   `docker run` flags, which side of `-p` is which, the `127.0.0.1` trap, logs. ·
   [Part 2](./02-running-containers-locally-part-2.md): ephemeral filesystems
   and lost uploads, volumes, container-to-container networking, memory limits
   and exit code 137, cleaning up safely.
3. **Compose for Local Development** —
   [Part 1](./03-compose-for-local-development-part-1.md): the stack built
   service by service, service names as hostnames, why `depends_on` is not
   enough, `.env`, `down -v`. ·
   [Part 2](./03-compose-for-local-development-part-2.md): hot reload and the
   `node_modules` masking problem, migrations and tests with `compose run --rm`,
   where to stop before Kubernetes, profiles and overrides.
4. **Debugging Containers** —
   [Part 1](./04-debugging-containers-part-1.md): the runbook flowchart, the
   container that exits immediately, exit codes, slow builds, the ordered
   "cannot reach it" checklist. ·
   [Part 2](./04-debugging-containers-part-2.md): database connectivity,
   architecture mismatches, volume permissions, `inspect` and `diff`, image
   size, and debugging an image with no shell.

## Read in this order

Strictly 1 → 4, each file's Part 1 before its Part 2. File 1 builds the image
everything else runs. File 2 teaches the networking fact file 3 depends on.
File 4 is the one you come back to rather than read once.

```text
01 Dockerfile  →  02 run it  →  03 whole stack  →  04 when it breaks
```

## What you should be able to do after this part

- Write a multi-stage Dockerfile for a TypeScript backend that rebuilds in
  seconds, runs as a non-root user, and shuts down cleanly on `SIGTERM`.
- Explain why an app bound to `127.0.0.1` is unreachable in a container even
  when the port is published.
- Start your API, worker, Postgres and both Redis instances with one command,
  waiting for readiness rather than hoping.
- Read an exit code and say whether the kernel, a deploy, or your own code
  stopped the container, and why an image can refuse to start on a server.

## Where this connects

- **The concepts behind all of this** →
  [../../cloud-devops/docker/](../../cloud-devops/docker/)
- **The Linux vocabulary this assumes** → [../01-linux-essentials/](../01-linux-essentials/)
- **Getting the image onto a real server** →
  [../03-deploying-a-backend/](../03-deploying-a-backend/)
- **The Postgres and Redis this stack runs** → [../../databases/](../../databases/)
  and [../../caching-and-background-jobs/](../../caching-and-background-jobs/)
- **Orchestration, for later and probably not yet** →
  [../../cloud-devops/kubernetes/](../../cloud-devops/kubernetes/)
