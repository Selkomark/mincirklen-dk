// VPC, subnets, NAT, and the private-services plumbing Cloud SQL/Redis/the
// VPC Access connector need. The HTTPS Load Balancer (public entry point) is
// split into load-balancer.tf since it's large on its own; DNS is in dns.tf.

resource "google_compute_network" "vpc" {
  project                 = var.project_id
  name                    = "mincirklen-${var.environment}"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
}

# ---------------------------------------------------------------------------
# Public subnet — hosts the GKE Autopilot cluster (WebSocket service) and the
# Load Balancer's NEGs. "Public" here means reachable via the LB's public
# ingress, not that nodes get public IPs — Autopilot nodes stay private.
# ---------------------------------------------------------------------------

resource "google_compute_subnetwork" "public" {
  project       = var.project_id
  name          = "public-${var.environment}"
  network       = google_compute_network.vpc.id
  region        = var.region
  ip_cidr_range = var.public_subnet_cidr

  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = var.public_subnet_pods_cidr
  }
  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = var.public_subnet_services_cidr
  }
}

# ---------------------------------------------------------------------------
# Private subnet — moderation service and the fine-tuning/training system.
# No public IP addressing, no public DNS entry, ever (see section 6.2).
# ---------------------------------------------------------------------------

resource "google_compute_subnetwork" "private" {
  project       = var.project_id
  name          = "private-${var.environment}"
  network       = google_compute_network.vpc.id
  region        = var.region
  ip_cidr_range = var.private_subnet_cidr

  private_ip_google_access = true
}

# ---------------------------------------------------------------------------
# Serverless VPC Access — lets the tRPC API (Cloud Run) reach the moderation
# service, Redis, and Cloud SQL over internal networking instead of the
# public internet.
# ---------------------------------------------------------------------------

resource "google_vpc_access_connector" "connector" {
  project       = var.project_id
  name          = "connector-${var.environment}"
  region        = var.region
  network       = google_compute_network.vpc.name
  ip_cidr_range = var.vpc_connector_cidr

  min_instances = 2
  max_instances = 3
}

# ---------------------------------------------------------------------------
# Cloud NAT — egress only for the private subnet (e.g. an external model API
# call) with no inbound-reachable public IP anywhere in that subnet.
# ---------------------------------------------------------------------------

resource "google_compute_router" "router" {
  project = var.project_id
  name    = "router-${var.environment}"
  region  = var.region
  network = google_compute_network.vpc.id
}

resource "google_compute_router_nat" "nat" {
  project                            = var.project_id
  name                               = "nat-${var.environment}"
  router                             = google_compute_router.router.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"

  subnetwork {
    name                    = google_compute_subnetwork.private.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

# ---------------------------------------------------------------------------
# Private Services Access — reserved range + peering connection that Cloud
# SQL (and Memorystore, if used instead of self-hosted Redis) need for a
# private IP, reachable only from inside this VPC.
# ---------------------------------------------------------------------------

resource "google_compute_global_address" "private_services_range" {
  project       = var.project_id
  name          = "private-services-${var.environment}"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services_range.name]
}

# ---------------------------------------------------------------------------
# Firewall — deny by default (implied), explicitly allow only what the
# architecture actually needs: intra-VPC traffic, GCP health checks, and
# nothing inbound to the private subnet from outside the VPC.
# ---------------------------------------------------------------------------

resource "google_compute_firewall" "allow_internal" {
  project = var.project_id
  name    = "allow-internal-${var.environment}"
  network = google_compute_network.vpc.name

  direction = "INGRESS"
  priority  = 1000

  source_ranges = [
    var.public_subnet_cidr,
    var.public_subnet_pods_cidr,
    var.public_subnet_services_cidr,
    var.private_subnet_cidr,
    var.vpc_connector_cidr,
  ]

  allow {
    protocol = "tcp"
  }
  allow {
    protocol = "udp"
  }
  allow {
    protocol = "icmp"
  }
}

# Google's health-check probe ranges, per
# https://cloud.google.com/load-balancing/docs/health-check-concepts#ip-ranges
resource "google_compute_firewall" "allow_health_checks" {
  project = var.project_id
  name    = "allow-lb-health-checks-${var.environment}"
  network = google_compute_network.vpc.name

  direction     = "INGRESS"
  priority      = 1000
  source_ranges = ["35.191.0.0/16", "130.211.0.0/22"]

  allow {
    protocol = "tcp"
  }
}
