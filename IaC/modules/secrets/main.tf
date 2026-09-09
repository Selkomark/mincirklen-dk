// Secret *containers* and IAM bindings only. This module never creates a
// google_secret_manager_secret_version — doing so would require passing the
// actual secret value through a Terraform variable, which lands in state
// (state is not a secret store, even encrypted-at-rest remote state).
// Real values are added out-of-band: `gcloud secrets versions add <id>
// --data-file=-`, run once by a human or by a service's own deploy pipeline
// with its own narrowly-scoped credentials — never by this pipeline.

resource "google_secret_manager_secret" "this" {
  for_each = toset(var.secret_ids)

  project   = var.project_id
  secret_id = "${each.value}-${var.environment}"

  replication {
    auto {}
  }
}

locals {
  # Flatten {secret_id: [members]} into one binding per (secret, member) pair.
  bindings = flatten([
    for secret_id, members in var.accessor_bindings : [
      for member in members : {
        secret_id = secret_id
        member    = member
      }
    ]
  ])
}

resource "google_secret_manager_secret_iam_member" "accessor" {
  for_each = { for b in local.bindings : "${b.secret_id}/${b.member}" => b }

  project   = var.project_id
  secret_id = google_secret_manager_secret.this[each.value.secret_id].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value.member
}
