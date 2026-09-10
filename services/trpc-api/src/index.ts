import { createDb, createPgPool, runMigrations } from '@mincirklen/shared'
import { createApp } from './app'
import type { GcsConfig } from './adapters/gcsAdapter'
import type { KmsConfig } from './adapters/kmsAdapter'
import type { PubSubConfig } from './adapters/pubsubAdapter'

// Never `public` — see packages/shared/src/db/pool.ts and docs/local_dev.md.
const dbSchema = process.env.DB_SCHEMA ?? 'dev'
const pool = createPgPool(
  process.env.DATABASE_URL ?? 'postgres://mincirklen:mincirklen@postgres:5432/mincirklen',
  dbSchema,
)
const db = createDb(pool)

const authSecret = process.env.AUTH_SECRET
if (!authSecret) {
  throw new Error('AUTH_SECRET is required')
}

// KMS_PROVIDER unset/"vault" -> local dev's Vault Transit engine (see
// docker-compose.yml); "gcp" -> Cloud KMS in production (see
// IaC/modules/kms). See adapters/kmsAdapter.ts for what each needs.
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

const identityHashKey = process.env.IDENTITY_HASH_KEY
if (!identityHashKey) {
  throw new Error('IDENTITY_HASH_KEY is required')
}

const internalServiceSecret = process.env.INTERNAL_SERVICE_SECRET
if (!internalServiceSecret) {
  throw new Error('INTERNAL_SERVICE_SECRET is required')
}

// PUBSUB_PROVIDER unset/"emulator" -> local dev's Pub/Sub emulator (see
// docker-compose.yml); "gcp" -> real Pub/Sub in production. Same
// unset-defaults-to-the-local-stand-in convention as KMS_PROVIDER above.
const pubsubProvider = process.env.PUBSUB_PROVIDER ?? 'emulator'
const pubsubProjectId = process.env.PUBSUB_PROJECT_ID ?? 'mincirklen-local'
// Environment-scoped in real deployments (e.g. "data-export-requests-prod",
// matching IaC/modules/pubsub's naming) — never hardcoded, see
// adapters/pubsubAdapter.ts's PubSubConfig doc comment.
const pubsubTopic = process.env.PUBSUB_DATA_EXPORT_TOPIC ?? 'data-export-requests'
let pubsub: PubSubConfig
if (pubsubProvider === 'gcp') {
  pubsub = { provider: 'gcp', projectId: pubsubProjectId, topic: pubsubTopic }
} else if (pubsubProvider === 'emulator') {
  pubsub = {
    provider: 'emulator',
    emulatorUrl: process.env.PUBSUB_EMULATOR_URL ?? 'http://pubsub:8085',
    projectId: pubsubProjectId,
    topic: pubsubTopic,
  }
} else {
  throw new Error(`unknown PUBSUB_PROVIDER "${pubsubProvider}" (expected "emulator" or "gcp")`)
}

// GCS_PROVIDER unset/"emulator" -> local dev's fake-gcs-server (see
// docker-compose.yml); "gcp" -> the real bucket in production. Same
// unset-defaults-to-the-local-stand-in convention as KMS_PROVIDER above.
// Read-only from this service's side — see adapters/gcsAdapter.ts.
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

const downloadTokenSecret = process.env.DATA_EXPORT_DOWNLOAD_TOKEN_SECRET
if (!downloadTokenSecret) {
  throw new Error('DATA_EXPORT_DOWNLOAD_TOKEN_SECRET is required')
}

await runMigrations(db, dbSchema)

const app = createApp({
  db,
  authSecret,
  moderationServiceUrl: process.env.MODERATION_SVC_URL ?? 'http://moderation-service:8082',
  websocketServiceUrl: process.env.WEBSOCKET_SERVICE_URL ?? 'http://websocket-service:8080',
  internalServiceSecret,
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'https://dev-mincirklen.dk',
  vault: kms,
  pubsub,
  identityHashKey,
  // Optional — trpc-api boots fine without these; only the OAuth routes
  // themselves 503 until they're set. Google sign-in is this platform's
  // only login door (see services/googleAuthService.ts), so a real
  // deployment always sets these — this is purely a boot-time
  // convenience for environments (like a fresh local dev clone) that
  // haven't configured it yet. See docs/local_dev.md / setup-local-oauth-env.sh.
  googleClientId: process.env.GOOGLE_CLIENT_ID || undefined,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || undefined,
  // Optional — no admin exists until this is set and someone logs in with
  // it. See services/adminBootstrapService.ts.
  masterUserEmail: process.env.MASTER_USER_EMAIL || undefined,
  gcs,
  downloadTokenSecret,
  trpcPublicBaseUrl: process.env.TRPC_PUBLIC_BASE_URL ?? 'https://trpc.dev-mincirklen.dk',
})

const port = Number(process.env.PORT ?? 8787)
Bun.serve({ port, fetch: app.fetch })
console.log(`trpc-api listening on :${port}`)
