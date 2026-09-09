variable "project_id" {
  type = string
}

variable "environment" {
  type = string
}

variable "topic_name" {
  description = "e.g. data-export-requests. Environment suffix is added internally, matching modules/cloud-run's naming."
  type        = string
}

variable "publisher_members" {
  description = "Principals (e.g. \"serviceAccount:trpc-api-prod@...\") granted roles/pubsub.publisher on the main topic. Never a project-wide binding."
  type        = list(string)
  default     = []
}

variable "push_endpoint" {
  description = "Full URL the main subscription pushes to — e.g. the Cloud Run service's URI plus \"/pubsub/push\"."
  type        = string
}

variable "dead_letter_push_endpoint" {
  description = "Full URL the dead-letter subscription pushes to — e.g. the Cloud Run service's URI plus \"/pubsub/dead-letter\". Reaching this endpoint means the main subscription already exhausted max_delivery_attempts."
  type        = string
}

variable "push_service_account_email" {
  description = "Identity Pub/Sub mints OIDC tokens for on every push request to either endpoint above — the receiving service verifies the token's signature against this. Must already exist; this module only grants it the token-creation permission Pub/Sub itself needs (roles/iam.serviceAccountTokenCreator), it doesn't create the SA. Granting it roles/run.invoker on the target Cloud Run service is the caller's job (modules/cloud-run's invoker_members), not this module's — it has no Cloud Run-specific knowledge."
  type        = string
}

variable "push_audience" {
  description = "The OIDC token's audience claim, checked by the receiving service (see PUSH_AUTH_AUDIENCE in data-export-service's own config). Defaults to push_endpoint's own value, the common convention, but can be overridden to a shared value (e.g. just the Cloud Run service's base URI) if the receiver checks a coarser audience than the exact per-endpoint URL."
  type        = string
  default     = null
}

variable "max_delivery_attempts" {
  description = "How many times the main subscription retries a failing push before Pub/Sub forwards the message to the dead-letter topic instead."
  type        = number
  default     = 5
}

variable "ack_deadline_seconds" {
  type    = number
  default = 10
}

variable "message_retention_duration" {
  type    = string
  default = "604800s" # 7 days
}
