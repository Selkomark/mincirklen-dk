variable "project_id" {
  description = "GCP project ID. No default — pass explicitly via tfvars or -var so it's never accidentally applied against the wrong project."
  type        = string
}

variable "region" {
  type    = string
  default = "europe-west1"
}

variable "domain" {
  type    = string
  default = "mincirklen.dk"
}

# Placeholder image — Google's own sample container, made for exactly this
# purpose (a valid, pullable image so Cloud Run can be created before real
# application code exists). Each service's own CI pipeline deploys the real
# image via `gcloud run deploy` afterward; modules/cloud-run's
# lifecycle.ignore_changes means Terraform won't fight that (section 7.3).
variable "placeholder_image" {
  type    = string
  default = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "trpc_image" {
  type    = string
  default = null
}

variable "web_app_image" {
  type    = string
  default = null
}

variable "moderation_service_image" {
  type    = string
  default = null
}

variable "data_export_service_image" {
  type    = string
  default = null
}

# Not this repo's own build artifact (no CI pipeline pushes it) — unlike
# the three images above, defaults straight to the real pinned image,
# same digest docker-compose.yml uses locally. See SECURITY.md's
# "Error/log tracking" section for why this exact digest is trusted.
variable "glitchtip_image" {
  type    = string
  default = "glitchtip/glitchtip@sha256:a3d8eb1b36c1e1603d55ab32711ea3dd8115874742a781a57391a62a16e0dff6" # 6
}
