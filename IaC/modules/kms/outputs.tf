output "key_name" {
  description = "Fully-qualified Cloud KMS crypto key resource name (projects/.../locations/.../keyRings/.../cryptoKeys/...) — wire this into trpc-api's KMS_KEY_NAME env var."
  value       = google_kms_crypto_key.user_profile_pii.id
}
