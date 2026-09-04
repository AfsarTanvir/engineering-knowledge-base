# Infrastructure as Code (IaC)

Infrastructure as Code means defining servers, networks, databases, and
every other piece of infrastructure in version-controlled configuration
files, instead of clicking through a cloud console by hand. The
infrastructure becomes something you can review, diff, test, and roll
back — the same discipline [CI/CD](overview.md) applies to application
code, applied to the infrastructure that code runs on.

## Table of Contents

1. [The Problem with Manual Infrastructure](#the-problem-with-manual-infrastructure)
2. [Declarative vs Imperative IaC](#declarative-vs-imperative-iac)
3. [Terraform: A Concrete Example](#terraform-a-concrete-example)
4. [State: Knowing What Already Exists](#state-knowing-what-already-exists)
5. [Plan Before Apply](#plan-before-apply)
6. [IaC in a CI/CD Pipeline](#iac-in-a-cicd-pipeline)
7. [Idempotency Matters Here Too](#idempotency-matters-here-too)
8. [Quick Reference](#quick-reference)

---

## The Problem with Manual Infrastructure

Clicking through a cloud console to create a server works, once — but
it's invisible to version control, impossible to review before it
happens, and undocumented the moment the person who clicked through it
forgets exactly what they configured.

```
Manual: "I think I set up the production database with these settings...
         I don't remember exactly, and there's no record to check."

IaC:    resource "aws_db_instance" "production" {
           engine         = "postgres"
           instance_class = "db.t3.medium"
           allocated_storage = 100
         }
         -- committed to git, reviewable in a PR, identical every time it's applied
```

This is the same "it works on my machine" problem [Docker](../docker/overview.md)
solves for applications — IaC solves it for the infrastructure the
application actually runs on.

## Declarative vs Imperative IaC

**Declarative** (Terraform, CloudFormation, Pulumi in declarative mode) —
describe the desired end state; the tool figures out what needs to
change to get there. This mirrors the same declarative model
[Kubernetes Deployments](../kubernetes/deployment.md) use for Pods,
applied one layer down to the infrastructure itself.

```hcl
# "There should be exactly this server, with these settings" —
# the tool diffs this against reality and makes whatever changes are needed
resource "aws_instance" "web" {
  ami           = "ami-0abcdef1234567890"
  instance_type = "t3.medium"
}
```

**Imperative** (a shell script calling `aws ec2 run-instances`, Ansible
in its more script-like usage) — describe the specific *steps* to take.
Works, but running the same script twice can create two servers instead
of recognizing one already exists — declarative tools avoid this by
design (see [Idempotency](#idempotency-matters-here-too) below).

Declarative is the dominant approach for provisioning infrastructure
itself; imperative tools (Ansible, shell scripts) remain common for
configuring software *on* already-provisioned servers.

## Terraform: A Concrete Example

The most widely used declarative IaC tool, supporting most major cloud
providers through the same workflow:

```hcl
# main.tf
provider "aws" {
  region = "us-east-1"
}

resource "aws_instance" "web_server" {
  ami           = "ami-0abcdef1234567890"
  instance_type = "t3.medium"

  tags = {
    Name = "web-server"
  }
}

resource "aws_db_instance" "database" {
  engine         = "postgres"
  engine_version = "16.1"
  instance_class = "db.t3.medium"
  allocated_storage = 100
}
```

```bash
terraform init      # download provider plugins
terraform plan       # show what would change — see below
terraform apply       # actually make the changes
terraform destroy      # tear down everything this config manages
```

## State: Knowing What Already Exists

Terraform (and similar tools) keep a state file recording what
infrastructure it has already created, so `terraform plan` can compute a
diff between "what's declared" and "what actually exists" — without
state, every run would have to query every possible resource to figure
that out, and couldn't reliably distinguish "this needs to be created"
from "this already exists and matches."

```
Declared config: 1 web server, 1 database
Current state:   1 web server, 1 database  -> plan shows: no changes

Declared config: 1 web server, 1 database, 1 cache
Current state:   1 web server, 1 database  -> plan shows: create 1 cache
```

**State should be stored remotely and shared** (e.g., an S3 bucket with
locking, or Terraform Cloud) for any team beyond a single person on a
single laptop — two people applying changes against their own local
state files independently is a recipe for infrastructure drift and
conflicting changes.

## Plan Before Apply

`terraform plan` shows exactly what would change *before* anything
actually changes — the infrastructure equivalent of reviewing a diff
before merging a pull request:

```
Terraform will perform the following actions:

  # aws_instance.web_server will be updated in-place
  ~ resource "aws_instance" "web_server" {
      ~ instance_type = "t3.medium" -> "t3.large"
    }

  # aws_db_instance.database will be destroyed and replaced
  -/+ resource "aws_db_instance" "database" {
      ~ engine_version = "16.1" -> "17.0"  # forces replacement
    }

Plan: 1 to add, 1 to change, 1 to destroy.
```

**Read the plan output carefully before applying** — `-/+` (destroy and
replace) on a stateful resource like a database is a very different,
much riskier action than `~` (update in-place), and it's easy to miss
that distinction skimming past a large plan output.

## IaC in a CI/CD Pipeline

The same [pipeline gating](overview.md#a-typical-pipeline) that protects
application deploys applies to infrastructure changes — a PR proposing a
Terraform change should show its plan output for review before merging,
and apply automatically (or with manual approval) after merge:

```yaml
# Simplified GitHub Actions example
jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: terraform init
      - run: terraform plan -out=tfplan
      # post the plan output as a PR comment for human review

  apply:
    needs: plan
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: terraform apply tfplan
```

## Idempotency Matters Here Too

The same [idempotency principle](../../system-design/reliability/idempotency.md)
that matters for retried API requests matters for infrastructure tooling:
running `terraform apply` twice in a row with no config changes should be
a no-op the second time, not a duplicate resource. Declarative tools give
you this by design — they diff against actual state rather than blindly
re-executing creation steps, which is exactly why declarative IaC is
generally preferred over a plain imperative script for provisioning.

---

## Quick Reference

| Question                                                | Answer                                                     |
| :--------------------------------------------------------------- | :----------------------------------------------------------------- |
| Should infrastructure changes be reviewable, like code?             | Yes — that's the entire point of IaC                                    |
| Declarative or imperative for provisioning cloud resources?         | Declarative (Terraform, CloudFormation) — safer, idempotent by design    |
| What tracks what's already been created?                            | State (kept remotely and shared for any real team)                        |
| How do I see what a change will actually do before it happens?       | `terraform plan`                                                            |
| Is running `apply` twice with no changes dangerous?                  | No — idempotent by design, it's a no-op the second time                     |

**Bottom line:** IaC brings the same review-before-merge, diff-before-
apply discipline to infrastructure that CI/CD brings to application
code. Prefer declarative tools for provisioning — they compute the exact
diff needed and are idempotent by construction, which a hand-rolled
imperative script generally isn't.
