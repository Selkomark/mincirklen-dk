import type { EmailSender } from './emailAdapter'

// AhaSend's v2 send API, one call per message. Transport only: no
// retries (the caller records the failure and a human sees it in
// /manage), a hard timeout so a stalled provider can't hold a request
// open, and an error that keeps the HTTP status so the log says what
// kind of failure it was. Delivery events come back later through
// controllers/emailWebhookController.ts.

export interface AhaSendConfig {
  // e.g. https://send.ahasend.com/v2
  apiUrl: string
  accountId: string
  apiKey: string
  from: { email: string; name?: string }
  timeoutMs?: number
}

export class AhaSendError extends Error {
  constructor(
    message: string,
    // The HTTP status for a rejected call; null when the call never
    // completed (network error, timeout).
    readonly status: number | null,
  ) {
    super(message)
    this.name = 'AhaSendError'
  }
}

const DEFAULT_TIMEOUT_MS = 10_000

// The id the webhooks will later carry. AhaSend returns it under
// data[0].id (one entry per recipient); older/other shapes put it at the
// top level.
export function extractProviderMessageId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const first = Array.isArray(b.data) ? (b.data[0] as Record<string, unknown> | undefined) : undefined
  for (const candidate of [first?.id, b.id, b.message_id]) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return null
}

export function createAhaSendEmailSender(config: AhaSendConfig, fetchImpl: typeof fetch = fetch): EmailSender {
  const endpoint = `${config.apiUrl.replace(/\/$/, '')}/accounts/${encodeURIComponent(config.accountId)}/messages`
  return {
    async sendEmail(message) {
      let response: Response
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({
            from: config.from,
            recipients: [{ email: message.to }],
            subject: message.subject,
            html_content: message.html,
            text_content: message.text,
          }),
          signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        })
      } catch (err) {
        throw new AhaSendError(`AhaSend request failed: ${err instanceof Error ? err.message : String(err)}`, null)
      }
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 500)
        throw new AhaSendError(`AhaSend rejected the message (${response.status})${detail ? `: ${detail}` : ''}`, response.status)
      }
      const body: unknown = await response.json().catch(() => null)
      return { providerMessageId: extractProviderMessageId(body) }
    },
  }
}
