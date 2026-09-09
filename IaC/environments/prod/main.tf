// Thin root module — wires the shared modules together with prod sizing.
// Deployed exclusively via the prod- tag release flow (section 7.4/7.5).

locals {
  environment = "prod"

  # Computed independently of the cloud-run module calls below (not read from
  # their outputs) specifically to avoid a networking <-> cloud-run cycle:
  # the LB's NEGs need these names before the services necessarily exist yet,
  # and the cloud-run module builds the exact same name internally from
  # (service_name, environment) — see modules/cloud-run/main.tf.
  trpc_service_name    = "trpc-api-${local.environment}"
  web_app_service_name = "web-app-${local.environment}"

  # The Pub/Sub OIDC audience data_export_service checks its own push
  # requests against (PUSH_AUTH_AUDIENCE, below) and module.data_export_pubsub
  # configures its subscriptions to mint tokens for. Deliberately an
  # independently-computed opaque string, not module.data_export_service.uri
  # — using the real URI here would make data_export_service's own env_vars
  # depend on its own output, a cycle. Doesn't need to look like a URL; both
  # sides just need to agree on the same value, same reasoning as
  # trpc_service_name/web_app_service_name above.
  data_export_push_audience = "mincirklen-data-export-service-${local.environment}"
}

module "networking" {
  source = "../../modules/networking"

  project_id      = var.project_id
  region          = var.region
  environment     = local.environment
  domain          = var.domain
  manage_dns_zone = true # prod owns the apex zone

  trpc_cloud_run_service_name    = local.trpc_service_name
  web_app_cloud_run_service_name = local.web_app_service_name
}

module "gke" {
  source = "../../modules/gke-autopilot"

  project_id                    = var.project_id
  region                        = var.region
  environment                   = local.environment
  network_id                    = module.networking.vpc_id
  subnetwork_id                 = module.networking.public_subnet_id
  pods_secondary_range_name     = module.networking.pods_secondary_range_name
  services_secondary_range_name = module.networking.services_secondary_range_name
  release_channel               = "STABLE"
}

# Pre-created here (rather than left to modules/cloud-run to create
# internally) for trpc-api and moderation-service specifically, because other
# resources below need to reference each one's identity and the two Cloud Run
# services need to reference *each other's* — trpc-api calls
# moderation-service's URL, moderation-service authorizes trpc-api's SA as
# its only invoker. Creating both SAs as plain root resources first breaks
# what would otherwise be a module-to-module cycle. web-app doesn't have this
# problem, so it just uses modules/cloud-run's auto-created SA.
resource "google_service_account" "trpc_api" {
  project      = var.project_id
  account_id   = "trpc-api-${local.environment}"
  display_name = "tRPC API (${local.environment})"
}

resource "google_service_account" "moderation_service" {
  project      = var.project_id
  account_id   = "moderation-svc-${local.environment}"
  display_name = "Moderation service (${local.environment})"
}

# GDPR "download my data" worker (services/data-export-service) — a
# standalone Cloud Run service, deliberately isolated from trpc-api's own
# process/failure domain, triggered by Pub/Sub push. Pre-created here for
# the same cross-module-cycle reason as trpc_api/moderation_service above:
# module.data_export_pubsub below needs to grant this identity Cloud SQL/
# KMS/GCS access, and needs to reference module.data_export_service's own
# output — creating the SA as a plain resource first breaks that cycle.
resource "google_service_account" "data_export_service" {
  project      = var.project_id
  account_id   = "data-export-svc-${local.environment}"
  display_name = "Data export service (${local.environment})"
}

# The identity Pub/Sub itself mints OIDC tokens for on every push request
# to data_export_service — deliberately separate from that service's own
# runtime identity above (narrower blast radius: this SA's only grant
# anywhere is roles/run.invoker on data_export_service, below, plus what
# module.data_export_pubsub itself needs from it — it never touches the
# database, KMS, or the export bucket).
resource "google_service_account" "data_export_pubsub_push" {
  project      = var.project_id
  account_id   = "data-export-push-${local.environment}"
  display_name = "Data export Pub/Sub push auth (${local.environment})"
}

