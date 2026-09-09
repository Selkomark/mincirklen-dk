#!/usr/bin/env bash
#
# One-time GCP setup for this project's Terraform CI: Workload Identity
# Federation (GitHub Actions <-> GCP, no static service account key) and the
# GCS bucket Terraform remote state lives in. See README.md next to this
# script for full usage, flags, and what each section actually does.
#
# SAFE ON A SHARED PROJECT: every resource is checked for existence first.
# Nothing here is ever recreated, modified, or narrowed if it already
# exists — this script only ever *adds* a new service account, a new IAM
# binding, or a new bucket.
#
# Not run automatically by anything — invoke it yourself when ready.

set -euo pipefail

# ---------------------------------------------------------------------------
# Flags + args
# ---------------------------------------------------------------------------

SKIP_OIDC=false
SKIP_GCS=false
PROJECT_ID=""
GITHUB_REPO="Selkomark/MinCirklen.dk"
POSITIONAL=()

usage() {
  cat <<EOF
Usage: $(basename "$0") [--no-oidc] [--no-gcs] <PROJECT_ID> [GITHUB_REPO]

  --no-oidc   Skip the Workload Identity Federation section (pool, provider,
              per-repo service account, IAM bindings).
  --no-gcs    Skip the Terraform state bucket section.

  PROJECT_ID  required. GCP project ID to configure.
  GITHUB_REPO optional. "owner/repo", defaults to Selkomark/MinCirklen.dk.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-oidc) SKIP_OIDC=true; shift ;;
    --no-gcs) SKIP_GCS=true; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; POSITIONAL+=("$@"); break ;;
    -*) echo "Unknown flag: $1" >&2; usage >&2; exit 1 ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

PROJECT_ID="${POSITIONAL[0]:-}"
if [[ -n "${POSITIONAL[1]:-}" ]]; then
  GITHUB_REPO="${POSITIONAL[1]}"
fi

if [[ -z "$PROJECT_ID" ]]; then
  read -rp "GCP project ID: " PROJECT_ID
fi
if [[ -z "$PROJECT_ID" ]]; then
  echo "A project ID is required." >&2
  exit 1
fi

if [[ "$SKIP_OIDC" == true && "$SKIP_GCS" == true ]]; then
  echo "Both --no-oidc and --no-gcs given — nothing to do." >&2
  exit 1
fi

GITHUB_ORG="${GITHUB_REPO%%/*}"
REPO_SLUG="$(echo "$GITHUB_REPO" | tr '[:upper:]/.' '[:lower:]--' | tr -cd 'a-z0-9-')"

# Shared, reusable across every repo on this project — do not make these
# repo-specific. Override via env var if this project already uses different
# conventional names for its shared pool/provider.
POOL_ID="${WIF_POOL_ID:-github-actions}"
PROVIDER_ID="${WIF_PROVIDER_ID:-github}"

# Repo-specific — derived from the repo slug so multiple repos on the same
# project never collide. GCP service account IDs must be 6-30 chars,
# lowercase, start with a letter.
SA_ID="tf-ci-${REPO_SLUG}"
SA_ID="${SA_ID:0:30}"
SA_ID="${SA_ID%-}"
SA_EMAIL="${SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"

STATE_BUCKET="${STATE_BUCKET:-${PROJECT_ID}-terraform-state}"
REGION="${REGION:-europe-west1}"

echo "Project:      $PROJECT_ID"
echo "Repo:         $GITHUB_REPO"
echo "OIDC section: $([[ $SKIP_OIDC == true ]] && echo skipped || echo "pool=$POOL_ID provider=$PROVIDER_ID sa=$SA_ID")"
echo "GCS section:  $([[ $SKIP_GCS == true ]] && echo skipped || echo "bucket=$STATE_BUCKET")"
echo

# ---------------------------------------------------------------------------
# Auth + project context
# ---------------------------------------------------------------------------

if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
  echo "No active gcloud session — opening login..."
  gcloud auth login
else
  echo "Already logged in as: $(gcloud auth list --filter=status:ACTIVE --format='value(account)')"
fi

gcloud config set project "$PROJECT_ID" >/dev/null

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

# ---------------------------------------------------------------------------
# Base APIs this project needs regardless of which sections run below —
# idempotent, safe to re-run, doesn't touch anything section-specific.
# ---------------------------------------------------------------------------

echo "Enabling base APIs (skips any already enabled)..."
gcloud services enable \
  cloudresourcemanager.googleapis.com \
  compute.googleapis.com \
  run.googleapis.com \
  container.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  servicenetworking.googleapis.com \
  dns.googleapis.com \
  secretmanager.googleapis.com \
  vpcaccess.googleapis.com \
  certificatemanager.googleapis.com \
  pubsub.googleapis.com \
  storage.googleapis.com \
  iamcredentials.googleapis.com \
  --project="$PROJECT_ID"
# iamcredentials.googleapis.com lives here (not gated behind --no-oidc
# below) because it now serves two independent purposes: WIF token
# exchange for CI (the OIDC section's original reason) AND the IAM
# Credentials API's signBlob method, which data-export-service's Cloud
# Run identity needs regardless of whether this repo's CI/WIF is ever
# set up on this project — see IaC/environments/prod/main.tf's
# google_service_account_iam_member.data_export_service_self_sign.

# ===========================================================================
# OIDC section — Workload Identity Federation + per-repo service account.
# ===========================================================================

if [[ "$SKIP_OIDC" == true ]]; then
  echo "Skipping OIDC section (--no-oidc)."
