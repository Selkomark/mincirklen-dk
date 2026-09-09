// This service intentionally does almost nothing — it publishes a
// Pub/Sub message and inserts a `pending` row, then returns immediately.
// The actual aggregation (profile, messages, moderation history, etc.),
// the GCS write, and the ready/failed status transition are all owned by
// the separate data-export-service Cloud Run worker, deliberately kept
// out of this process. That split is the whole point: a bug in
// export-generation code (an OOM on a large account, a bad query, an
// infinite loop) can only take down that one standalone worker, never
// trpc-api or anything else on the platform — trpc-api never calls into
// it synchronously for anything.
export interface DataExportRequestSummary {
  id: string
  status: 'pending' | 'processing' | 'ready' | 'failed' | 'expired'
  requestedAt: Date
  // The bucket-retention deadline ("available until"), not a download-
  // link expiry — see exportDownloadService.ts, which mints a separate,
  // much shorter-lived (1 day) token fresh on every download click.
  expiresAt: Date | null
}

export interface RequestDataExportDeps {
  generateId: () => string
  insertRequest: (id: string) => Promise<{ id: string }>
  publish: (requestId: string) => Promise<void>
}

// Publish before persisting, deliberately — a `pending` row must never
// exist unless the worker has actually been notified to pick it up. If
// insertRequest ran first and publish then failed (a pubsub outage, the
// topic not existing, ...), that row would sit at `pending` forever:
// nothing else ever transitions it, since every later status change is
// owned by the worker responding to the message that was never sent (see
// this file's own top comment). Publishing first means a failure here
// surfaces immediately as an error the user can retry, instead of a
// silently stuck request.
export async function requestDataExport(deps: RequestDataExportDeps): Promise<{ id: string }> {
  const id = deps.generateId()
  await deps.publish(id)
  return deps.insertRequest(id)
}

export interface GetDataExportStatusDeps {
  findRequests: () => Promise<
    { id: string; status: DataExportRequestSummary['status']; requestedAt: Date; expiresAt: Date | null }[]
  >
}

// Never exposes storage_key (the bucket-internal object path) to the
// frontend — a 'ready' status alone is what tells the UI to offer a
// Download button, which mints a fresh, short-lived proxy-download token
// on click (authRouter.ts's createExportDownloadToken) rather than this
// endpoint handing out anything reusable.
export async function getDataExportStatus(deps: GetDataExportStatusDeps): Promise<DataExportRequestSummary[]> {
  const requests = await deps.findRequests()

  return requests.map((r) => ({
    id: r.id,
    status: r.status,
    requestedAt: r.requestedAt,
    expiresAt: r.expiresAt,
  }))
}
