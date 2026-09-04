# CI/CD

CI/CD automates the path from "a developer commits code" to "that code is
running in production." Continuous Integration (CI) is about merging and
validating code changes constantly, in small batches, instead of
integrating everyone's work in one big, risky merge. Continuous Delivery
/ Deployment (CD) is about getting validated code out to users
automatically, instead of a manual, error-prone release process.

## Table of Contents

1. [Continuous Integration](#continuous-integration)
2. [Continuous Delivery vs Continuous Deployment](#continuous-delivery-vs-continuous-deployment)
3. [A Typical Pipeline](#a-typical-pipeline)
4. [Why Small, Frequent Changes Matter](#why-small-frequent-changes-matter)
5. [Pipeline Stages in Practice](#pipeline-stages-in-practice)
6. [Artifacts: What Actually Moves Through the Pipeline](#artifacts-what-actually-moves-through-the-pipeline)
7. [Where This Connects to the Rest of the Stack](#where-this-connects-to-the-rest-of-the-stack)
8. [Quick Reference](#quick-reference)

---

## Continuous Integration

The practice of merging every developer's changes into a shared branch
frequently (multiple times a day, ideally), with an automated build and
test run on every merge — catching integration problems within minutes
of them being introduced, not weeks later when a large branch finally
merges.

```
Without CI: Dev A and Dev B each work on a feature branch for 3 weeks,
            then merge -> massive, hard-to-debug merge conflicts and
            integration bugs discovered all at once

With CI: Dev A and Dev B each merge small changes daily -> automated
         build+test runs on every merge -> conflicts and bugs surface
         immediately, while the change is still small and fresh in
         everyone's memory
```

The automated part — build, run tests, report pass/fail — is what a CI
*tool* (GitHub Actions, Jenkins, CircleCI) actually executes. CI as a
*practice* is the discipline of merging often; the tooling just makes
that discipline enforceable and fast.

## Continuous Delivery vs Continuous Deployment

These get conflated constantly, and the difference is exactly one manual
step:

- **Continuous Delivery** — every change that passes the pipeline is
  automatically packaged and ready to release, but an actual human
  clicks "deploy" to push it to production.
- **Continuous Deployment** — every change that passes the pipeline
  deploys to production automatically, no human approval step at all.

```
Continuous Delivery: commit -> build -> test -> package -> [READY, awaiting manual deploy click]
Continuous Deployment: commit -> build -> test -> package -> deploy to production, automatically
```

Continuous Deployment requires real confidence in the test suite and
deployment safety mechanisms (see
[health-checks.md](../deployment-strategies/health-checks.md),
[canary-deployment.md](../deployment-strategies/canary-deployment.md)) —
without those, automatically shipping every merge straight to production
is how a bad commit becomes a bad incident within minutes.

## A Typical Pipeline

```
Commit pushed
     |
     v
[ Build ]  --fail--> notify developer, stop
     |
     v
[ Test ]   --fail--> notify developer, stop
     |
     v
[ Package/Build Image ]
     |
     v
[ Deploy to Staging ] --fail--> notify, stop
     |
     v
[ Automated smoke tests against staging ] --fail--> notify, stop
     |
     v
[ Deploy to Production ]  (manual approval here = Continuous Delivery;
     |                      automatic = Continuous Deployment)
     v
[ Monitor / Health Checks ]
```

Each stage acts as a gate — a failure at any point stops the pipeline
before a broken change reaches the next stage, let alone production.

## Why Small, Frequent Changes Matter

The core reason CI/CD exists isn't automation for its own sake — it's
that **smaller changes are safer changes.** A deploy containing one
small, focused commit is trivial to reason about and trivial to roll
back if something goes wrong. A deploy containing three weeks of
accumulated changes could be broken by any one of dozens of commits, and
rolling it back undoes everything, not just the bad part.

```
Large, infrequent deploy: 50 commits shipped together
  -> something breaks in production -> which of the 50 commits caused it?
  -> rollback undoes 50 commits' worth of work, not just the bad one

Small, frequent deploys: 1-3 commits shipped together
  -> something breaks -> almost certainly one of these 1-3 commits
  -> rollback undoes very little unrelated work
```

## Pipeline Stages in Practice

- **Build** — compile code, install dependencies, produce a build
  artifact (often a [Docker image](../docker/overview.md))
- **Test** — unit tests, integration tests, sometimes end-to-end tests
  against a temporary environment
- **Static analysis / security scanning** — linting, dependency
  vulnerability scans, secret-detection — cheap checks that catch
  problems before a deploy, not after
- **Package** — produce the deployable artifact (a container image
  pushed to a registry, a compiled binary, a static site bundle)
- **Deploy to staging** — run the same deployment process that
  production will use, against a non-production environment first
- **Deploy to production** — using a rollout strategy (see
  [rolling-updates.md](../deployment-strategies/rolling-updates.md),
  [canary-deployment.md](../deployment-strategies/canary-deployment.md),
  [blue-green-deployment.md](../deployment-strategies/blue-green-deployment.md))
  rather than replacing everything at once

## Artifacts: What Actually Moves Through the Pipeline

The build stage produces a specific, versioned artifact — and that exact
artifact, not a fresh rebuild, should be what moves through every
subsequent stage and eventually into production:

```
Build once -> tag as myapp:a1b2c3d (the commit SHA, or a semantic version)
           -> test THAT artifact
           -> deploy THAT SAME artifact to staging
           -> deploy THAT SAME artifact to production
```

Rebuilding at each stage (instead of promoting one built artifact
through each stage) risks a subtle mismatch — "it passed tests" no longer
strictly guarantees anything about what's actually deployed if the
deployed version was built separately, even from the same source commit
(a dependency could have published a new version in between builds, for
instance).

## Where This Connects to the Rest of the Stack

- [GitHub Actions](github-actions.md) — one concrete CI/CD tool,
  implementing this general pipeline concept as workflow YAML
- [Infrastructure as Code](infrastructure-as-code.md) — often a pipeline
  stage itself (apply infra changes as part of the deploy), and also
  what provisions the environments the pipeline deploys into
- [Docker](../docker/overview.md) — the typical build artifact format for
  containerized applications
- [Rolling updates / canary / blue-green](../deployment-strategies/rolling-updates.md) —
  the actual mechanics of the "deploy to production" pipeline stage

---

## Quick Reference

| Term                          | Meaning                                                     |
| :-------------------------------- | :----------------------------------------------------------------- |
| Continuous Integration (CI)          | Merge + automatically build/test changes frequently                    |
| Continuous Delivery                  | Every passing change is deploy-ready; a human triggers the actual deploy |
| Continuous Deployment                | Every passing change deploys automatically, no human step               |
| Pipeline gate                        | A stage that must pass before the next stage runs                        |
| Build artifact                       | The one built output that should be promoted through every stage, not rebuilt |

**Bottom line:** CI/CD's real value is making small, frequent changes
safe to ship — automation is what makes that discipline practical at any
real team size. Continuous Delivery vs Deployment is just whether a human
clicks the final button; everything before that point looks the same
either way.
