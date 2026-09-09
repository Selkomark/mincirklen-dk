// Encryption-as-a-service client — HashiCorp Vault's Transit engine
// locally (docker-compose's `vault` service), Google Cloud KMS in
// production (IaC/modules/kms). Selected per-call via KmsConfig's
// `provider` discriminant; everything upstream of encryptField/
// decryptField (repositories/userProfileRepository.ts and up) is
// provider-agnostic.
export class KmsError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export type KmsConfig =
  | { provider: 'vault'; vaultAddr: string; vaultToken: string }
  | { provider: 'gcp'; keyName: string }

// ---- HashiCorp Vault Transit (local dev — see docker-compose.yml) ----

// Fixed, not configurable per environment — this is the one Transit key
// this service ever uses (see docker-compose.yml's `vault-init`), not a
// deployment-varying value.
const TRANSIT_KEY_NAME = 'user-profile-pii'

async function vaultRequest(
  config: Extract<KmsConfig, { provider: 'vault' }>,
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${config.vaultAddr}/v1/${path}`, {
    method: 'POST',
    headers: { 'X-Vault-Token': config.vaultToken, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new KmsError(`vault request to ${path} failed: status ${res.status}`)
  }

  const parsed = (await res.json()) as { data?: Record<string, unknown> }
  if (!parsed.data) {
    throw new KmsError(`vault response from ${path} is missing "data"`)
  }

  return parsed.data
}

async function vaultEncrypt(config: Extract<KmsConfig, { provider: 'vault' }>, plaintext: string): Promise<string> {
  const data = await vaultRequest(config, `transit/encrypt/${TRANSIT_KEY_NAME}`, {
    plaintext: Buffer.from(plaintext, 'utf8').toString('base64'),
  })

  const ciphertext = data.ciphertext
  if (typeof ciphertext !== 'string') {
    throw new KmsError('vault encrypt response missing ciphertext')
  }

  return ciphertext
}

async function vaultDecrypt(config: Extract<KmsConfig, { provider: 'vault' }>, ciphertext: string): Promise<string> {
  const data = await vaultRequest(config, `transit/decrypt/${TRANSIT_KEY_NAME}`, { ciphertext })

  const plaintextB64 = data.plaintext
  if (typeof plaintextB64 !== 'string') {
    throw new KmsError('vault decrypt response missing plaintext')
  }

  return Buffer.from(plaintextB64, 'base64').toString('utf8')
}

// ---- Google Cloud KMS (production — see IaC/modules/kms) ----

// Auth via the attached service account's metadata-server token — the
// standard, SDK-free way to get an access token on both of this service's
// production hosts (Cloud Run and GKE both expose this endpoint), so no
// google-auth client library is needed. Cached until shortly before
// expiry so every encrypt/decrypt call doesn't round-trip to the metadata
// server. Module-level cache: fine for a single long-lived server process,
// same lifetime assumption as the rest of this adapter's config.
const GCP_METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'

let cachedGcpToken: { token: string; expiresAtMs: number } | null = null

async function gcpAccessToken(): Promise<string> {
  if (cachedGcpToken && cachedGcpToken.expiresAtMs > Date.now()) {
    return cachedGcpToken.token
  }

  const res = await fetch(GCP_METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } })
  if (!res.ok) {
    throw new KmsError(`GCP metadata token request failed: status ${res.status}`)
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: number }
  if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') {
    throw new KmsError('GCP metadata token response missing access_token/expires_in')
  }

  // 60s safety margin so a cached token can't expire mid-request.
  cachedGcpToken = { token: body.access_token, expiresAtMs: Date.now() + (body.expires_in - 60) * 1000 }
  return cachedGcpToken.token
}

async function gcpKmsRequest(
  config: Extract<KmsConfig, { provider: 'gcp' }>,
  action: 'encrypt' | 'decrypt',
  body: unknown,
): Promise<Record<string, unknown>> {
  const token = await gcpAccessToken()
  const res = await fetch(`https://cloudkms.googleapis.com/v1/${config.keyName}:${action}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new KmsError(`GCP KMS ${action} request failed: status ${res.status}`)
  }

  return (await res.json()) as Record<string, unknown>
}

async function gcpEncrypt(config: Extract<KmsConfig, { provider: 'gcp' }>, plaintext: string): Promise<string> {
  // Cloud KMS's :encrypt/:decrypt REST methods take/return base64 directly
  // in the JSON body (no nested "data" envelope like Vault's API) — bytes
  // fields are base64 over the wire per google.protobuf's JSON mapping.
  const data = await gcpKmsRequest(config, 'encrypt', {
    plaintext: Buffer.from(plaintext, 'utf8').toString('base64'),
  })

  const ciphertext = data.ciphertext
  if (typeof ciphertext !== 'string') {
    throw new KmsError('GCP KMS encrypt response missing ciphertext')
  }

  return ciphertext
}

async function gcpDecrypt(config: Extract<KmsConfig, { provider: 'gcp' }>, ciphertext: string): Promise<string> {
  const data = await gcpKmsRequest(config, 'decrypt', { ciphertext })

  const plaintextB64 = data.plaintext
  if (typeof plaintextB64 !== 'string') {
    throw new KmsError('GCP KMS decrypt response missing plaintext')
  }

  return Buffer.from(plaintextB64, 'base64').toString('utf8')
}

// ---- Public interface ----

export async function encryptField(config: KmsConfig, plaintext: string): Promise<string> {
  return config.provider === 'gcp' ? gcpEncrypt(config, plaintext) : vaultEncrypt(config, plaintext)
}

export async function decryptField(config: KmsConfig, ciphertext: string): Promise<string> {
  return config.provider === 'gcp' ? gcpDecrypt(config, ciphertext) : vaultDecrypt(config, ciphertext)
}
