output "vpc_id" {
  value = google_compute_network.vpc.id
}

output "vpc_name" {
  value = google_compute_network.vpc.name
}

output "public_subnet_id" {
  value = google_compute_subnetwork.public.id
}

output "public_subnet_name" {
  value = google_compute_subnetwork.public.name
}

output "private_subnet_id" {
  value = google_compute_subnetwork.private.id
}

output "vpc_connector_id" {
  description = "Feed into Cloud Run services (modules/cloud-run) that need private VPC egress."
  value       = google_vpc_access_connector.connector.id
}

output "private_vpc_connection" {
  description = "Ensures Cloud SQL/Memorystore wait for private-services peering before creating their private IP."
  value       = google_service_networking_connection.private_services
}

output "load_balancer_ip" {
  value = google_compute_global_address.lb_ip.address
}

output "pods_secondary_range_name" {
  value = "pods"
}

output "services_secondary_range_name" {
  value = "services"
}
