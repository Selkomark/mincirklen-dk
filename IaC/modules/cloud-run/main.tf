// Reusable Cloud Run service shell — used for the tRPC API, the moderation
// service, and the web-app's SSR service (section 7.1). Terraform owns the
// service resource and its scaling/ingress/networking config; each service's
// own CI pipeline owns pushing new images/revisions into it (section 7.3) —
// deploys happen out-of-band via `gcloud run deploy --image ...`, not by
// re-running terraform apply for every code change.

resource "google_service_account" "this" {
  count = var.service_account_email == null ? 1 : 0

  project      = var.project_id
  account_id   = "${var.service_name}-${var.environment}"
  display_name = "${var.service_name} (${var.environment})"
}

locals {
  service_account_email = var.service_account_email != null ? var.service_account_email : google_service_account.this[0].email
}

resource "google_cloud_run_v2_service" "this" {
  project  = var.project_id
  name     = "${var.service_name}-${var.environment}"
  location = var.region
  ingress  = var.ingress

  template {
    service_account = local.service_account_email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    dynamic "vpc_access" {
      for_each = var.vpc_connector_id != null ? [1] : []
      content {
        connector = var.vpc_connector_id
        egress    = var.vpc_egress
      }
    }

    containers {
      image = var.image

      ports {
        container_port = var.container_port
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
      }

      dynamic "env" {
        for_each = var.env_vars
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.secret_env_vars
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      # The service's own CI pipeline deploys new revisions by updating the
      # image directly (gcloud run deploy) — don't fight it back to whatever
      # image Terraform last saw.
      template[0].containers[0].image,
    ]
  }
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  count = var.allow_unauthenticated ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.this.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "specific_invokers" {
  for_each = var.allow_unauthenticated ? toset([]) : toset(var.invoker_members)

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.this.name
  role     = "roles/run.invoker"
  member   = each.value
}
