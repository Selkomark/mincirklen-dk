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
  description = "VPC self_link/id from modules/networking."
  type        = string
}

variable "subnetwork_id" {
  description = "Public subnet id from modules/networking — Autopilot nodes live here."
  type        = string
}

variable "pods_secondary_range_name" {
  type    = string
  default = "pods"
}

variable "services_secondary_range_name" {
  type    = string
  default = "services"
}

variable "release_channel" {
  description = "REGULAR is the sane default; STABLE for prod once the pilot has run long enough to trust it."
  type        = string
  default     = "REGULAR"
}

variable "authorized_networks" {
  description = "CIDR blocks allowed to reach the GKE control plane API (e.g. CI runner egress ranges, office IP). Empty = only Google-internal access, which is fine since deploys go through Workload Identity Federation, not kubectl from a laptop."
  type = list(object({
    cidr_block   = string
    display_name = string
  }))
  default = []
}
