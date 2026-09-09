// Production encryption-as-a-service for user_profiles PII
// (pii_ciphertext) — the real Cloud KMS counterpart to the local dev
// stack's Vault Transit engine (docker-compose.yml's `vault` service).
// See services/trpc-api/src/adapters/kmsAdapter.ts, which speaks to
// whichever of the two this environment configures it for.
//
// Rotation is native and non-destructive here, same as Vault Transit:
// rotating a Cloud KMS key creates a new primary version for new
// encryptions while every prior version stays usable for decrypt — old
// ciphertext never breaks just because the key rotated. What *would*
// break it is destroying a version or the key itself, which is why this
// key has deletion protection (lifecycle below) and no destroy path is
// exposed through this module.

resource "google_kms_key_ring" "this" {
  project  = var.project_id
  name     = "mincirklen-${var.environment}"
  location = var.region
}

resource "google_kms_crypto_key" "user_profile_pii" {
  name     = "user-profile-pii"
  key_ring = google_kms_key_ring.this.id
  purpose  = "ENCRYPT_DECRYPT"

  # Automatic rotation — old versions are retained (never deleted by
  # rotation itself), so this alone never breaks existing ciphertext.
  rotation_period = var.rotation_period

  lifecycle {
    prevent_destroy = true
  }
}

// Additive per-member grants (same convention as modules/secrets), never a
// project-wide or key-ring-wide binding — only services that actually
// encrypt/decrypt PII get this role, and only on this one key.
resource "google_kms_crypto_key_iam_member" "encrypter_decrypter" {
  for_each = toset(var.encrypter_decrypter_members)

  crypto_key_id = google_kms_crypto_key.user_profile_pii.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = each.value
}

// Decrypt-only, for a service that only ever reads PII back out and never
// writes any (e.g. data-export-service — see its own adapters/kmsAdapter.ts
// doc comment on why it's a decrypt-only copy of trpc-api's). A distinct
// predefined role, not a subset check on the combined role above — this is
// a real least-privilege boundary: a compromised decrypt-only caller can't
// also overwrite ciphertext.
resource "google_kms_crypto_key_iam_member" "decrypter" {
  for_each = toset(var.decrypter_members)

  crypto_key_id = google_kms_crypto_key.user_profile_pii.id
  role          = "roles/cloudkms.cryptoKeyDecrypter"
  member        = each.value
}
