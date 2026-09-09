import { createDb, createPgPool } from '@mincirklen/shared'
import { createApp } from './app'
import type { GcsConfig } from './adapters/gcsAdapter'
import type { KmsConfig } from './adapters/kmsAdapter'
import type { PushAuthConfig } from './adapters/pubsubPushAdapter'

// Not running its own migrations — trpc-api does, this service just
// reads/writes tables trpc-api's migration already created. Same
// posture as websocket-service's own index.ts.
const dbSchema = process.env.DB_SCHEMA ?? 'dev'
const pool = createPgPool(
  process.env.DATABASE_URL ?? 'postgres://mincirklen:mincirklen@postgres:5432/mincirklen',
  dbSchema,
)
const db = createDb(pool)

// KMS_PROVIDER unset/"vault" -> local dev's Vault Transit engine; "gcp"
// -> Cloud KMS in production. Same convention as trpc-api's index.ts —
// see this service's adapters/kmsAdapter.ts for why it's a separate,
// decrypt-only copy rather than importing trpc-api's.
const kmsProvider = process.env.KMS_PROVIDER ?? 'vault'
let kms: KmsConfig
if (kmsProvider === 'gcp') {
  const keyName = process.env.KMS_KEY_NAME
  if (!keyName) {
    throw new Error('KMS_KEY_NAME is required when KMS_PROVIDER=gcp')
  }
  kms = { provider: 'gcp', keyName }
} else if (kmsProvider === 'vault') {
  const vaultAddr = process.env.VAULT_ADDR
  const vaultToken = process.env.VAULT_TOKEN
  if (!vaultAddr || !vaultToken) {
    throw new Error('VAULT_ADDR and VAULT_TOKEN are required when KMS_PROVIDER=vault')
  }
  kms = { provider: 'vault', vaultAddr, vaultToken }
} else {
  throw new Error(`unknown KMS_PROVIDER "${kmsProvider}" (expected "vault" or "gcp")`)
}

// GCS_PROVIDER unset/"emulator" -> local dev's fake-gcs-server (see
// docker-compose.yml); "gcp" -> the real bucket in production.
const gcsProvider = process.env.GCS_PROVIDER ?? 'emulator'
const gcsBucket = process.env.GCS_BUCKET ?? 'mincirklen-data-exports'
let gcs: GcsConfig
if (gcsProvider === 'gcp') {
  gcs = { provider: 'gcp', bucket: gcsBucket }
} else if (gcsProvider === 'emulator') {
  gcs = { provider: 'emulator', apiEndpoint: process.env.GCS_EMULATOR_URL ?? 'http://gcs:4443', bucket: gcsBucket }
} else {
  throw new Error(`unknown GCS_PROVIDER "${gcsProvider}" (expected "emulator" or "gcp")`)
}

// PUSH_AUTH_PROVIDER unset/"none" -> local dev (the Pub/Sub emulator
// can't issue real signed tokens, see adapters/pubsubPushAdapter.ts);
// "oidc" -> required in production.
const pushAuthProvider = process.env.PUSH_AUTH_PROVIDER ?? 'none'
let pushAuth: PushAuthConfig
if (pushAuthProvider === 'oidc') {
  const audience = process.env.PUSH_AUTH_AUDIENCE
  if (!audience) {
    throw new Error('PUSH_AUTH_AUDIENCE is required when PUSH_AUTH_PROVIDER=oidc')
  }
  pushAuth = { mode: 'oidc', audience }
} else if (pushAuthProvider === 'none') {
  pushAuth = { mode: 'none' }
} else {
  throw new Error(`unknown PUSH_AUTH_PROVIDER "${pushAuthProvider}" (expected "none" or "oidc")`)
}

// 15-day default — matches the GCS bucket's own lifecycle rule (defense
// in depth, independent of this app-level value — see the bucket's
// Terraform config) and is what's written to data_export_requests.expires_at,
// shown to the user as "available until".
const retentionTtlMs = Number(process.env.EXPORT_RETENTION_TTL_MS ?? 15 * 24 * 60 * 60 * 1000)

const app = createApp({ db, gcs, pushAuth, kms, retentionTtlMs })

const port = Number(process.env.PORT ?? 8083)
Bun.serve({ port, fetch: app.fetch })
console.log(`data-export-service listening on :${port}`)