# Same reasoning as trpc-api/moderation-service above: the WebSocket service
# isn't a Cloud Run service at all (modules/cloud-run doesn't apply to it) —
# it's a GKE workload, deployed by the web-app repo's own pipeline via a
# Kubernetes Service Account bound to this GSA through Workload Identity
# (that binding is an app-repo concern; the GSA and its IAM grants are an
# infra concern, so they live here).
resource "google_service_account" "websocket_service" {
  project      = var.project_id
  account_id   = "websocket-service-${local.environment}"
  display_name = "WebSocket service (${local.environment})"
}

# Self-hosted error/log tracking (SECURITY.md's "Error/log tracking"
# section) — a GKE workload like websocket-service above, but entirely
# Terraform-managed (modules/glitchtip), not deployed by a separate
# app-repo pipeline, so this GSA only needs to exist here for Workload
# Identity + Cloud SQL IAM auth + Secret Manager access, no cross-module
# cycle to avoid.
resource "google_service_account" "glitchtip" {
  project      = var.project_id
  account_id   = "glitchtip-${local.environment}"
  display_name = "GlitchTip (${local.environment})"
}

module "secrets" {
  source = "../../modules/secrets"

  project_id  = var.project_id
  environment = local.environment

  # The moderation service's config reference is the one secret the tech
  # spec names explicitly (section 3); add more here as real services need
  # them, rather than pre-guessing names nothing reads yet.
  # glitchtip-secret-key: Django's SECRET_KEY, fetched at pod startup by
  # modules/glitchtip's init container — see that module's own comment on
  # why this isn't a Kubernetes-native Secret instead.
  secret_ids = ["moderation-service-config-ref", "glitchtip-secret-key"]

  accessor_bindings = {
    "moderation-service-config-ref" = [
      "serviceAccount:${google_service_account.moderation_service.email}",
    ]
    "glitchtip-secret-key" = [
      "serviceAccount:${google_service_account.glitchtip.email}",
    ]
  }
}

module "kms" {
  source = "../../modules/kms"

  project_id  = var.project_id
  region      = var.region
  environment = local.environment

  # trpc-api is the only service that ever encrypts/decrypts user_profiles
  # PII (see services/trpc-api/src/repositories/userProfileRepository.ts)
  # — websocket-service and moderation-service never touch this key.
  encrypter_decrypter_members = [
    "serviceAccount:${google_service_account.trpc_api.email}",
  ]

  # data-export-service only ever reads a user's own PII back out for
  # their export — never encrypts anything new — so it gets the
  # decrypt-only role, not the combined one above.
  decrypter_members = [
    "serviceAccount:${google_service_account.data_export_service.email}",
  ]
}

module "trpc_api" {
  source = "../../modules/cloud-run"

  project_id            = var.project_id
  region                = var.region
  environment           = local.environment
  service_name          = "trpc-api"
  image                 = coalesce(var.trpc_image, var.placeholder_image)
  service_account_email = google_service_account.trpc_api.email

  min_instances = 0
  max_instances = 20

  ingress               = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  vpc_connector_id      = module.networking.vpc_connector_id
  vpc_egress            = "PRIVATE_RANGES_ONLY" # still needs public internet (e.g. OAuth providers)
  allow_unauthenticated = true                  # network ingress is already LB-restricted; this just permits the LB itself to invoke it

  env_vars = {
    REDIS_HOST               = module.redis.host
    REDIS_PORT               = tostring(module.redis.port)
    DB_INSTANCE              = module.cloud_sql.instance_connection_name
    DB_NAME                  = module.cloud_sql.database_name
    MODERATION_SVC_URL       = module.moderation_service.uri
    KMS_PROVIDER             = "gcp"
    KMS_KEY_NAME             = module.kms.key_name
    PUBSUB_PROVIDER          = "gcp"
    PUBSUB_PROJECT_ID        = var.project_id
    PUBSUB_DATA_EXPORT_TOPIC = module.data_export_pubsub.topic_name
    GCS_PROVIDER             = "gcp"
    GCS_BUCKET               = google_storage_bucket.data_exports.name
    # This service's own public origin — used to build the absolute
    # download-proxy URL returned by auth.createExportDownloadToken.
    # web_app's TRPC_URL below is the same host, for a different purpose
    # (its own server-side reverse proxy target).
    TRPC_PUBLIC_BASE_URL = "https://trpc.${var.domain}"
  }
}

