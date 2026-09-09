output "cluster_id" {
  value = google_container_cluster.primary.id
}

output "cluster_name" {
  value = google_container_cluster.primary.name
}

output "endpoint" {
  description = "Control-plane endpoint, for configuring the Kubernetes/Helm providers at the environment root."
  value       = google_container_cluster.primary.endpoint
  sensitive   = true
}

output "ca_certificate" {
  value     = google_container_cluster.primary.master_auth[0].cluster_ca_certificate
  sensitive = true
}
