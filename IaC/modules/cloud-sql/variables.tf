variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "environment" {
  type = string
}

variable "network_id" {
  description = "VPC id from modules/networking — Cloud SQL gets a private IP on this network."
  type        = string
}

variable "private_vpc_connection" {
  description = "The google_service_networking_connection from modules/networking, passed through purely to force Terraform to wait for private-services peering before creating the instance."
  type        = any
}

variable "database_version" {
  type    = string
  default = "POSTGRES_16"
}

variable "tier" {
  description = "db-f1-micro/db-g1-small for dev/staging pilot scale; size up per section 8.2 once real traffic exists."
  type        = string
  default     = "db-g1-small"
}

variable "disk_size_gb" {
  type    = number
  default = 20
}

variable "availability_type" {
  description = "ZONAL for dev/staging; REGIONAL (HA) for prod."
  type        = string
  default     = "ZONAL"
}

variable "database_name" {
  type    = string
  default = "mincirklen"
}

variable "deletion_protection" {
  type    = bool
  default = false
}

variable "iam_service_accounts" {
  description = "Service account emails allowed to connect via Cloud SQL IAM database authentication — no passwords are created or stored anywhere, including Terraform state (section 7.2's no-secrets-in-state rule)."
  type        = list(string)
  default     = []
}

variable "backup_start_time" {
  description = "HH:MM, UTC."
  type        = string
  default     = "03:00"
}
