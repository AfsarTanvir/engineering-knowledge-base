# Part 3 — Deploying a Backend

Your project works on your laptop. A friend asks for the link, and there is no
link. You have read about Kubernetes, blue-green deploys and service meshes, and
none of it told you how to get *this* Node app, with *this* PostgreSQL database,
onto a machine someone else can reach.

This part is that. One cheap VPS, one domain, one nginx, one certificate, one
pipeline — done by hand first so you see every step, then automated so you never
type it again. The goal is explicit: **by the end of this part your own backend
is live on the internet, and you put it there.** An evening is enough.

> **📌 The whole part in one line:** rent one small Linux box, lock it down, put
> nginx and HTTPS in front of your container, ship it from a GitHub Actions
> pipeline tagged by commit SHA — and keep a backup you have actually restored.

## Files

1. [What Deployment Actually Is](01-what-deployment-actually-is.md) — the three
   real steps, the pieces of a running system, hosting options compared, and the
   app-side checklist you need before any of it.
2. [Setting Up the Server — Part 1](02-setting-up-the-server-part-1.md) —
   creating the VPS, sizing and region, first-login hardening in the order that
   does not lock you out, Docker, automatic updates.
3. [Part 2](02-setting-up-the-server-part-2.md) — nginx as a reverse proxy, a
   complete annotated server block, Let's Encrypt and proving renewal works,
   proxy headers, where the database should live, DNS.
4. [Shipping and Rollback — Part 1](03-shipping-and-rollback-part-1.md) — the
   manual deploy once, migrations as their own step, tagging by commit SHA, and
   a full GitHub Actions workflow with secrets done properly.
5. [Part 2](03-shipping-and-rollback-part-2.md) — zero downtime on one server,
   draining on SIGTERM, the rollback decision table, workers and version skew,
   feature flags, post-deploy verification.
6. [Keeping It Running — Part 1](04-keeping-it-running-part-1.md) — the
   monitoring minimum, alerts you will not mute, backups, and a restore drill
   you perform rather than plan.
7. [Part 2](04-keeping-it-running-part-2.md) — patching and reboots, certificate
   monitoring, the incident runbook, blameless notes, when one VPS is no longer
   enough, and what it all costs.

## Read in this order

Read 1 to 7 in order, one file per sitting, with a terminal open. File 1 is
reading; files 2 to 5 are typing. Do not skip the manual deploy in file 4 — the
pipeline in the same file only makes sense once you have done it by hand. Files
6 and 7 are the ones to read **before** your first incident, not during it.

## What you should be able to do after this part

- Create a VPS, harden it, and explain why each hardening step comes in that order.
- Put your Node app behind nginx with a working HTTPS certificate and a domain.
- Say which process is listening on which port, and why your app is on `127.0.0.1`.
- Ship a new version from `git push` with no dropped requests, and roll it back.
- Explain why migrations run before the new code and why they must be reversible for one release.
- Restore a database backup into a throwaway Postgres and prove the data is there.
- Work an incident in order instead of guessing, and write down what happened.

## Where this connects

- **Concepts, not repeated:** [nginx/](../../cloud-devops/nginx/),
  [ci-cd/](../../cloud-devops/ci-cd/),
  [deployment-strategies/](../../cloud-devops/deployment-strategies/),
  [kubernetes/](../../cloud-devops/kubernetes/).
- **The machine itself:** [01-linux-essentials/](../01-linux-essentials/) —
  processes, ports, permissions, logs and disks.
- **The image you ship:** [02-docker-in-practice/](../02-docker-in-practice/).
- **App-side prerequisites:** config from the environment in
  [11-api-security/](../../backend-fundamentals/11-api-security/), graceful
  shutdown in [03-request-lifecycle/](../../backend-fundamentals/03-request-lifecycle/),
  health and metrics in [08-logging-and-observability/](../../backend-fundamentals/08-logging-and-observability/),
  migrations in [10-database-integration/](../../backend-fundamentals/10-database-integration/).
- **Operating the data:** [databases/operations/](../../databases/operations/)
  and [03-background-jobs/](../../caching-and-background-jobs/03-background-jobs/).
- **When one box is not enough:**
  [system-design/foundational/](../../system-design/foundational/).
