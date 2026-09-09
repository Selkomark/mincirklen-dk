output "load_balancer_ip" {
  value = module.networking.load_balancer_ip
}

output "gke_cluster_name" {
  value = module.gke.cluster_name
}

output "trpc_service_account" {
  value = google_service_account.trpc_api.email
}

output "websocket_service_account" {
  value = google_service_account.websocket_service.email
}

output "moderation_service_account" {
  value = google_service_account.moderation_service.email
}

output "data_export_service_account" {
  value = google_service_account.data_export_service.email
}

output "cloud_sql_connection_name" {
  value = module.cloud_sql.instance_connection_name
}
