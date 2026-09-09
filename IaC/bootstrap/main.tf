// One-time bootstrap, applied manually by a human with project-owner/editor
// credentials — NOT run by CI. It creates the things CI's own Terraform runs
// depend on (the state bucket, the identity CI authenticates as), so it can't
// bootstrap itself the normal remote-state way. State for *this* module stays
// local (see README.md) and the resulting bucket name / WIF provider / service
// account become GitHub repo variables/secrets for every other pipeline.
//
// If this GCP project hosts (or will host) more than one repo's
// infrastructure, use ../scripts/setup-gcp.sh instead of this module for
// the WIF pool/provider/SA/bucket — it's mindful of identity resources other
// repos may have already created on the same project in a way a second,
// separate Terraform state can't be. Don't run both against the same
// project (see README.md).

terraform {
  required_version = ">= 1.7.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ---------------------------------------------------------------------------
# APIs every environment's Terraform run will need enabled.
# ---------------------------------------------------------------------------

locals {
  required_apis = [
    "compute.googleapis.com",
    "run.googleapis.com",
    "container.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "servicenetworking.googleapis.com",
    "dns.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "vpcaccess.googleapis.com",
    "certificatemanager.googleapis.com",
    "sts.googleapis.com",
    "cloudkms.googleapis.com",
    # Both added for the GDPR data-export pipeline (IaC/modules/pubsub,
    # google_storage_bucket.data_exports in environments/prod/main.tf).
    # storage.googleapis.com wasn't previously listed explicitly — the
    # state bucket below happened to work regardless since most projects
    # have it enabled by default, but a fresh project shouldn't have to
    # rely on that.
    "pubsub.googleapis.com",
    "storage.googleapis.com",
  ]
}

resource "google_project_service" "required" {
  for_each = toset(local.required_apis)

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# ---------------------------------------------------------------------------
# Remote state bucket. One bucket, one object prefix per environment — each
# environment's backend.tf points at its own prefix, satisfying "one state
# file per environment" without needing three separate buckets.
# ---------------------------------------------------------------------------

resource "google_storage_bucket" "terraform_state" {
  name     = var.state_bucket_name
  project  = var.project_id
  location = var.region

  uniform_bucket_level_access = true
  versioning {
    enabled = true
  }

  # State holds no secret *values* (see IaC/modules/secrets), but it does hold
  # resource metadata — keep it private and out of the object-deletion path.
  public_access_prevention = "enforced"

  lifecycle_rule {
    condition {
      num_newer_versions = 20
    }
    action {
      type = "Delete"
    }
  }
}

# ---------------------------------------------------------------------------
# Workload Identity Federation: lets GitHub Actions authenticate as a GCP
# service account via short-lived OIDC tokens instead of a long-lived JSON
# key. Scoped to this one repo only.
# ---------------------------------------------------------------------------

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
  description               = "Federated identities for GitHub Actions CI/CD"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Only tokens minted for workflow runs on this exact repo can federate in.
  attribute_condition = "assertion.repository == \"${var.github_repository}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "terraform_ci" {
  project      = var.project_id
  account_id   = "terraform-ci"
  display_name = "Terraform CI (GitHub Actions)"
  description  = "Identity GitHub Actions assumes to run terraform plan/apply. Least-privilege roles only — never project editor/owner."
}

resource "google_service_account_iam_member" "wif_binding" {
  service_account_id = google_service_account.terraform_ci.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

# Least-privilege roles for the CI identity — scoped to exactly what the
# modules in IaC/modules provision. Deliberately not roles/editor.
locals {
  terraform_ci_roles = [
    "roles/compute.networkAdmin",
    "roles/compute.loadBalancerAdmin",
    "roles/compute.securityAdmin",
    "roles/container.admin",
    "roles/run.admin",
    "roles/cloudsql.admin",
    "roles/redis.admin",
    "roles/dns.admin",
    "roles/secretmanager.admin",
    "roles/iam.serviceAccountAdmin",
    "roles/vpcaccess.admin",
    "roles/servicenetworking.networksAdmin",
    "roles/resourcemanager.projectIamAdmin",
    "roles/storage.admin",
    "roles/pubsub.admin", # IaC/modules/pubsub
  ]
}

resource "google_project_iam_member" "terraform_ci" {
  for_each = toset(local.terraform_ci_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.terraform_ci.email}"
}
