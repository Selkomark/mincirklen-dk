import { createHmac, timingSafeEqual } from 'node:crypto'

// Platform default when a user holds no role carrying a shorter
// session-policy duration (rbacRepository.ts's
// findSessionPolicyAttributesForRoles / services/sessionPolicyService.ts).
// Exported (was private) so context.ts's cookie Max-Age can reference this
// instead of separately re-hardcoding the same number.
export const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 180 // 180 days

// Ceiling for anyone holding a role — i.e. anyone who can reach /manage.
// Used two ways (both in services/trpc-api/src/services/sessionPolicyService.ts
// and packages/shared/src/schemas/rbac.ts): it's what a role without an
// attached session policy falls back to instead of the 180-day member
// default above, and it's the most any policy is allowed to store. A
// role-holder's idle session can be shortened below this by a policy,
// never lengthened past it. Two weeks, not 180 days: an admin cookie
// that stays valid for half a year is a standing credential, not a
// session.
export const ROLE_MAX_IDLE_SECONDS = 60 * 60 * 24 * 14 // 14 days

// Reissue once more than half the resolved duration has elapsed — a
// standard sliding-session "renew at half-life" heuristic: avoids a fresh
// HMAC + Set-Cookie on literally every request while keeping idle-reset
// accuracy within one half-life of the real idle time. See
// shouldReissueSessionToken below.
export const REISSUE_AFTER_FRACTION_OF_MAX_AGE = 0.5

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

// Signature + tamper check only — no max-age/duration opinion. A role's
// effective max idle duration isn't knowable until *after* the userId
// here has been trusted and looked up, so verification is deliberately
// split in two: this phase first, then isSessionTokenFresh once the
// caller has resolved the right maxAgeSeconds for this specific user. See
// context.ts's createContextFactory for the two-phase call site.
export function verifySessionTokenSignature(token: string, secret: string): VerifiedSessionToken | null {
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

  // A future issuedAt isn't a "duration" problem, it's a tamper/clock-skew
  // one — belongs in the signature-trust phase, not the freshness check.
  const ageSeconds = Math.floor(Date.now() / 1000) - issuedAtSeconds
  if (ageSeconds < 0) return null

  return { userId, issuedAt: new Date(issuedAtSeconds * 1000) }
}

// Pure and synchronous on purpose — trivially unit-testable with fixed
// Dates, no token parsing/crypto involved.
export function isSessionTokenFresh(issuedAt: Date, maxAgeSeconds: number): boolean {
  const ageSeconds = Math.floor((Date.now() - issuedAt.getTime()) / 1000)
  return ageSeconds <= maxAgeSeconds
}

export function shouldReissueSessionToken(issuedAt: Date, maxAgeSeconds: number): boolean {
  const ageSeconds = Math.floor((Date.now() - issuedAt.getTime()) / 1000)
  return ageSeconds >= maxAgeSeconds * REISSUE_AFTER_FRACTION_OF_MAX_AGE
}

// Thin composition of the two phases above, for any caller that just
// wants one-shot verification against a single, already-known
// maxAgeSeconds (e.g. this file's own tests). Request-time verification
// in context.ts uses the two phases directly instead, since it needs a
// role lookup to happen in between them.
export function verifySessionToken(
  token: string,
  secret: string,
  maxAgeSeconds: number = DEFAULT_MAX_AGE_SECONDS,
): VerifiedSessionToken | null {
  const verified = verifySessionTokenSignature(token, secret)
  if (!verified) return null
  return isSessionTokenFresh(verified.issuedAt, maxAgeSeconds) ? verified : null
}
