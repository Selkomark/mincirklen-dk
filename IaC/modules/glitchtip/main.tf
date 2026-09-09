# Self-hosted, Sentry-SDK-compatible error/log tracking (SECURITY.md's
# "Error/log tracking" section covers the local dev equivalent of this same
# stack) — runs on the same GKE Autopilot cluster as websocket-service
# rather than Cloud Run, because GlitchTip's celery worker/beat processes
# need to run continuously independent of any HTTP request, and its
# Postgres/Redis dependencies aren't things Cloud Run can host at all. See
# ARCHITECTURE.md-adjacent reasoning: this mirrors modules/redis's own
# "self-hosted on GKE, not a managed service" cost posture.

locals {
  # Cloud SQL strips the .gserviceaccount.com suffix for IAM SA usernames —
  # same convention as modules/cloud-sql's own google_sql_user resource.
  db_iam_user = trimsuffix(var.service_account_email, ".gserviceaccount.com")
}

resource "kubernetes_namespace_v1" "glitchtip" {
  metadata {
    name = var.namespace
  }
}

# Workload Identity: this KSA is what the pod actually runs as; the
# annotation is what binds it to the real GCP service account passed in
# (created at the environment root, granted Cloud SQL IAM auth +
# Secret Manager access there — see variables.tf's own comment on why).
resource "kubernetes_service_account_v1" "glitchtip" {
  metadata {
    name      = "glitchtip"
    namespace = kubernetes_namespace_v1.glitchtip.metadata[0].name
    annotations = {
      "iam.gke.io/gcp-service-account" = var.service_account_email
    }
  }
}

resource "google_service_account_iam_member" "workload_identity" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${var.service_account_email}"
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[${var.namespace}/${kubernetes_service_account_v1.glitchtip.metadata[0].name}]"
}

resource "kubernetes_deployment_v1" "glitchtip" {
  metadata {
    name      = "glitchtip"
    namespace = kubernetes_namespace_v1.glitchtip.metadata[0].name
    labels    = { app = "glitchtip" }
  }

  spec {
    replicas = 1 # SERVER_ROLE=all_in_one bundles web+worker+beat in one process — celery beat must never run more than once, so this can't be scaled horizontally as-is (matches the local dev docker-compose plan)

    selector {
      match_labels = { app = "glitchtip" }
    }

    template {
      metadata {
        labels = { app = "glitchtip" }
      }

      spec {
        service_account_name = kubernetes_service_account_v1.glitchtip.metadata[0].name

        # Fetches the Django SECRET_KEY from Secret Manager (via ambient
        # Workload Identity credentials — no key file, no explicit gcloud
        # auth step) into a volume the main container reads at startup.
        # Deliberately not a Kubernetes-native Secret resource: that would
        # mean passing the real value through a Terraform variable, which
        # lands in state — the exact thing modules/secrets' own file
        # comment says never to do. The value itself is added out-of-band
        # (gcloud secrets versions add), same as every other secret in
        # this repo's IaC.
        init_container {
          name    = "fetch-secret-key"
          image   = "gcr.io/google.com/cloudsdktool/cloud-sdk:slim"
          command = ["sh", "-c"]
          args = [
            "gcloud secrets versions access latest --secret=${var.secret_manager_secret_id} --project=${var.project_id} > /secrets/secret-key"
          ]
          volume_mount {
            name       = "secret-key"
            mount_path = "/secrets"
          }
        }

        # IAM-authenticated connection to the shared Cloud SQL instance —
        # same auth model as trpc-api/websocket-service (see
        # modules/cloud-sql's iam_service_accounts), just via a sidecar
        # instead of a Node/Bun-native connector library. --auto-iam-authn
        # means the main container never needs a database password at all.
        container {
          name  = "cloud-sql-proxy"
          image = var.cloud_sql_proxy_image
          args = [
            "--auto-iam-authn",
            "--port=5432",
            var.cloud_sql_instance_connection_name,
          ]
          resources {
            requests = {
              cpu    = "100m"
              memory = "128Mi"
            }
            limits = {
              memory = "256Mi"
            }
          }
        }

        container {
          name  = "glitchtip"
          image = var.image

          command = ["sh", "-c"]
          args = [
            "export SECRET_KEY=\"$(cat /secrets/secret-key)\" && exec ./bin/start.sh"
          ]

          env {
            name  = "SERVER_ROLE"
            value = "all_in_one"
          }
          env {
            name  = "DATABASE_URL"
            value = "postgres://${local.db_iam_user}@127.0.0.1:5432/${var.database_name}"
          }
          env {
            name  = "VALKEY_URL"
            value = "redis://${var.redis_host}:${var.redis_port}"
          }
          env {
            name  = "GLITCHTIP_DOMAIN"
            value = var.domain
          }
          env {
            name  = "GLITCHTIP_ENABLE_LOGS"
            value = "True" # web-app's Sentry SDK sends logs — see services/web-app/src/sentry.ts
          }

          port {
            container_port = 8000
          }

          volume_mount {
            name       = "secret-key"
            mount_path = "/secrets"
            read_only  = true
          }

          resources {
            requests = {
              cpu    = "250m"
              memory = "512Mi"
            }
            limits = {
              memory = "1Gi"
            }
          }

          readiness_probe {
            http_get {
              path = "/_health/"
              port = 8000
            }
            initial_delay_seconds = 15
            period_seconds        = 10
          }
        }

        volume {
          name = "secret-key"
          empty_dir {}
        }
      }
    }
  }
}

resource "kubernetes_service_v1" "glitchtip" {
  metadata {
    name      = "glitchtip"
    namespace = kubernetes_namespace_v1.glitchtip.metadata[0].name
    # Attaches this Service's pod endpoints to the zonal NEGs
    # environments/prod/main.tf's networking module call creates for it —
    # same container-native-routing annotation shape documented in
    # modules/networking/load-balancer.tf's websocket comment, just wired
    # here directly since (unlike websocket-service) glitchtip's
    # Deployment/Service are Terraform-managed, not deployed by a
    # separate app-repo pipeline.
    annotations = {
      "cloud.google.com/neg" = jsonencode({
        exposed_ports = {
          (tostring(var.service_port)) = { name = "glitchtip-neg-${var.environment}" }
        }
      })
    }
  }

  spec {
    selector = { app = "glitchtip" }
    port {
      port        = var.service_port
      target_port = 8000
    }
    type = "ClusterIP"
  }
}
