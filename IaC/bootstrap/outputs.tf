output "state_bucket_name" {
  description = "Feed this into every environment's backend.tf (bucket = ...)."
  value       = google_storage_bucket.terraform_state.name
}

output "terraform_ci_service_account_email" {
  description = "Service account GitHub Actions authenticates as."
  value       = google_service_account.terraform_ci.email
}

output "workload_identity_provider" {
  description = "Full resource name for the GH Actions `google-github-actions/auth` step's workload_identity_provider input."
  value       = google_iam_workload_identity_pool_provider.github.name
}
