// Shared Postgres instance for chat history, session metadata, feedback
// ratings, and moderation transparency metrics (section 5) — reached
// independently by the tRPC API and WebSocket service over the private
// network only (section 6.2), never a public IP.
//
// Auth is IAM database authentication, not passwords: connecting services
// use their own service account identity via short-lived tokens (through the
// Cloud SQL Auth Proxy / connector), so there is no database password to
// create, rotate, or accidentally leave in Terraform state.

resource "google_sql_database_instance" "this" {
  project             = var.project_id
  name                = "mincirklen-${var.environment}"
  region              = var.region
  database_version    = var.database_version
  deletion_protection = var.deletion_protection

  depends_on = [var.private_vpc_connection]

  settings {
    tier              = var.tier
    availability_type = var.availability_type
    disk_size         = var.disk_size_gb
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled    = false
      private_network = var.network_id
    }

    backup_configuration {
      enabled                        = true
      start_time                     = var.backup_start_time
      point_in_time_recovery_enabled = true
    }

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }
  }
}

resource "google_sql_database" "app" {
  project  = var.project_id
  name     = var.database_name
  instance = google_sql_database_instance.this.name
}

resource "google_sql_user" "iam_service_accounts" {
  for_each = toset(var.iam_service_accounts)

  project  = var.project_id
  instance = google_sql_database_instance.this.name
  # Cloud SQL strips the .gserviceaccount.com suffix for IAM SA usernames.
  name = trimsuffix(each.value, ".gserviceaccount.com")
  type = "CLOUD_IAM_SERVICE_ACCOUNT"
}

# Required for a service account to authenticate via Cloud SQL IAM auth at
# all, on top of the per-database google_sql_user entry above.
resource "google_project_iam_member" "instance_user" {
  for_each = toset(var.iam_service_accounts)

  project = var.project_id
  role    = "roles/cloudsql.instanceUser"
  member  = "serviceAccount:${each.value}"
}

resource "google_project_iam_member" "client" {
  for_each = toset(var.iam_service_accounts)

  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${each.value}"
}
