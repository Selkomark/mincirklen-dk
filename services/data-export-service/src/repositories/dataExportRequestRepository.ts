import type { Database } from '@mincirklen/shared'
import type { Kysely } from 'kysely'

export interface DataExportRequestRow {
  id: string
  userId: string
  status: 'pending' | 'processing' | 'ready' | 'failed' | 'expired'
}

// This worker owns every status transition past 'pending' — trpc-api
// only ever inserts the row (see the sibling repository of the same
// name in services/trpc-api/src/repositories/). Deliberately two
// separate files rather than a shared one: each service keeps its own
// narrow, independently-reviewable slice of what it's actually allowed
// to do to this table, matching this monorepo's existing pattern of
// each service owning its own repository layer even against shared
// tables (see websocket-service/src/repositories/).
export async function findDataExportRequestById(db: Kysely<Database>, id: string): Promise<DataExportRequestRow | null> {
  const row = await db
    .selectFrom('data_export_requests')
    .select(['id', 'user_id', 'status'])
    .where('id', '=', id)
    .executeTakeFirst()

  if (!row) return null
  return { id: row.id, userId: row.user_id, status: row.status as DataExportRequestRow['status'] }
}

export async function markDataExportProcessing(db: Kysely<Database>, id: string): Promise<void> {
  await db.updateTable('data_export_requests').set({ status: 'processing' }).where('id', '=', id).execute()
}

export async function markDataExportReady(
  db: Kysely<Database>,
  id: string,
  params: { objectKey: string; expiresAt: Date },
): Promise<void> {
  await db
    .updateTable('data_export_requests')
    .set({
      status: 'ready',
      // The bucket-internal object key, not a URL — trpc-api proxies
      // downloads through its own token-gated route
      // (exportDownloadService.ts), minting a fresh short-lived token per
      // click rather than this worker signing one long-lived URL upfront.
      storage_key: params.objectKey,
      completed_at: new Date(),
      expires_at: params.expiresAt,
    })
    .where('id', '=', id)
    .execute()
}

export async function markDataExportFailed(db: Kysely<Database>, id: string): Promise<void> {
  await db.updateTable('data_export_requests').set({ status: 'failed', completed_at: new Date() }).where('id', '=', id).execute()
}
