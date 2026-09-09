// Shared room/matchmaking state (section 5) — reached independently by the
// tRPC API, WebSocket service, and web-app. Two mutually-exclusive hosting
// paths behind var.use_memorystore; only one set of resources is ever
// created (section 8.3: this should never run on spot capacity either way —
// the self-hosted StatefulSet has no node selector for spot, so Autopilot
// schedules it on standard nodes by default).
//
// The kubernetes provider for the self-hosted path is NOT configured in this
// module (providers belong at the environment root, not baked into a shared
// module) — the caller must configure it from the GKE cluster's own outputs
// before calling this module. See environments/*/providers.tf.

resource "kubernetes_namespace_v1" "data" {
  count = var.use_memorystore ? 0 : 1

  metadata {
    name = var.namespace
  }
}

resource "kubernetes_stateful_set_v1" "redis" {
  count = var.use_memorystore ? 0 : 1

  metadata {
    name      = "redis"
    namespace = kubernetes_namespace_v1.data[0].metadata[0].name
  }

  spec {
    service_name = "redis"
    replicas     = 1

    selector {
      match_labels = { app = "redis" }
    }

    template {
      metadata {
        labels = { app = "redis" }
      }

      spec {
        # No cloud.google.com/gke-spot node selector, deliberately — this
        # state is correctness-critical (section 8.3).
        container {
          name  = "redis"
          image = var.redis_image

          port {
            container_port = 6379
          }

          # AOF persistence per the roadmap's data-retention/durability intent.
          command = ["redis-server", "--appendonly", "yes", "--appendfsync", "everysec"]

          volume_mount {
            name       = "redis-data"
            mount_path = "/data"
          }

          resources {
            requests = {
              cpu    = "250m"
              memory = "512Mi"
            }
            limits = {
              cpu    = "500m"
              memory = "1Gi"
            }
          }
        }
      }
    }

    volume_claim_template {
      metadata {
        name = "redis-data"
      }
      spec {
        access_modes       = ["ReadWriteOnce"]
        storage_class_name = var.storage_class_name
        resources {
          requests = {
            storage = var.storage_size
          }
        }
      }
    }
  }
}

resource "kubernetes_service_v1" "redis" {
  count = var.use_memorystore ? 0 : 1

  metadata {
    name      = "redis"
    namespace = kubernetes_namespace_v1.data[0].metadata[0].name
  }

  spec {
    selector = { app = "redis" }
    port {
      port        = 6379
      target_port = 6379
    }
    # A real ClusterIP (not headless) — it needs to be reachable from Cloud
    # Run's Serverless VPC Access connector too (tRPC API + web-app), and
    # *.svc.cluster.local DNS only resolves for in-cluster clients. The
    # WebSocket service (in-cluster) can use either the IP or cluster DNS;
    # Cloud Run must use the IP, hence this module's `host` output.
    type = "ClusterIP"
  }
}

resource "google_redis_instance" "this" {
  count = var.use_memorystore ? 1 : 0

  project        = var.project_id
  name           = "mincirklen-${var.environment}"
  region         = var.region
  tier           = var.memorystore_tier
  memory_size_gb = var.memorystore_memory_size_gb

  authorized_network      = var.network_id
  connect_mode            = "PRIVATE_SERVICE_ACCESS"
  transit_encryption_mode = "SERVER_AUTHENTICATION"

  # Memorystore has no persistence by default (persistence_mode defaults to
  # DISABLED) — without this, a maintenance event or instance restart loses
  # everything, unlike the self-hosted path above which has AOF+PVC. RDB is
  # the only option Memorystore offers (no AOF); hourly is the tightest
  # snapshot period available.
  persistence_config {
    persistence_mode    = "RDB"
    rdb_snapshot_period = "ONE_HOUR"
  }

  depends_on = [var.private_vpc_connection]
}
