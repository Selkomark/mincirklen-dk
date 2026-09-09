// The whole reason this service exists as a standalone deployable: a bug
// anywhere in here (an OOM aggregating a very active account, a bad
// query, an unhandled edge case) can only take down this one worker's
// own Cloud Run instances. trpc-api never calls into this synchronously
// for anything — it only published the Pub/Sub message that got this
// invocation started — so it stays completely unaffected either way.
export interface GenerateExportDeps {
  findRequest: () => Promise<{ id: string; userId: string; status: string } | null>
  markProcessing: () => Promise<void>
  markReady: (params: { objectKey: string; expiresAt: Date }) => Promise<void>
  collectData: () => Promise<unknown>
  upload: (jsonBody: string) => Promise<void>
  // The bucket-internal path only — no signed URL generated here anymore.
  // trpc-api proxies downloads through its own token-gated route, minting
  // a fresh short-lived token per click (see exportDownloadService.ts in
  // trpc-api) — this worker no longer needs GCS signing access at all.
  objectKey: string
  now: () => Date
  retentionTtlMs: number
}

// Statuses a (re)delivery of the same Pub/Sub message should just ack
// without redoing anything — Pub/Sub push is at-least-once, so the same
// requestId can arrive more than once even on the happy path.
const ALREADY_CONCLUDED: readonly string[] = ['ready', 'failed', 'expired']

// Deliberately does NOT mark the row 'failed' on an error — see this
// file's sibling doc (the plan this shipped with) for why: doing so
// on the very first attempt would make a bounded-retry policy
// pointless, since a redelivery would just see 'failed' and stop. A
// thrown error here is meant to propagate all the way out to a non-2xx
// HTTP response, so Pub/Sub's own delivery-attempt/backoff policy gets
// a real chance to retry a transient failure. Only the separate
// dead-letter handler (markExportFailedFromDeadLetter, wired to the
// dead-letter topic's own subscription) ever writes 'failed' — reaching
// it means Pub/Sub itself already gave up after the configured number
// of attempts.
export async function generateExport(deps: GenerateExportDeps): Promise<void> {
  const request = await deps.findRequest()
  if (!request) {
    // Not a transient condition — retrying won't make a nonexistent row
    // appear. Treat as a hard failure to surface in logs/Sentry, but
    // there's nothing to mark, so this returns rather than throwing (no
    // row to retry against either way).
    return
  }

  if (ALREADY_CONCLUDED.includes(request.status)) return

  await deps.markProcessing()

  // No separate "does the user still exist" check: data_export_requests.
  // user_id cascades on delete (migrations/0001_init.ts), so deleting the
  // account atomically deletes this very row too — findRequest() above
  // would already have returned null, hitting the early-return case,
  // long before reaching here. There IS a narrower race left — the
  // account gets deleted *during* collectData() below, after this row
  // was confirmed to exist — but the worst case is a harmless orphaned
  // GCS object (markReady's UPDATE against an already-gone row is a
  // silent no-op, not an error) that the bucket's own lifecycle TTL
  // cleans up on its own; nothing is ever exposed to anyone since the
  // row it would have been linked to is gone too. Not worth guarding
  // against explicitly.
  const data = await deps.collectData()
  await deps.upload(JSON.stringify(data, null, 2))

  const expiresAt = new Date(deps.now().getTime() + deps.retentionTtlMs)
  await deps.markReady({ objectKey: deps.objectKey, expiresAt })
}

export interface MarkExportFailedDeps {
  markFailed: () => Promise<void>
}

// The dead-letter path — see generateExport's doc comment. Idempotent:
// marking an already-failed (or otherwise concluded) row 'failed' again
// is harmless, so this doesn't bother checking current status first.
export async function markExportFailedFromDeadLetter(deps: MarkExportFailedDeps): Promise<void> {
  await deps.markFailed()
}
