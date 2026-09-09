variable "project_id" {
  type = string
}

variable "environment" {
  type = string
}

variable "secret_ids" {
  description = "Logical secret names to create as empty Secret Manager secrets — e.g. [\"moderation-service-config-ref\", \"oauth-client-secret\"]. Values are added out-of-band (gcloud secrets versions add, or a service's own deploy pipeline) — never via Terraform, so no secret value ever enters Terraform state."
  type        = list(string)
  default     = []
}

variable "accessor_bindings" {
  description = "secret_id -> list of members (\"serviceAccount:...\") granted roles/secretmanager.secretAccessor on exactly that secret. Every binding here should be one specific service's identity, never a broad group."
  type        = map(list(string))
  default     = {}
}
