# Linux & Deployment

Weeks 11–12 of [doc/career-roadmap.md](../doc/career-roadmap.md), expanded into
a full learning track.

Everything you have written so far runs somewhere. This is the block where that
"somewhere" stops being a mystery.

The roadmap is blunt about the starting point: **DevOps is basically zero, and
that is fine.** So this track does not start with Kubernetes. It starts with
what a process is, what a port is, and why the thing worked on your laptop and
died on the server. Then Docker. Then one real deployment you did yourself.

> **📌 The whole track in one line:** a server is just a Linux machine running
> your process on a port behind a reverse proxy — and once you can see each of
> those pieces, deployment stops being magic.

## Roadmap

| # | Folder | What it answers |
|---|---|---|
| 1 | [linux-essentials/](01-linux-essentials/) | The shell, processes, permissions, ports, logs — the vocabulary everything else assumes |
| 2 | [docker-in-practice/](02-docker-in-practice/) | Packaging *your* Node app, not container theory |
| 3 | [deploying-a-backend/](03-deploying-a-backend/) | Getting it onto a real server, safely, and keeping it there |

## How this relates to `cloud-devops/`

The **concepts** already exist in this repo as short reference notes, and this
track does not repeat them:

- [docker/](../cloud-devops/docker/) — containers vs VMs, Dockerfiles, layers,
  multi-stage builds, volumes
- [nginx/](../cloud-devops/nginx/) — config structure, reverse proxying, load
  balancing
- [ci-cd/](../cloud-devops/ci-cd/) — pipelines, artifacts, GitHub Actions,
  infrastructure as code
- [deployment-strategies/](../cloud-devops/deployment-strategies/) — blue-green,
  canary, rolling updates, health checks
- [kubernetes/](../cloud-devops/kubernetes/) — pods, deployments, services

Those answer **"what is this thing?"**

This track answers **"how do I actually do it to my own project, and what do I
do when it breaks at 11pm?"** — the same split as
[backend-fundamentals/](../backend-fundamentals/) versus
[databases/](../databases/), or
[caching-and-background-jobs/](../caching-and-background-jobs/) versus
[system-design/](../system-design/).

**Linux itself is not covered anywhere else in this repo.** Folder 1 is new
ground.

## Status

- [x] 01 — Linux essentials — 11 files
- [x] 02 — Docker in practice — 9 files
- [x] 03 — Deploying a backend — 8 files

Longer topics are split into `-part-1` / `-part-2` files so no single file runs
past ~500 lines. Each part stands on its own: its own contents, common
mistakes, and self-test questions, with links between the parts.

## How to use this

1. **One file per sitting.** See the daily routine in the
   [roadmap](../doc/career-roadmap.md).
2. **Type the commands.** This is the one track you cannot learn by reading.
   Keep a throwaway VM or container open and run everything.
3. **Deploy something of your own at the end.** The roadmap is explicit: even if
   you cannot deploy at work, deploy your own backend project. That is the point
   of the whole block.

## What you should be able to do after this track

- Read `ps`, `top`, `ss` and `journalctl` output and say what the machine is doing.
- Explain what actually happens between `git push` and the new code serving traffic.
- Write a Dockerfile for a Node app that builds fast and does not run as root.
- Put your app behind nginx with HTTPS, and know which process is listening where.
- Deploy a new version without dropping requests, and roll back when it goes wrong.
- Find out why a container exited, a port is already in use, or a service will not start.
