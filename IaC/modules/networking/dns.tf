// Cloud DNS zone for the apex domain + A records for all three public
// subdomains, all pointed at the Load Balancer's single static IP (section
// 6.1). Only the environment with manage_dns_zone = true creates the zone —
// normally just prod, since a domain has exactly one authoritative zone.

resource "google_dns_managed_zone" "apex" {
  count = var.manage_dns_zone ? 1 : 0

  project     = var.project_id
  name        = "mincirklen-${var.environment}"
  dns_name    = "${var.domain}."
  description = "Public zone for ${var.domain} — MinCirklen (${var.environment})"

  dnssec_config {
    state = "on"
  }
}

resource "google_dns_record_set" "root" {
  count = var.manage_dns_zone ? 1 : 0

  project      = var.project_id
  managed_zone = google_dns_managed_zone.apex[0].name
  name         = "${var.domain}."
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.lb_ip.address]
}

resource "google_dns_record_set" "trpc" {
  count = var.manage_dns_zone ? 1 : 0

  project      = var.project_id
  managed_zone = google_dns_managed_zone.apex[0].name
  name         = "trpc.${var.domain}."
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.lb_ip.address]
}

resource "google_dns_record_set" "socket" {
  count = var.manage_dns_zone ? 1 : 0

  project      = var.project_id
  managed_zone = google_dns_managed_zone.apex[0].name
  name         = "socket.${var.domain}."
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.lb_ip.address]
}
