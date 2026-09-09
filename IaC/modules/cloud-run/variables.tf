variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "environment" {
  type = string
}

variable "service_name" {
  description = "e.g. trpc-api, moderation-service, web-app."
  type        = string
}

variable "image" {
  description = "Full container image URL. Each service's own CI pipeline pushes here and updates this — Terraform owns the service shell, not the deployed revision (section 7.3)."
  type        = string
}

variable "container_port" {
  type    = number
  default = 8080
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "512Mi"
}

variable "min_instances" {
  description = "0 = scale-to-zero, matching section 5's scaling model for tRPC API and moderation service."
  type        = number
  default     = 0
}

variable "max_instances" {
  type    = number
  default = 10
}

variable "env_vars" {
  description = "Plain (non-secret) environment variables."
  type        = map(string)
  default     = {}
}

variable "secret_env_vars" {
  description = "Env var name -> Secret Manager secret id (latest version). Values never pass through Terraform state (see modules/secrets)."
  type        = map(string)
  default     = {}
}

variable "ingress" {
  description = "INGRESS_TRAFFIC_ALL | INGRESS_TRAFFIC_INTERNAL_ONLY | INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER. Section 6 requires every Cloud Run service in this system to NOT be reachable via its own public run.app URL — only the moderation service (INTERNAL_ONLY) and the LB-fronted services (INTERNAL_LOAD_BALANCER) are valid choices; never INGRESS_TRAFFIC_ALL."
  type        = string
  default     = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  validation {
    condition     = contains(["INGRESS_TRAFFIC_INTERNAL_ONLY", "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"], var.ingress)
    error_message = "INGRESS_TRAFFIC_ALL is not allowed for any service in this architecture — see tech spec section 6."
  }
}

variable "vpc_connector_id" {
  description = "Serverless VPC Access connector id, for services that need to reach Redis/Cloud SQL/the moderation service privately."
  type        = string
  default     = null
}

variable "vpc_egress" {
  description = "ALL_TRAFFIC routes all egress through the VPC connector (moderation service, so its only path out is via Cloud NAT); PRIVATE_RANGES_ONLY only routes RFC1918-bound traffic through it (tRPC API, which still needs the public internet for e.g. OAuth providers)."
  type        = string
  default     = "PRIVATE_RANGES_ONLY"
}

variable "service_account_email" {
  description = "Pre-created service account for this service to run as. If null, the module creates one scoped to just this service."
  type        = string
  default     = null
}

variable "allow_unauthenticated" {
  description = "Grant roles/run.invoker to allUsers. Only appropriate for services sitting behind the public LB (tRPC API, web-app) — never the moderation service."
  type        = bool
  default     = false
}

variable "invoker_members" {
  description = "Specific principals (e.g. \"serviceAccount:trpc-api@...\") granted roles/run.invoker instead of allUsers — how the moderation service authorizes exactly one caller."
  type        = list(string)
  default     = []
}
