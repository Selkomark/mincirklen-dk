variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "Primary region for regional resources (subnets, connector, NAT, NEGs)."
  type        = string
}

variable "environment" {
  description = "dev | staging | prod — used in resource names."
  type        = string
}

variable "domain" {
  description = "Root public domain. Cloud DNS zone and all subdomains are derived from this."
  type        = string
  default     = "mincirklen.dk"
}

variable "manage_dns_zone" {
  description = "Whether this environment owns the public Cloud DNS zone for var.domain. Only one environment (normally prod) should own the apex zone — others can point subdomains at it externally, or use a separate test domain."
  type        = bool
  default     = false
}

variable "public_subnet_cidr" {
  description = "Primary IP range for the public subnet (hosts the GKE Autopilot cluster)."
  type        = string
  default     = "10.10.0.0/20"
}

variable "public_subnet_pods_cidr" {
  description = "Secondary range for GKE pod IPs."
  type        = string
  default     = "10.20.0.0/14"
}

variable "public_subnet_services_cidr" {
  description = "Secondary range for GKE service IPs."
  type        = string
  default     = "10.24.0.0/20"
}

variable "private_subnet_cidr" {
  description = "Subnet for private-only workloads (moderation service egress, fine-tuning system) — no public IP addressing, no public DNS."
  type        = string
  default     = "10.30.0.0/20"
}

variable "vpc_connector_cidr" {
  description = "Dedicated /28 for the Serverless VPC Access connector — required by GCP to be unused by anything else."
  type        = string
  default     = "10.40.0.0/28"
}

variable "trpc_cloud_run_service_name" {
  description = "Name of the tRPC API Cloud Run service (created by modules/cloud-run) that the LB's serverless NEG points at."
  type        = string
}

variable "web_app_cloud_run_service_name" {
  description = "Name of the web-app SSR Cloud Run service (created by modules/cloud-run) that the LB's serverless NEG points at."
  type        = string
}

variable "websocket_service_port" {
  description = "Container port the WebSocket service listens on inside GKE."
  type        = number
  default     = 8080
}

variable "websocket_health_check_path" {
  description = "HTTP path the LB health-checks on the WebSocket service pods."
  type        = string
  default     = "/healthz"
}

variable "glitchtip_service_port" {
  description = "Port the glitchtip Kubernetes Service (modules/glitchtip) listens on."
  type        = number
  default     = 8000
}

variable "glitchtip_health_check_path" {
  type    = string
  default = "/_health/"
}
