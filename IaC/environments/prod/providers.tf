provider "google" {
  project = var.project_id
  region  = var.region
}

# Short-lived access token for the kubernetes provider — no static
# kubeconfig/service-account key sitting around.
data "google_client_config" "default" {}

provider "kubernetes" {
  host                   = "https://${module.gke.endpoint}"
  token                  = data.google_client_config.default.access_token
  cluster_ca_certificate = base64decode(module.gke.ca_certificate)
}
