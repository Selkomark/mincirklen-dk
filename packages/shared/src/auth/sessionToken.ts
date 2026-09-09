import { createHmac, timingSafeEqual } from 'node:crypto'

const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 180 // 180 days

export interface VerifiedSessionToken {
  userId: string
  issuedAt: Date
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function createSessionToken(userId: string, secret: string): string {
  const issuedAt = Math.floor(Date.now() / 1000)
  const payload = `${userId}.${issuedAt}`
  return `${payload}.${sign(payload, secret)}`
}

export function verifySessionToken(
  token: string,
  secret: string,
  maxAgeSeconds: number = DEFAULT_MAX_AGE_SECONDS,
): VerifiedSessionToken | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [userId, issuedAtRaw, signature] = parts as [string, string, string]
  const payload = `${userId}.${issuedAtRaw}`
  const expected = Buffer.from(sign(payload, secret))
  const provided = Buffer.from(signature)

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null
  }

  const issuedAtSeconds = Number(issuedAtRaw)
  if (!Number.isInteger(issuedAtSeconds)) return null

  const ageSeconds = Math.floor(Date.now() / 1000) - issuedAtSeconds
  if (ageSeconds < 0 || ageSeconds > maxAgeSeconds) return null

  return { userId, issuedAt: new Date(issuedAtSeconds * 1000) }
}
