// Single public entry point across the app's subdomains (section 6.1):
// mincirklen.dk (web-app SSR), trpc.mincirklen.dk (tRPC API), and
// socket.mincirklen.dk (WebSocket service) — host-based routing off one
// global external HTTPS LB, one managed cert, one static IP.
// glitchtip.mincirklen.dk (self-hosted error/log tracking, SECURITY.md)
// rides the same LB — not part of the original tech-spec topology, but
// the identical pattern as the WebSocket backend below.

resource "google_compute_global_address" "lb_ip" {
  project = var.project_id
  name    = "lb-ip-${var.environment}"
}

resource "google_compute_managed_ssl_certificate" "lb_cert" {
  project = var.project_id
  name    = "lb-cert-${var.environment}"

  managed {
    domains = [
      var.domain,
      "trpc.${var.domain}",
      "socket.${var.domain}",
      "glitchtip.${var.domain}",
    ]
  }
}

# ---------------------------------------------------------------------------
# tRPC API backend — serverless NEG pointed at the Cloud Run service. Direct
# Cloud Run URL ingress is restricted (see modules/cloud-run); this NEG is the
# only path in.
# ---------------------------------------------------------------------------

resource "google_compute_region_network_endpoint_group" "trpc" {
  project               = var.project_id
  name                  = "trpc-neg-${var.environment}"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = var.trpc_cloud_run_service_name
  }
}

resource "google_compute_backend_service" "trpc" {
  project     = var.project_id
  name        = "trpc-backend-${var.environment}"
  protocol    = "HTTPS"
  timeout_sec = 30

  backend {
    group = google_compute_region_network_endpoint_group.trpc.id
  }

  log_config {
    enable      = true
    sample_rate = var.environment == "prod" ? 0.1 : 1.0
  }
}

# ---------------------------------------------------------------------------
# Web-app backend — same shape as tRPC: the web-app is SSR (section 10.1), so
# it's a running Cloud Run service, not a static bucket.
# ---------------------------------------------------------------------------

resource "google_compute_region_network_endpoint_group" "web_app" {
  project               = var.project_id
  name                  = "web-app-neg-${var.environment}"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = var.web_app_cloud_run_service_name
  }
}

resource "google_compute_backend_service" "web_app" {
  project     = var.project_id
  name        = "web-app-backend-${var.environment}"
  protocol    = "HTTPS"
  timeout_sec = 30

  backend {
    group = google_compute_region_network_endpoint_group.web_app.id
  }

  log_config {
    enable      = true
    sample_rate = var.environment == "prod" ? 0.1 : 1.0
  }
}

# ---------------------------------------------------------------------------
# WebSocket backend — container-native (NEG-based) routing into the GKE
# Autopilot cluster, one zonal NEG per zone the cluster spans. The matching
# Kubernetes Service must be annotated with the same NEG names
# (cloud.google.com/neg: '{"exposed_ports": {"80": {"name": "<neg name>"}}}')
# so GKE attaches pod endpoints to these Terraform-managed NEGs at deploy
# time — see web-app repo's k8s manifests (out of scope here).
# ---------------------------------------------------------------------------

data "google_compute_zones" "available" {
  project = var.project_id
  region  = var.region
}

resource "google_compute_network_endpoint_group" "websocket" {
  for_each = toset(data.google_compute_zones.available.names)

  project      = var.project_id
  name         = "ws-neg-${var.environment}-${each.value}"
  zone         = each.value
  network      = google_compute_network.vpc.id
  subnetwork   = google_compute_subnetwork.public.id
  default_port = var.websocket_service_port

  network_endpoint_type = "GCE_VM_IP_PORT"
}

resource "google_compute_health_check" "websocket" {
  project = var.project_id
  name    = "ws-health-${var.environment}"

  http_health_check {
    port         = var.websocket_service_port
    request_path = var.websocket_health_check_path
  }

  check_interval_sec = 10
  timeout_sec        = 5
}

resource "google_compute_backend_service" "websocket" {
  project     = var.project_id
  name        = "ws-backend-${var.environment}"
  protocol    = "HTTP"
  timeout_sec = 3600 # long-lived WebSocket connections

  health_checks = [google_compute_health_check.websocket.id]

  # A reconnecting client lands back on a WS pod that already has its local
  # connection/room-subscription state, where that matters (section 3).
  session_affinity = "CLIENT_IP"

  dynamic "backend" {
    for_each = google_compute_network_endpoint_group.websocket
    content {
      group = backend.value.id
    }
  }

  log_config {
    enable      = true
    sample_rate = var.environment == "prod" ? 0.1 : 1.0
  }
}

