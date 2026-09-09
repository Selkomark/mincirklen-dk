variable "project_id" {
  description = "GCP project ID that hosts all MinCirklen infrastructure."
  type        = string
}

variable "region" {
  description = "Default GCP region for the state bucket and regional resources."
  type        = string
  default     = "europe-west1"
}

variable "state_bucket_name" {
  description = "Globally-unique GCS bucket name for Terraform remote state. Bucket names are global across all of GCP, so this can't reuse a generic name like 'mincirklen-tf-state' if it's taken — adjust per your project."
  type        = string
  default     = "mincirklen-terraform-state"
}

variable "github_repository" {
  description = "GitHub repo allowed to federate in via Workload Identity Federation, as \"owner/name\"."
  type        = string
  default     = "Selkomark/MinCirklen.dk"
}
