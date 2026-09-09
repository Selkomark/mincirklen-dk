variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "environment" {
  type = string
}

variable "namespace" {
  type    = string
  default = "glitchtip"
}

variable "image" {
  description = "e.g. glitchtip/glitchtip@sha256:... — pin by digest, same convention as docker-compose.yml's local dev image."
  type        = string
}

variable "domain" {
  description = "Full https://... GLITCHTIP_DOMAIN, e.g. https://glitchtip.mincirklen.dk"
  type        = string
}

variable "service_account_email" {
  description = "GSA for Workload Identity — needs Cloud SQL IAM auth (roles/cloudsql.instanceUser + roles/cloudsql.client, granted by the caller via modules/cloud-sql's iam_service_accounts) and Secret Manager access to secret_manager_secret_id (granted by the caller via modules/secrets' accessor_bindings). Created at the environment root, same reasoning as trpc-api/moderation-service's GSAs in that file's own comment."
  type        = string
}

variable "cloud_sql_instance_connection_name" {
  description = "PROJECT:REGION:INSTANCE, from modules/cloud-sql's instance_connection_name output — for the Cloud SQL Auth Proxy sidecar."
  type        = string
}

variable "database_name" {
  type    = string
  default = "glitchtip"
}

variable "redis_host" {
  description = "From a dedicated modules/redis call (use_memorystore = false, its own namespace) — deliberately not the app's own Redis, see that module's caller-side comment."
  type        = string
}

variable "redis_port" {
  type    = number
  default = 6379
}

variable "secret_manager_secret_id" {
  description = "Short secret ID (not the full resource name) of the Django SECRET_KEY secret from modules/secrets, e.g. \"glitchtip-secret-key-prod\". Value is added out-of-band — see modules/secrets' own file comment for why."
  type        = string
}

variable "cloud_sql_proxy_image" {
  type    = string
  default = "gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.14.2"
}

variable "service_port" {
  description = "Port the Kubernetes Service (and the LB's NEG, wired at the environment root) listens on — proxied to the container's own :8000."
  type        = number
  default     = 8000
}
