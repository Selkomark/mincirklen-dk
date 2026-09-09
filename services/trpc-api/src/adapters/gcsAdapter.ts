import { Storage } from '@google-cloud/storage'

// Read-only counterpart to services/data-export-service's own gcsAdapter.ts
// (which only ever uploads). Deliberately a separate file, not a shared
// one — same "each service owns its own narrow slice" convention as the
// two services' dataExportRequestRepository.ts files. trpc-api never
// writes to this bucket; it only proxies a completed export's bytes back
// to the browser through its own token-gated route (see
// controllers/exportDownloadController.ts), never handing out a GCS URL
// directly.
export class GcsError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export type GcsConfig =
  | { provider: 'emulator'; apiEndpoint: string; bucket: string }
  | { provider: 'gcp'; bucket: string }

function storageClientFor(config: GcsConfig): Storage {
  if (config.provider === 'emulator') {
    return new Storage({ apiEndpoint: config.apiEndpoint, projectId: 'mincirklen-local' })
  }
  return new Storage()
}

export interface DownloadedObject {
  body: Buffer
  contentType: string | undefined
}

export async function downloadExportObject(config: GcsConfig, objectKey: string): Promise<DownloadedObject> {
  const storage = storageClientFor(config)
  const file = storage.bucket(config.bucket).file(objectKey)

  try {
    const [[body], [metadata]] = await Promise.all([file.download(), file.getMetadata()])
    return { body, contentType: metadata.contentType }
  } catch (err) {
    throw new GcsError(`failed to download export object "${objectKey}": ${err instanceof Error ? err.message : String(err)}`)
  }
}
