output "secret_ids" {
  description = "Map of logical name -> full Secret Manager secret_id, for wiring into modules/cloud-run's secret_env_vars."
  value       = { for k, v in google_secret_manager_secret.this : k => v.secret_id }
}
