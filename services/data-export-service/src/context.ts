import type { Database } from '@mincirklen/shared'
import type { Kysely } from 'kysely'
import type { GcsConfig } from './adapters/gcsAdapter'
import type { KmsConfig } from './adapters/kmsAdapter'
import type { PushAuthConfig } from './adapters/pubsubPushAdapter'

export interface AppEnv {
  db: Kysely<Database>
  gcs: GcsConfig
  pushAuth: PushAuthConfig
  // Decrypt-only — see adapters/kmsAdapter.ts's doc comment for why this
  // is a separate copy from trpc-api's own.
  kms: KmsConfig
  // How long the exported object is retained — written to
  // data_export_requests.expires_at (shown to the user as "available
  // until"), and matched by the GCS bucket's own lifecycle rule
  // (defense in depth, independent of this app-level value — see
  // docs/gdpr-runbook.md and the bucket's Terraform config). Not a
  // download-link TTL: trpc-api mints its own short-lived, separate
  // download token per click (see services/trpc-api's
  // exportDownloadService.ts) — this value only governs how long the
  // underlying object itself is kept.
  retentionTtlMs: number
}
