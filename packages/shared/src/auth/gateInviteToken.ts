import { createHmac, timingSafeEqual } from 'node:crypto'

const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 90 // 90 days

export interface VerifiedGateInviteToken {
  gateKey: string
  signupId: string
  issuedAt: Date
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

// Same HMAC-sign/timing-safe-verify shape as sessionToken.ts, deliberately
// not shared code with it — a different payload and a separate secret
// (key separation: a leak of one shouldn't compromise the other). The
// gateKey rides inside the signed payload so one verify function works
// for every gate: a redemption endpoint never needs to be told up front
// which gate a token is for, and a token can't be replayed against a
// different gate's cookie by swapping the name it's stored under.
export function createGateInviteToken(gateKey: string, signupId: string, secret: string): string {
  const issuedAt = Math.floor(Date.now() / 1000)
  const payload = `${gateKey}.${signupId}.${issuedAt}`
  return `${payload}.${sign(payload, secret)}`
}

export function verifyGateInviteToken(
  token: string,
  secret: string,
  maxAgeSeconds: number = DEFAULT_MAX_AGE_SECONDS,
): VerifiedGateInviteToken | null {
  const parts = token.split('.')
  if (parts.length !== 4) return null

  const [gateKey, signupId, issuedAtRaw, signature] = parts as [string, string, string, string]
  const payload = `${gateKey}.${signupId}.${issuedAtRaw}`
  const expected = Buffer.from(sign(payload, secret))
  const provided = Buffer.from(signature)

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null
  }

  const issuedAtSeconds = Number(issuedAtRaw)
  if (!Number.isInteger(issuedAtSeconds)) return null

  const ageSeconds = Math.floor(Date.now() / 1000) - issuedAtSeconds
  if (ageSeconds < 0 || ageSeconds > maxAgeSeconds) return null

  return { gateKey, signupId, issuedAt: new Date(issuedAtSeconds * 1000) }
}
