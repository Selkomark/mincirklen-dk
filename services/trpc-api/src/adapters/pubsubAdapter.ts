// Fire-and-forget publish client for the data-export request pipeline
// (services/dataExportRequestService.ts) — trpc-api only ever publishes,
// it never subscribes or reads back. Same "no SDK, raw REST + the
// attached service account's metadata-server token" convention as
// adapters/kmsAdapter.ts's GCP branch, for the same reason: a single
// simple bearer-token REST call doesn't justify a whole client library.
// Local dev talks to the Pub/Sub emulator (docker-compose.yml's
// `pubsub` service) instead — same REST shape, no auth required.
export class PubSubError extends Error {
  constructor(message: string) {
    super(message)
  }
}

// `topic` is the real, environment-scoped topic name (e.g.
// "data-export-requests-prod" in production, matching
// IaC/modules/pubsub's naming — see IaC/environments/prod/main.tf's
// `module.data_export_pubsub`) — resolved once at boot from an env var,
// not hardcoded, so this adapter never has to guess which environment's
// topic it's talking to. Local dev's docker-compose.yml sets it to the
// bare "data-export-requests", matching what pubsub-init creates on the
// emulator (no environment suffix locally — there's only ever one).
export type PubSubConfig =
  | { provider: 'emulator'; emulatorUrl: string; projectId: string; topic: string }
  | { provider: 'gcp'; projectId: string; topic: string }

const GCP_METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'

// Deliberately not shared with kmsAdapter.ts's identical-looking cache —
// see that file's own comment for why: two independent, self-contained
// adapters rather than a shared auth module, so neither's behavior can
// be perturbed by a change made for the other's sake.
let cachedGcpToken: { token: string; expiresAtMs: number } | null = null

async function gcpAccessToken(): Promise<string> {
  if (cachedGcpToken && cachedGcpToken.expiresAtMs > Date.now()) {
    return cachedGcpToken.token
  }

  const res = await fetch(GCP_METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } })
  if (!res.ok) {
    throw new PubSubError(`GCP metadata token request failed: status ${res.status}`)
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: number }
  if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') {
    throw new PubSubError('GCP metadata token response missing access_token/expires_in')
  }

  cachedGcpToken = { token: body.access_token, expiresAtMs: Date.now() + (body.expires_in - 60) * 1000 }
  return cachedGcpToken.token
}

function publishUrl(config: PubSubConfig, topic: string): string {
  const base = config.provider === 'emulator' ? config.emulatorUrl : 'https://pubsub.googleapis.com'
  return `${base}/v1/projects/${config.projectId}/topics/${topic}:publish`
}

// Payload is deliberately minimal (just IDs, never personal data) —
// Pub/Sub messages can be logged/retained by GCP infra outside this
// app's own control, so the export worker looks everything else up
// itself from `requestId` once it receives this.
export interface DataExportRequestedMessage {
  requestId: string
  userId: string
}

export async function publishDataExportRequested(config: PubSubConfig, message: DataExportRequestedMessage): Promise<void> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (config.provider === 'gcp') {
    headers.authorization = `Bearer ${await gcpAccessToken()}`
  }

  const res = await fetch(publishUrl(config, config.topic), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      messages: [{ data: Buffer.from(JSON.stringify(message), 'utf8').toString('base64') }],
    }),
  })

  if (!res.ok) {
    throw new PubSubError(`pubsub publish to ${config.topic} failed: status ${res.status}`)
  }
}
