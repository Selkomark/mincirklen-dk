variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "environment" {
  type = string
}

variable "use_memorystore" {
  description = "false (default) self-hosts Redis on GKE Autopilot (StatefulSet + PVC, AOF persistence) — materially cheaper at scale per section 8.3. true switches to managed Memorystore, the simpler-to-operate option worth revisiting once pilot data answers the open question in section 11."
  type        = bool
  default     = false
}

# --- Self-hosted (GKE) path ---

variable "namespace" {
  type    = string
  default = "data"
}

variable "storage_class_name" {
  description = "GKE Autopilot's default is 'standard-rwo' (Persistent Disk SSD)."
  type        = string
  default     = "standard-rwo"
}

variable "storage_size" {
  type    = string
  default = "10Gi"
}

variable "redis_image" {
  type    = string
  default = "redis:7.2-alpine"
}

# --- Memorystore path ---

variable "network_id" {
  description = "Required only when use_memorystore = true."
  type        = string
  default     = null
}

variable "private_vpc_connection" {
  description = "Required only when use_memorystore = true — forces waiting on private-services peering."
  type        = any
  default     = null
}

variable "memorystore_tier" {
  description = "BASIC (no HA, cheapest) or STANDARD_HA."
  type        = string
  default     = "BASIC"
}

variable "memorystore_memory_size_gb" {
  type    = number
  default = 1
}
