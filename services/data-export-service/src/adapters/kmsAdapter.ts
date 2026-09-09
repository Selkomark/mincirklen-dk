// Decrypt-only copy of trpc-api's adapters/kmsAdapter.ts — this service
// only ever reads a user's own profile PII back out for their export,
// it never writes any, so there's no encryptField here. Deliberately a
// separate file rather than sharing trpc-api's, matching this
// monorepo's existing pattern of each service owning its own adapters
// even against the same external dependency (see gcsAdapter.ts's and
// pubsubPushAdapter.ts's doc comments, and websocket-service's own
// independent repositories/). Keep the two in sync if the wire format
// of either backend ever changes.
export class KmsError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export type KmsConfig =
  | { provider: 'vault'; vaultAddr: string; vaultToken: string }
  | { provider: 'gcp'; keyName: string }

const TRANSIT_KEY_NAME = 'user-profile-pii'

async function vaultDecrypt(config: Extract<KmsConfig, { provider: 'vault' }>, ciphertext: string): Promise<string> {
  const res = await fetch(`${config.vaultAddr}/v1/transit/decrypt/${TRANSIT_KEY_NAME}`, {
    method: 'POST',
    headers: { 'X-Vault-Token': config.vaultToken, 'content-type': 'application/json' },
    body: JSON.stringify({ ciphertext }),
  })
  if (!res.ok) {
    throw new KmsError(`vault decrypt request failed: status ${res.status}`)
  }

  const parsed = (await res.json()) as { data?: { plaintext?: string } }
  const plaintextB64 = parsed.data?.plaintext
  if (typeof plaintextB64 !== 'string') {
    throw new KmsError('vault decrypt response missing plaintext')
  }

  return Buffer.from(plaintextB64, 'base64').toString('utf8')
}

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

  cachedGcpToken = { token: body.access_token, expiresAtMs: Date.now() + (body.expires_in - 60) * 1000 }
  return cachedGcpToken.token
}

async function gcpDecrypt(config: Extract<KmsConfig, { provider: 'gcp' }>, ciphertext: string): Promise<string> {
  const token = await gcpAccessToken()
  const res = await fetch(`https://cloudkms.googleapis.com/v1/${config.keyName}:decrypt`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ciphertext }),
  })
  if (!res.ok) {
    throw new KmsError(`GCP KMS decrypt request failed: status ${res.status}`)
  }

  const body = (await res.json()) as { plaintext?: string }
  if (typeof body.plaintext !== 'string') {
    throw new KmsError('GCP KMS decrypt response missing plaintext')
  }

  return Buffer.from(body.plaintext, 'base64').toString('utf8')
}

export async function decryptField(config: KmsConfig, ciphertext: string): Promise<string> {
  return config.provider === 'gcp' ? gcpDecrypt(config, ciphertext) : vaultDecrypt(config, ciphertext)
}
