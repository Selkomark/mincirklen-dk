import { Storage } from '@google-cloud/storage'

// Uses the official SDK, unlike kmsAdapter.ts's (trpc-api) raw-fetch
// convention — Google's own docs point here for GCS access from Cloud
// Run (ADC resolves the attached service account with no key file, no
// explicit signing to hand-roll). This worker only ever uploads — it no
// longer signs download URLs at all; trpc-api proxies downloads through
// its own token-gated route instead (see exportDownloadService.ts and
// controllers/exportDownloadController.ts in services/trpc-api).
export class GcsError extends Error {
  constructor(message: string) {
    super(message)
  }
}

// 'emulator' points at a local fake-gcs-server (docker-compose.yml's
// `gcs` service) for dev. 'gcp' is the real thing in production, using
// the attached service account's identity via ADC (Application Default
// Credentials) — no key file, no explicit service account email needed
// in code, the SDK resolves both from the Cloud Run metadata server.
export type GcsConfig =
  | { provider: 'emulator'; apiEndpoint: string; bucket: string }
  | { provider: 'gcp'; bucket: string }

function storageClientFor(config: GcsConfig): Storage {
  if (config.provider === 'emulator') {
    return new Storage({ apiEndpoint: config.apiEndpoint, projectId: 'mincirklen-local' })
  }
  return new Storage()
}

export async function uploadExportObject(config: GcsConfig, objectKey: string, jsonBody: string): Promise<void> {
  const storage = storageClientFor(config)
  const bucket = storage.bucket(config.bucket)

  try {
    await bucket.file(objectKey).save(jsonBody, { contentType: 'application/json', resumable: false })
  } catch (err) {
    throw new GcsError(`failed to upload export object "${objectKey}": ${err instanceof Error ? err.message : String(err)}`)
  }
}
