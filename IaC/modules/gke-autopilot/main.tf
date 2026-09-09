// GKE Autopilot cluster for the WebSocket service and NATS (section 5).
// Autopilot manages node pools itself — there's no node-pool resource here.
// Per-workload Spot eligibility (WS pods: yes: NATS/Redis: no, section 8.3) is
// set in the workload's own Deployment/StatefulSet manifest via
// `spec.nodeSelector["cloud.google.com/gke-spot"] = "true"`, in the web-app
// repo — not something Terraform controls at the cluster level.

resource "google_container_cluster" "primary" {
  project  = var.project_id
  name     = "mincirklen-${var.environment}"
  location = var.region

  enable_autopilot = true

  network    = var.network_id
  subnetwork = var.subnetwork_id

  ip_allocation_policy {
    cluster_secondary_range_name  = var.pods_secondary_range_name
    services_secondary_range_name = var.services_secondary_range_name
  }

  release_channel {
    channel = var.release_channel
  }

  # Autopilot enables Workload Identity by default; set explicitly so it's
  # not an implicit assumption future readers have to go verify.
  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false # control-plane API still reachable for CI/CD deploy steps
  }

  dynamic "master_authorized_networks_config" {
    for_each = length(var.authorized_networks) > 0 ? [1] : []
    content {
      dynamic "cidr_blocks" {
        for_each = var.authorized_networks
        content {
          cidr_block   = cidr_blocks.value.cidr_block
          display_name = cidr_blocks.value.display_name
        }
      }
    }
  }

  deletion_protection = var.environment == "prod"
}
