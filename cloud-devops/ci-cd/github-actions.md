# GitHub Actions

GitHub Actions is GitHub's built-in CI/CD tool — pipelines defined as
YAML files living in the repository itself, triggered directly by
repository events (a push, a pull request, a tag). It implements the
general [CI/CD pipeline concept](overview.md) as a specific, concrete
tool.

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [A Basic Workflow](#a-basic-workflow)
3. [Triggers](#triggers)
4. [Jobs and Dependencies](#jobs-and-dependencies)
5. [Matrix Builds](#matrix-builds)
6. [Secrets](#secrets)
7. [Building and Pushing a Docker Image](#building-and-pushing-a-docker-image)
8. [Caching Dependencies](#caching-dependencies)
9. [Quick Reference](#quick-reference)

---

## Core Concepts

- **Workflow** — a YAML file in `.github/workflows/`, defining one
  automated pipeline
- **Trigger (`on`)** — the repository event that starts the workflow
  (push, pull request, schedule, manual)
- **Job** — a set of steps that run on the same runner (VM); a workflow
  can have multiple jobs, which run in parallel by default
- **Step** — one action within a job — either a shell command or a
  reusable "Action" (a packaged unit of automation, shared via the
  GitHub Actions marketplace)
- **Runner** — the actual machine (GitHub-hosted or self-hosted) that
  executes the jobs

## A Basic Workflow

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4          # pull the repo's code onto the runner

      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - run: pip install -r requirements.txt
      - run: pytest
```

Every `push` to `main` and every pull request targeting `main` triggers
this workflow — checking out the code, installing dependencies, and
running tests.

## Triggers

```yaml
on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: "0 2 * * *"      # runs daily at 2 AM UTC
  workflow_dispatch:          # allows manually triggering from the GitHub UI
  release:
    types: [published]        # triggers when a GitHub release is published
```

Combining triggers is common — run tests on every PR, but only deploy on
a push to `main` or when a release is published, using separate jobs or
conditional steps for each concern.

## Jobs and Dependencies

Jobs run in parallel unless you explicitly say one depends on another —
useful for not wasting time deploying before tests have actually passed:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pytest

  build:
    needs: test              # waits for `test` to succeed first
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t myapp:${{ github.sha }} .

  deploy:
    needs: build              # waits for `build` to succeed first
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'   # only deploy from main
    steps:
      - run: ./deploy.sh
```

```
test -----> build -----> deploy
(deploy only runs if build succeeded, build only runs if test succeeded)
```

## Matrix Builds

Run the same job across multiple combinations of versions/platforms in
parallel, instead of writing near-duplicate jobs by hand:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.10", "3.11", "3.12"]
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
      - run: pytest
```

This spins up 6 separate parallel jobs (3 Python versions × 2 OSes) — a
common pattern for libraries that need to verify compatibility across
several environments simultaneously.

## Secrets

Never hard-code credentials in a workflow file (it's committed to the
repo, visible to anyone with read access). GitHub's encrypted secrets
store injects them as environment variables at runtime instead:

```yaml
steps:
  - run: ./deploy.sh
    env:
      AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

Configured in the repository (or organization) settings under
Settings → Secrets and variables — never visible in logs or the workflow
file itself, and GitHub automatically masks any matching value that
accidentally gets printed to a log.

## Building and Pushing a Docker Image

A common real pipeline: build a [Docker image](../docker/overview.md),
tag it with the commit SHA, and push it to a registry — the artifact
that later deployment steps (or a separate deploy workflow) will
actually run:

```yaml
jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }}
```

Tagging by `github.sha` (the exact commit) rather than a mutable tag like
`latest` keeps every built image traceable back to the exact source that
produced it — the same "promote one built artifact" principle from
[overview.md](overview.md#artifacts-what-actually-moves-through-the-pipeline).

## Caching Dependencies

Reinstalling the same unchanged dependencies on every single run wastes
minutes per build — cache them, keyed by something that only changes
when the dependencies actually do:

```yaml
steps:
  - uses: actions/checkout@v4

  - uses: actions/cache@v4
    with:
      path: ~/.cache/pip
      key: pip-${{ hashFiles('requirements.txt') }}
      # cache hit as long as requirements.txt hasn't changed;
      # a changed requirements.txt produces a new key, forcing a fresh install

  - run: pip install -r requirements.txt
```

This mirrors the same layer-caching principle from
[Docker's build cache](../docker/overview.md#layers-and-the-build-cache) —
cache invalidation keyed on exactly what would actually change the
result, nothing broader.

---

## Quick Reference

| Need                                                | Config                                                    |
| :---------------------------------------------------------- | :---------------------------------------------------------------- |
| Run on every push and PR to main                              | `on: push/pull_request: branches: [main]`                            |
| Only deploy from the main branch                               | `if: github.ref == 'refs/heads/main'` on the deploy job                 |
| Make one job wait for another                                 | `needs: <job_name>`                                                    |
| Test across multiple versions/platforms in parallel             | `strategy: matrix:`                                                      |
| Use credentials without exposing them in the file                | Repository/org **Secrets**, referenced via `${{ secrets.NAME }}`          |
| Avoid reinstalling unchanged dependencies every run              | `actions/cache`, keyed by a lockfile hash                                  |

**Bottom line:** GitHub Actions turns the general CI/CD pipeline concept
into version-controlled YAML living alongside the code it builds and
tests. Keep jobs dependent only where genuinely needed (parallelize
everything else), never hard-code credentials, and tag build artifacts by
commit SHA so what's deployed is always traceable to exact source.