module "web_app" {
  source = "../../modules/cloud-run"

  project_id   = var.project_id
  region       = var.region
  environment  = local.environment
  service_name = "web-app"
  image        = coalesce(var.web_app_image, var.placeholder_image)

  min_instances = 1 # SSR (section 10.1) — avoid cold-start on first paint
  max_instances = 20

  ingress               = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  vpc_connector_id      = module.networking.vpc_connector_id
  vpc_egress            = "PRIVATE_RANGES_ONLY"
  allow_unauthenticated = true

  env_vars = {
    REDIS_HOST  = module.redis.host
    REDIS_PORT  = tostring(module.redis.port)
    DB_INSTANCE = module.cloud_sql.instance_connection_name
    DB_NAME     = module.cloud_sql.database_name
    TRPC_URL    = "https://trpc.${var.domain}"
  }
}

module "moderation_service" {
  source = "../../modules/cloud-run"

  project_id            = var.project_id
  region                = var.region
  environment           = local.environment
  service_name          = "moderation-service"
  image                 = coalesce(var.moderation_service_image, var.placeholder_image)
  service_account_email = google_service_account.moderation_service.email

  min_instances = 0
  max_instances = 10

  # Never public, not even via the LB — reached only by the tRPC API, over
  # gRPC, through the VPC connector (section 6.2).
  ingress               = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  vpc_connector_id      = module.networking.vpc_connector_id
  vpc_egress            = "ALL_TRAFFIC" # its only path out is Cloud NAT, not a direct public IP
  allow_unauthenticated = false
  invoker_members       = ["serviceAccount:${google_service_account.trpc_api.email}"]
}

# Completed "download my data" exports (services/data-export-service) — a
# dedicated bucket, since this is the one place actual personal data
# lands outside Cloud SQL. The 15-day lifecycle rule is defense in depth
# alongside the app's own equal-length retention window
# (data_export_requests.expires_at) — see docs/gdpr-runbook.md and
# data-export-service/src/adapters/gcsAdapter.ts. Never public: downloads
# only ever happen through trpc-api's own token-gated proxy route
# (controllers/exportDownloadController.ts), which mints a fresh,
# short-lived (1 day) download token per click — the bucket itself is
# never reachable with a bare object URL.
resource "google_storage_bucket" "data_exports" {
  project  = var.project_id
  name     = "mincirklen-data-exports-${local.environment}"
  location = var.region

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  lifecycle_rule {
    condition {
      age = 15
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_storage_bucket_iam_member" "data_export_service_writer" {
  bucket = google_storage_bucket.data_exports.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.data_export_service.email}"
}

# Read-only — trpc-api proxies a completed export's bytes back to the
# browser through its own token-gated route; it never writes to this
# bucket (data-export-service.writer above owns uploads).
resource "google_storage_bucket_iam_member" "trpc_api_data_exports_reader" {
  bucket = google_storage_bucket.data_exports.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.trpc_api.email}"
}

module "data_export_service" {
  source = "../../modules/cloud-run"

  project_id            = var.project_id
  region                = var.region
  environment           = local.environment
  service_name          = "data-export-service"
  image                 = coalesce(var.data_export_service_image, var.placeholder_image)
  service_account_email = google_service_account.data_export_service.email

  min_instances = 0
  max_instances = 5 # a bounded async worker, not a request-serving service — no need for trpc-api's headroom

