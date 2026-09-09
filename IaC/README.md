# MinCirklen — Infrastructure as Code

Terraform for everything in MinCirklen's technical specification (Cloud
Architecture, Deployment & Cost Analysis, v1, 2026-08-11): networking, GKE
Autopilot, Cloud Run shells, Cloud SQL, Redis, DNS, and the Load Balancer.
This repo/pipeline owns infrastructure only —
application code (tRPC API, WebSocket service, web-app, moderation service)
is out of scope here and deploys separately into what this provisions
(section 7.3).

**Current state: `prod` is the only environment.** The spec describes
dev/staging too; the modules support them (every module takes an
`environment` variable), but no one's asked for those root modules yet — add
`IaC/environments/dev` the same shape as `prod` when needed.

## Layout

```
IaC/
  bootstrap/            one-time, applied manually — state bucket + CI identity
  modules/
    networking/          VPC, subnets, NAT, Serverless VPC Access, DNS, HTTPS LB
    gke-autopilot/        the Autopilot cluster (WebSocket service + NATS run here)
    cloud-run/             reusable shell — tRPC API, moderation service, web-app SSR
    cloud-sql/              Postgres, IAM database auth (no passwords, ever)
    redis/                   self-hosted StatefulSet (default) or Memorystore
    secrets/                  Secret Manager containers + IAM — never values
    kms/                       Cloud KMS key for user_profiles PII encryption
    pubsub/                     topic + push subscription + dead-letter, for
                                 an isolated async worker (data-export-service)
  environments/
    prod/                 root module wiring the above together
```

## What this does NOT do

- **No moderation model/detection logic.** The moderation service's Cloud Run
  *shell* is provisioned; what image runs inside it, and everything about
  detection, is a separate proprietary repo per the spec's own scope note.
- **No application code.** tRPC API, WebSocket service, web-app, moderation
  service, and the data-export service all start from `placeholder_image`
  (Google's public `hello` sample container) so `terraform apply` succeeds
  before any of them exist. Each service's own CI pipeline takes over from
  there via `gcloud run deploy --image ...`; `modules/cloud-run` is written
  to not fight that (`lifecycle.ignore_changes` on the image).
- **No web-app/moderation-service pipelines yet.** Section 7.4's gating
  (those pipelines watch this one's `workflow_run` and refuse to deploy
  unless it succeeded for the matching tag) is documented in
  `.github/workflows/iac-apply.yml`'s closing comment but not implemented —
  there's nothing for it to gate yet.
- **Nothing has actually been applied.** Everything below is real, valid
  Terraform (`terraform validate` passes on every module and the `prod` root)
  but this session has no GCP project or credentials. `terraform plan`/`apply`
  have not been run against real infrastructure.

## One-time setup (do this before any pipeline can run)

### 1. Prerequisites

- A GCP project with billing enabled.
- `gcloud` CLI locally, with (or able to get) owner/editor on that project.

### 2. Identity setup — two options, pick one, not both

There are two ways to create the Workload Identity Federation pool/provider
and the Terraform CI service account. **Use whichever you use consistently
on a given project — running both against the same project will fight over
the same pool/provider names.**

**Option A — `IaC/scripts/setup-gcp.sh` (recommended if this GCP project
hosts, or will host, more than one repo's infrastructure).** It's a plain
idempotent script, not Terraform, specifically so it has no state-ownership
conflict with other repos doing the same setup on the same project — it
checks for an existing shared WIF pool/provider before creating one, never
recreates or narrows one that's already there, and only ever *adds* this
repo's own service account, IAM bindings, and state bucket. Not run
automatically by anything.

```
./IaC/scripts/setup-gcp.sh <your-project-id> Selkomark/MinCirklen.dk
```

It prints the exact `gh variable set` commands to run afterward.

**Option B — `IaC/bootstrap/`'s Terraform module.** Simpler if this project
will only ever run one repo's Terraform. Its state stays **local**, on
purpose — it creates the very state bucket everything else's remote state
lives in, so it can't use that remote-state flow itself.

```
cd IaC/bootstrap
terraform init
terraform apply \
  -var="project_id=<your-project-id>" \
  -var="state_bucket_name=<globally-unique-bucket-name>"
```

Keep the resulting `terraform.tfstate` somewhere safe (it's the only record
of the bootstrap resources). Note the outputs:

```
terraform output state_bucket_name
terraform output terraform_ci_service_account_email
terraform output workload_identity_provider
```

### 3. Wire GitHub Actions to whichever option you used

```
gh variable set GCP_PROJECT_ID --body "<your-project-id>"
gh variable set GCP_TERRAFORM_STATE_BUCKET --body "<state_bucket_name output>"
gh variable set GCP_TERRAFORM_SERVICE_ACCOUNT --body "<terraform_ci_service_account_email output>"
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --body "<workload_identity_provider output>"
```

None of these are secret values — WIF is specifically the point of not
needing a static service account key in GitHub secrets at all.

### 4. Production approval gate

Already configured for this repo: the `production` GitHub Environment
requires a manual approval before `iac-apply.yml`'s `apply` job runs
(section 7.4's "manual approval gate"). If you ever need to redo it:

```
gh api repos/Selkomark/MinCirklen.dk/environments/production -X PUT --input - <<'EOF'
{ "deployment_branch_policy": null, "reviewers": [{ "type": "User", "id": <your-numeric-github-user-id> }] }
EOF
```

## First-ever apply — a real GKE + Kubernetes provider gotcha

`environments/prod/providers.tf` configures the `kubernetes` provider from
the GKE cluster's own outputs (`module.gke.endpoint`, `.ca_certificate`).
That's the standard pattern, but it has one sharp edge: on the **very
first** apply of a brand-new environment, the cluster doesn't exist yet when
Terraform resolves provider configuration, so a single `terraform apply` can
fail. The documented workaround (this is a Terraform/GKE interaction, not a
bug in these modules):

```
terraform apply -target=module.gke   # create the cluster first
terraform apply                       # normal apply for everything else
```

Every apply after that (including CI's) is a normal single-pass apply.

## Releases

Deploys are cut by tagging, not branch pushes (section 7.4):

```
git tag prod-2026.08.20-1
git push origin prod-2026.08.20-1
```

That triggers `.github/workflows/iac-apply.yml`: plan → (wait for approval
in the `production` environment) → apply. `iac-plan.yml` runs on every PR
touching `IaC/**` as a read-only preview — it never applies anything.

## Local development

```
cd IaC/modules/<module>   # or environments/prod
terraform fmt
terraform init -backend=false   # no real backend needed just to validate
terraform validate
```

All modules and the `prod` root module pass `terraform validate` as of this
commit. A real `terraform plan` needs a real project — see Prerequisites.

## Cost

See tech spec section 8. Pilot-scale estimate is roughly $85–200/month
(infra only — the per-message moderation LLM call is the dominant variable
cost and is tracked separately). Validate against the GCP Pricing Calculator
once real traffic data exists rather than trusting these numbers indefinitely.
