output "service_name" {
  value = google_cloud_run_v2_service.this.name
}

output "service_account_email" {
  value = local.service_account_email
}

output "uri" {
  description = "The run.app URL — not the public entry point (ingress is LB-restricted), but useful for the LB's serverless NEG to reference and for internal debugging."
  value       = google_cloud_run_v2_service.this.uri
}
