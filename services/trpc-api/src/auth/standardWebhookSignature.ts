import { createHmac, timingSafeEqual } from 'node:crypto'

// Verifies a webhook delivery signed per the Standard Webhooks spec's
// header shape, which AhaSend uses: three headers — `webhook-id`,
// `webhook-timestamp` (unix seconds) and `webhook-signature`
// (space-separated `v1,<base64>` entries, several when the secret is
// being rotated) — and a signature that is HMAC-SHA256 over
// `${id}.${timestamp}.${rawBody}`.
//
// The key, deliberately NOT what the generic spec or this file's own
// earlier version assumed: AhaSend signs with the raw secret STRING
// bytes as-is — prefix (`aha-whsec-`) included, no base64 decoding.
// Confirmed directly against a real `ahasend webhooks listen` session
// (captured the exact forwarded request+secret and found the only key
// that reproduced its signature was the untouched secret string) — the
// generic spec's "strip whsec_, base64-decode the rest" convention,
// which this file previously implemented and both the sign/verify sides
// of its own test suite agreed with each other on, never matched what
// AhaSend's real CLI actually does. A same-file round-trip test can't
// catch this kind of bug; only testing against the real provider does.
//
// Never throws: a malformed header is just an invalid signature. The
// timestamp window stops a captured delivery being replayed later; the
// webhook id's uniqueness in email_events stops it being replayed
// within the window.

const DEFAULT_TOLERANCE_SECONDS = 5 * 60

export function decodeStandardWebhookSecret(secret: string): Buffer {
  return Buffer.from(secret, 'utf8')
}

export interface StandardWebhookHeaders {
  webhookId: string | undefined
  timestamp: string | undefined
  signatureHeader: string | undefined
}

export function verifyStandardWebhookSignature(
  headers: StandardWebhookHeaders,
  rawBody: string,
  secret: string,
  now: Date = new Date(),
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
): boolean {
  const { webhookId, timestamp, signatureHeader } = headers
  if (!webhookId || !timestamp || !signatureHeader) return false
  if (!/^\d+$/.test(timestamp)) return false
  const skew = Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp))
  if (skew > toleranceSeconds) return false

  const key = decodeStandardWebhookSecret(secret)
  if (key.length === 0) return false
  const expected = createHmac('sha256', key).update(`${webhookId}.${timestamp}.${rawBody}`).digest()

  for (const entry of signatureHeader.split(' ')) {
    const [version, encoded] = entry.split(',')
    if (version !== 'v1' || !encoded) continue
    const provided = Buffer.from(encoded, 'base64')
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) return true
  }
  return false
}

// For tests and tooling: produce the header value a sender would attach.
export function signStandardWebhook(webhookId: string, timestamp: string, rawBody: string, secret: string): string {
  const key = decodeStandardWebhookSecret(secret)
  return `v1,${createHmac('sha256', key).update(`${webhookId}.${timestamp}.${rawBody}`).digest('base64')}`
}