  # Never public, not even via the LB — reached only by Pub/Sub push
  # (module.data_export_pubsub below), same posture as moderation_service.
  # Pub/Sub push to an internal-ingress Cloud Run service is an explicitly
  # supported, documented GCP pattern (Pub/Sub's push infrastructure is a
  # trusted Google-internal caller path).
  ingress               = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  vpc_connector_id      = module.networking.vpc_connector_id
  vpc_egress            = "PRIVATE_RANGES_ONLY" # still needs public internet for the GCS/KMS/IAM Credentials API calls
  allow_unauthenticated = false
  invoker_members       = ["serviceAccount:${google_service_account.data_export_pubsub_push.email}"]

  env_vars = {
    DB_INSTANCE        = module.cloud_sql.instance_connection_name
    DB_NAME            = module.cloud_sql.database_name
    KMS_PROVIDER       = "gcp"
    KMS_KEY_NAME       = module.kms.key_name
    GCS_PROVIDER       = "gcp"
    GCS_BUCKET         = google_storage_bucket.data_exports.name
    PUSH_AUTH_PROVIDER = "oidc"
    PUSH_AUTH_AUDIENCE = local.data_export_push_audience
  }
}

module "data_export_pubsub" {
  source = "../../modules/pubsub"

  project_id  = var.project_id
  environment = local.environment
  topic_name  = "data-export-requests"

  publisher_members = ["serviceAccount:${google_service_account.trpc_api.email}"]

  push_service_account_email = google_service_account.data_export_pubsub_push.email
  push_audience              = local.data_export_push_audience

  push_endpoint             = "${module.data_export_service.uri}/pubsub/push"
  dead_letter_push_endpoint = "${module.data_export_service.uri}/pubsub/dead-letter"
}

module "cloud_sql" {
  source = "../../modules/cloud-sql"

  project_id             = var.project_id
  region                 = var.region
  environment            = local.environment
  network_id             = module.networking.vpc_id
  private_vpc_connection = module.networking.private_vpc_connection
  availability_type      = "REGIONAL" # HA in prod
  tier                   = "db-custom-2-7680"
  deletion_protection    = true

  iam_service_accounts = [
    google_service_account.trpc_api.email,
    google_service_account.websocket_service.email,
    google_service_account.glitchtip.email,
    google_service_account.data_export_service.email,
  ]
}

# A second database on the same shared instance — pure cost/footprint
# reuse (see SECURITY.md's "Error/log tracking" section), not a second
# Cloud SQL instance. modules/cloud-sql only ever creates its own primary
# "app" database internally, so this is a plain resource here rather than
# a change to that module's interface.
resource "google_sql_database" "glitchtip" {
  project  = var.project_id
  name     = "glitchtip"
  instance = module.cloud_sql.instance_name
}

module "redis" {
  source = "../../modules/redis"

  project_id      = var.project_id
  region          = var.region
  environment     = local.environment
  use_memorystore = false # self-hosted per section 8.3's cost analysis

  storage_size = "20Gi"
}

# GlitchTip's own Celery broker/cache — deliberately not sharing the app's
# `redis` above (that one is correctness-critical live turn/roster/
# presence state; this one is disposable queue data). Same self-hosted
# module, different namespace so the two StatefulSets/Services don't
# collide, much smaller since it holds nothing durable.
module "glitchtip_redis" {
  source = "../../modules/redis"

  project_id      = var.project_id
  region          = var.region
  environment     = local.environment
  use_memorystore = false
  namespace       = "glitchtip-redis"
  storage_size    = "5Gi"
}

module "glitchtip" {
  source = "../../modules/glitchtip"

  project_id            = var.project_id
  region                = var.region
  environment           = local.environment
  image                 = var.glitchtip_image
  domain                = "https://glitchtip.${var.domain}"
  service_account_email = google_service_account.glitchtip.email

  cloud_sql_instance_connection_name = module.cloud_sql.instance_connection_name
  database_name                      = google_sql_database.glitchtip.name

  redis_host = module.glitchtip_redis.host
  redis_port = module.glitchtip_redis.port

  secret_manager_secret_id = module.secrets.secret_ids["glitchtip-secret-key"]
}
