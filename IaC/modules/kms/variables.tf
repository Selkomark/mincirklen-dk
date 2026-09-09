variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "environment" {
  type = string
}

variable "encrypter_decrypter_members" {
  description = "Members (\"serviceAccount:...\") granted roles/cloudkms.cryptoKeyEncrypterDecrypter on exactly this key — every entry should be one specific service's identity, never a broad group. No other role is ever granted by this module: nothing gets key-admin rights (rotate/destroy) through here."
  type        = list(string)
  default     = []
}

variable "decrypter_members" {
  description = "Members granted roles/cloudkms.cryptoKeyDecrypter (decrypt-only, a distinct predefined role from the combined one above) — for a service that only ever reads existing ciphertext and never encrypts anything new."
  type        = list(string)
  default     = []
}

variable "rotation_period" {
  description = "How often Cloud KMS auto-rotates the key, as a duration string in seconds (e.g. \"7776000s\" = 90 days). Rotation is non-destructive — old versions stay usable for decrypt — so this is a key-hygiene knob, not a durability risk."
  type        = string
  default     = "7776000s" # 90 days
}