# ---------------------------------------------------------------------------
# GlitchTip backend — same container-native NEG routing shape as the
# WebSocket backend above, except modules/glitchtip's Deployment/Service
# are Terraform-managed (unlike websocket-service, deployed by a separate
# app-repo pipeline), so both the NEG name here and the Kubernetes
# Service's `cloud.google.com/neg` annotation are written together, in
# this same change — they have to stay in exact sync. One NEG per zone,
# all sharing the same name (varying only by zone), per GKE's documented
# standalone-NEG contract: the Service annotation gives a single name,
# and GKE's NEG controller creates one real NEG per zone using exactly
# that name, then populates each with that zone's pod endpoints.
# ---------------------------------------------------------------------------

resource "google_compute_network_endpoint_group" "glitchtip" {
  for_each = toset(data.google_compute_zones.available.names)

  project      = var.project_id
  name         = "glitchtip-neg-${var.environment}"
  zone         = each.value
  network      = google_compute_network.vpc.id
  subnetwork   = google_compute_subnetwork.public.id
  default_port = var.glitchtip_service_port

  network_endpoint_type = "GCE_VM_IP_PORT"
}

resource "google_compute_health_check" "glitchtip" {
  project = var.project_id
  name    = "glitchtip-health-${var.environment}"

  http_health_check {
    port         = var.glitchtip_service_port
    request_path = var.glitchtip_health_check_path
  }

  check_interval_sec = 10
  timeout_sec        = 5
}

resource "google_compute_backend_service" "glitchtip" {
  project     = var.project_id
  name        = "glitchtip-backend-${var.environment}"
  protocol    = "HTTP"
  timeout_sec = 30

  health_checks = [google_compute_health_check.glitchtip.id]

  dynamic "backend" {
    for_each = google_compute_network_endpoint_group.glitchtip
    content {
      group = backend.value.id
    }
  }

  log_config {
    enable      = true
    sample_rate = var.environment == "prod" ? 0.1 : 1.0
  }
}

# ---------------------------------------------------------------------------
# URL map — host-based routing to the four backends above.
# ---------------------------------------------------------------------------

resource "google_compute_url_map" "https" {
  project         = var.project_id
  name            = "url-map-${var.environment}"
  default_service = google_compute_backend_service.web_app.id

  host_rule {
    hosts        = [var.domain]
    path_matcher = "web-app"
  }
  host_rule {
    hosts        = ["trpc.${var.domain}"]
    path_matcher = "trpc"
  }
  host_rule {
    hosts        = ["socket.${var.domain}"]
    path_matcher = "socket"
  }
  host_rule {
    hosts        = ["glitchtip.${var.domain}"]
    path_matcher = "glitchtip"
  }

  path_matcher {
    name            = "web-app"
    default_service = google_compute_backend_service.web_app.id

    # Same-origin path to trpc-api on the root domain — used by the Google
    # OAuth callback (registered in Google Cloud Console as
    # https://<domain>/api/auth/callback/google) and available for any
    # other same-origin API call the web-app makes. Mirrors
    # local-infra/caddy/Caddyfile's handle_path /api/* for local dev: the
    # /api prefix is stripped before reaching trpc-api, so its existing
    # /health and /trpc/* routes are unaffected — only /auth/google/start
    # and /auth/callback/google are new, unprefixed routes on that app.
    route_rules {
      priority = 1
      service  = google_compute_backend_service.trpc.id

      match_rules {
        prefix_match = "/api/"
      }

      route_action {
        url_rewrite {
          path_prefix_rewrite = "/"
        }
      }
    }
  }
  path_matcher {
    name            = "trpc"
    default_service = google_compute_backend_service.trpc.id
  }
  path_matcher {
    name            = "socket"
    default_service = google_compute_backend_service.websocket.id
  }
  path_matcher {
    name            = "glitchtip"
    default_service = google_compute_backend_service.glitchtip.id
  }
}

resource "google_compute_target_https_proxy" "https" {
  project          = var.project_id
  name             = "https-proxy-${var.environment}"
  url_map          = google_compute_url_map.https.id
  ssl_certificates = [google_compute_managed_ssl_certificate.lb_cert.id]
}

resource "google_compute_global_forwarding_rule" "https" {
  project               = var.project_id
  name                  = "https-fr-${var.environment}"
  ip_address            = google_compute_global_address.lb_ip.address
  port_range            = "443"
  target                = google_compute_target_https_proxy.https.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# ---------------------------------------------------------------------------
# HTTP → HTTPS redirect on the same static IP.
# ---------------------------------------------------------------------------

resource "google_compute_url_map" "http_redirect" {
  project = var.project_id
  name    = "url-map-redirect-${var.environment}"

  default_url_redirect {
    https_redirect = true
    strip_query    = false
  }
}

resource "google_compute_target_http_proxy" "http" {
  project = var.project_id
  name    = "http-proxy-${var.environment}"
  url_map = google_compute_url_map.http_redirect.id
}

resource "google_compute_global_forwarding_rule" "http" {
  project               = var.project_id
  name                  = "http-fr-${var.environment}"
  ip_address            = google_compute_global_address.lb_ip.address
  port_range            = "80"
  target                = google_compute_target_http_proxy.http.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
