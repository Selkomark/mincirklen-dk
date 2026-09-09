# `setup-gcp.sh`

One-time GCP setup for this project's Terraform CI. Not run automatically by
anything — run it yourself, once, when you're ready to actually wire up a
GCP project.

It does two independent things, either of which can be skipped:

1. **OIDC** — Workload Identity Federation, so GitHub Actions authenticates
   to GCP with short-lived tokens instead of a static service account JSON
   key. Creates (or reuses) a shared `github-actions` WIF pool + `github`
   provider, plus a service account and IAM bindings specific to this repo.
2. **GCS** — the bucket Terraform remote state lives in
   (`IaC/environments/prod/backend.tf` points at it).

## Why this exists as a script, not just Terraform

`IaC/bootstrap/` already does roughly this via `terraform apply`. This
script is for one specific situation: **the same GCP project hosts (or will
host) more than one repo's infrastructure.** Two separate repos each running
`terraform apply` against their own copy of `IaC/bootstrap/` would both
believe they own the same WIF pool/provider names and fight each other on
every apply — Terraform state is inherently single-owner, and a shared
identity pool doesn't have a single owning repo.

This script sidesteps that entirely: every resource is checked for
existence before being touched, and nothing already there is ever
recreated, modified, or narrowed. Run it once per repo, on a shared
project, and each run only adds that repo's own service account and IAM
bindings — the pool and provider get created once (by whichever repo runs
this first) and reused untouched by every repo after that.

**Use this script or `IaC/bootstrap/`'s Terraform, not both, on the same
project.**

## Usage

```
./setup-gcp.sh [--no-oidc] [--no-gcs] <PROJECT_ID> [GITHUB_REPO]
```

| Arg / flag | Required | Meaning |
|---|---|---|
| `PROJECT_ID` | yes | GCP project ID to configure. Prompted for if omitted. |
| `GITHUB_REPO` | no | `owner/repo`. Defaults to `Selkomark/MinCirklen.dk`. |
| `--no-oidc` | no | Skip the Workload Identity Federation section entirely. |
| `--no-gcs` | no | Skip the state-bucket section entirely. |

Examples:

```
# Full setup, defaults to this repo
./setup-gcp.sh mincirklen-prod

# Full setup for a different repo on the same project
./setup-gcp.sh mincirklen-prod Selkomark/some-other-repo

# Only (re-)run the OIDC section — e.g. onboarding a second repo onto a
# project that already has its state bucket
./setup-gcp.sh --no-gcs mincirklen-prod Selkomark/some-other-repo

# Only (re-)run the GCS section — e.g. OIDC was already set up separately
./setup-gcp.sh --no-oidc mincirklen-prod
```

## What it prints when done

Exactly the `gh variable set` commands for whichever section(s) ran, using
real values from what it just created or found:

```
gh variable set GCP_PROJECT_ID --body "..."
gh variable set GCP_TERRAFORM_STATE_BUCKET --body "..."       # unless --no-gcs
gh variable set GCP_TERRAFORM_SERVICE_ACCOUNT --body "..."    # unless --no-oidc
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --body "..."   # unless --no-oidc
```

Run those against this repo (or wherever the corresponding pipeline lives)
to finish wiring up `.github/workflows/iac-plan.yml` and `iac-apply.yml`.

## Prerequisites

- `gcloud` CLI installed.
- Ability to log in with owner/editor on the target project — the script
  runs `gcloud auth login` itself if you're not already authenticated.

## Naming conventions (override via env var if this project already uses different ones)

| Resource | Default name | Env var override |
|---|---|---|
| WIF pool | `github-actions` | `WIF_POOL_ID` |
| WIF provider | `github` | `WIF_PROVIDER_ID` |
| State bucket | `<PROJECT_ID>-terraform-state` | `STATE_BUCKET` |
| Region (bucket location) | `europe-west1` | `REGION` |

The per-repo service account is always derived from the repo slug
(`tf-ci-<owner>-<repo>`, lowercased) — not overridable, specifically so two
repos on the same project can never collide.
