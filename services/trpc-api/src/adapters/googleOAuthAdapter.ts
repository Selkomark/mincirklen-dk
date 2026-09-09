import { createPublicKey, verify as verifySignature } from 'node:crypto'

// Explicit constructor: see the note in repositories/sessionRepository.ts —
// Bun's coverage tool counts an empty-body `class X extends Error {}` as a
// permanently-uncovered function regardless of how many times `new X()` runs.
export class GoogleOAuthError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export interface GoogleOAuthEndpoints {
  authUri: string
  tokenUri: string
  jwksUri: string
}

// Configurable rather than hardcoded so integration tests can point these
// at a fake in-process Google — see session.integration.test.ts for the
// same pattern with a fake moderation-service.
const DEFAULT_ENDPOINTS: GoogleOAuthEndpoints = {
  authUri: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUri: 'https://oauth2.googleapis.com/token',
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
}

// Google accepts either form of its own issuer — checking only one is a
// real, easy-to-miss bug (confirmed against Google's current OpenID
// Connect docs).
const ACCEPTED_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  endpoints?: GoogleOAuthEndpoints
}

function endpointsFor(config: GoogleOAuthConfig): GoogleOAuthEndpoints {
  return config.endpoints ?? DEFAULT_ENDPOINTS
}

export function buildAuthorizationUrl(config: GoogleOAuthConfig, state: string): string {
  const url = new URL(endpointsFor(config).authUri)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')
  // `email` was added 2026-09-05 alongside CHARTER.md §4's carved-out
  // exception for essential account-operation data — email is now
  // required contact/record data, not optional profile info, so it's
  // requested at login rather than left out entirely. Still deliberately
  // minimal beyond that (no `profile` scope) — no name, picture, or other
  // profile data is needed.
  url.searchParams.set('scope', 'openid email')
  url.searchParams.set('state', state)
  return url.toString()
}

export interface TokenResponse {
  idToken: string
}

export async function exchangeCodeForTokens(config: GoogleOAuthConfig, code: string): Promise<TokenResponse> {
  const res = await fetch(endpointsFor(config).tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  })

  if (!res.ok) {
    throw new GoogleOAuthError(`token exchange failed: status ${res.status}`)
  }

  const body = await res.json().catch(() => null)
  const idToken = (body as { id_token?: unknown } | null)?.id_token

  if (typeof idToken !== 'string' || idToken.length === 0) {
    throw new GoogleOAuthError('token response missing id_token')
  }

  return { idToken }
}

interface Jwk {
  kty: string
  kid: string
  n: string
  e: string
}

interface JwksCacheEntry {
  keys: Jwk[]
  expiresAt: number
}

const jwksCache = new Map<string, JwksCacheEntry>()
const DEFAULT_JWKS_TTL_MS = 60 * 60 * 1000 // used when Cache-Control is absent/unparseable

function parseMaxAgeMs(cacheControl: string | null): number | null {
  const match = cacheControl?.match(/max-age=(\d+)/)
  return match?.[1] ? Number(match[1]) * 1000 : null
}

async function fetchJwks(jwksUri: string, forceRefresh: boolean): Promise<Jwk[]> {
  const cached = jwksCache.get(jwksUri)
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.keys
  }

  const res = await fetch(jwksUri)
  if (!res.ok) {
    throw new GoogleOAuthError(`failed to fetch JWKS: status ${res.status}`)
  }

  const body = (await res.json()) as { keys?: Jwk[] }
  const keys = body.keys ?? []
  const ttl = parseMaxAgeMs(res.headers.get('cache-control')) ?? DEFAULT_JWKS_TTL_MS
  jwksCache.set(jwksUri, { keys, expiresAt: Date.now() + ttl })

  return keys
}

function base64UrlDecode(segment: string): Buffer {
  return Buffer.from(segment, 'base64url')
}

export interface VerifiedIdToken {
  subject: string
  email: string
}

// Local verification (JWKS + RS256), not Google's `tokeninfo` endpoint —
// Google's own docs mark `tokeninfo` as debugging-only and subject to
// throttling; unsuitable for the real login path.
export async function verifyIdToken(config: GoogleOAuthConfig, idToken: string): Promise<VerifiedIdToken> {
  const endpoints = endpointsFor(config)
  const parts = idToken.split('.')
  if (parts.length !== 3) {
    throw new GoogleOAuthError('malformed id_token')
  }
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string]

  let header: { kid?: string; alg?: string }
  let payload: { sub?: string; aud?: string; iss?: string; exp?: number; email?: string; email_verified?: boolean }
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'))
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'))
  } catch {
    throw new GoogleOAuthError('malformed id_token')
  }

  if (header.alg !== 'RS256' || !header.kid) {
    throw new GoogleOAuthError('unsupported id_token header')
  }

  let keys = await fetchJwks(endpoints.jwksUri, false)
  let jwk = keys.find((k) => k.kid === header.kid)

  if (!jwk) {
    // Key rotation: refetch once before giving up, rather than treating an
    // unrecognized kid as permanently invalid.
    keys = await fetchJwks(endpoints.jwksUri, true)
    jwk = keys.find((k) => k.kid === header.kid)
  }

  if (!jwk) {
    throw new GoogleOAuthError('no matching signing key found')
  }

  const publicKey = createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' })
  const signedData = Buffer.from(`${headerB64}.${payloadB64}`)

  if (!verifySignature('RSA-SHA256', signedData, publicKey, base64UrlDecode(signatureB64))) {
    throw new GoogleOAuthError('invalid id_token signature')
  }

  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) {
    throw new GoogleOAuthError('id_token has expired')
  }

  if (!payload.iss || !ACCEPTED_ISSUERS.includes(payload.iss)) {
    throw new GoogleOAuthError('unexpected id_token issuer')
  }

  if (payload.aud !== config.clientId) {
    throw new GoogleOAuthError('unexpected id_token audience')
  }

  if (!payload.sub) {
    throw new GoogleOAuthError('id_token missing subject')
  }

  if (!payload.email) {
    throw new GoogleOAuthError('id_token missing email')
  }

  // Google's own OIDC docs warn against trusting the `email` claim without
  // checking this flag. Email is now essential contact/record data (see
  // CHARTER.md §4), so an unverified address must never be accepted.
  if (payload.email_verified !== true) {
    throw new GoogleOAuthError('id_token email not verified')
  }

  return { subject: payload.sub, email: payload.email }
}