else
  echo "Enabling OIDC-specific APIs..."
  gcloud services enable \
    iam.googleapis.com \
    sts.googleapis.com \
    --project="$PROJECT_ID"
  # iamcredentials.googleapis.com is enabled unconditionally in the base
  # APIs section above now, not here — see that section's comment.

  # --- Workload Identity Pool — shared. Reuse if it already exists (e.g.
  # another repo set it up first); create only if genuinely absent.
  if gcloud iam workload-identity-pools describe "$POOL_ID" \
      --project="$PROJECT_ID" --location=global >/dev/null 2>&1; then
    echo "Workload Identity Pool '$POOL_ID' already exists — reusing it as-is."
  else
    echo "Creating Workload Identity Pool '$POOL_ID'..."
    gcloud iam workload-identity-pools create "$POOL_ID" \
      --project="$PROJECT_ID" \
      --location=global \
      --display-name="GitHub Actions"
  fi

  # --- Workload Identity Provider — shared. If it already exists, reuse it
  # untouched (never narrow/widen its attribute condition — other repos may
  # depend on exactly what it currently allows). Only when creating it
  # fresh do we set an org-wide condition, specifically so it stays usable
  # by future repos in this GitHub org, not just this one.
  if gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
      --project="$PROJECT_ID" --location=global \
      --workload-identity-pool="$POOL_ID" >/dev/null 2>&1; then
    echo "Workload Identity Provider '$PROVIDER_ID' already exists — reusing it as-is."
  else
    echo "Creating Workload Identity Provider '$PROVIDER_ID' (scoped to GitHub org '$GITHUB_ORG')..."
    gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
      --project="$PROJECT_ID" \
      --location=global \
      --workload-identity-pool="$POOL_ID" \
      --display-name="GitHub" \
      --issuer-uri="https://token.actions.githubusercontent.com" \
      --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
      --attribute-condition="assertion.repository_owner == \"${GITHUB_ORG}\""
  fi

  WIF_PROVIDER_RESOURCE="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"

  # --- Per-repo service account — only this repo's identity, never shared.
  if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "Service account '$SA_EMAIL' already exists — reusing it."
  else
    echo "Creating service account '$SA_EMAIL'..."
    gcloud iam service-accounts create "$SA_ID" \
      --project="$PROJECT_ID" \
      --display-name="Terraform CI — ${GITHUB_REPO}"
  fi

  # Repo-specific restriction happens HERE, not on the shared provider: only
  # tokens whose `repository` claim matches this exact repo can impersonate
  # this specific SA. Binding an already-present member is a harmless no-op.
  echo "Binding workloadIdentityUser for ${GITHUB_REPO} on ${SA_EMAIL}..."
  gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
    --project="$PROJECT_ID" \
    --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/${WIF_PROVIDER_RESOURCE}/attribute.repository/${GITHUB_REPO}" \
    >/dev/null

  # Least-privilege roles for what IaC/modules actually provisions — never
  # roles/editor or roles/owner. add-iam-policy-binding is additive:
  # existing bindings for other principals on this project are untouched.
  echo "Granting least-privilege project roles to ${SA_EMAIL}..."
  ROLES=(
    roles/compute.networkAdmin
    roles/compute.loadBalancerAdmin
    roles/compute.securityAdmin
    roles/container.admin
    roles/run.admin
    roles/cloudsql.admin
    roles/redis.admin
    roles/dns.admin
    roles/secretmanager.admin
    roles/iam.serviceAccountAdmin
    roles/vpcaccess.admin
    roles/servicenetworking.networksAdmin
    roles/resourcemanager.projectIamAdmin
    roles/storage.admin
    roles/pubsub.admin
  )
  for role in "${ROLES[@]}"; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
      --member="serviceAccount:${SA_EMAIL}" \
      --role="$role" \
      --condition=None \
      >/dev/null
  done
fi

# ===========================================================================
# GCS section — Terraform remote state bucket.
# ===========================================================================

if [[ "$SKIP_GCS" == true ]]; then
  echo "Skipping GCS section (--no-gcs)."
else
  # storage.googleapis.com is enabled unconditionally in the base APIs
  # section above now, not here — see that section's comment.

  # Shared per project (per-repo/per-environment separation happens via
  # backend prefix, see environments/prod/backend.tf). Reuse if it exists.
  if gcloud storage buckets describe "gs://${STATE_BUCKET}" >/dev/null 2>&1; then
    echo "State bucket 'gs://${STATE_BUCKET}' already exists — reusing it."
  else
    echo "Creating state bucket 'gs://${STATE_BUCKET}'..."
    gcloud storage buckets create "gs://${STATE_BUCKET}" \
      --project="$PROJECT_ID" \
      --location="$REGION" \
      --uniform-bucket-level-access \
      --public-access-prevention
    gcloud storage buckets update "gs://${STATE_BUCKET}" --versioning
  fi
fi

# ---------------------------------------------------------------------------
# Done — print only what actually ran.
# ---------------------------------------------------------------------------

echo
echo "Done. Set these as GitHub repo variables (not secrets — none of this is sensitive):"
echo
echo "  gh variable set GCP_PROJECT_ID --body \"${PROJECT_ID}\""
if [[ "$SKIP_GCS" != true ]]; then
  echo "  gh variable set GCP_TERRAFORM_STATE_BUCKET --body \"${STATE_BUCKET}\""
fi
if [[ "$SKIP_OIDC" != true ]]; then
  echo "  gh variable set GCP_TERRAFORM_SERVICE_ACCOUNT --body \"${SA_EMAIL}\""
  echo "  gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --body \"${WIF_PROVIDER_RESOURCE}\""
fi
