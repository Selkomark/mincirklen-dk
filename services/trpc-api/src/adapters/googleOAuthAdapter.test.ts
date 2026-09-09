import { afterEach, describe, expect, test } from 'bun:test'
import { generateKeyPairSync, sign as signData } from 'node:crypto'
import {
  GoogleOAuthError,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  verifyIdToken,
  type GoogleOAuthConfig,
} from './googleOAuthAdapter'

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const KID = 'test-key-1'
const JWKS_RESPONSE = { keys: [{ ...(publicKey.export({ format: 'jwk' }) as object), kid: KID }] }

const CONFIG: GoogleOAuthConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'https://dev-mincirklen.dk/api/auth/callback/google',
}

function base64url(input: string): string {
  return Buffer.from(input).toString('base64url')
}

function signJwt(payload: Record<string, unknown>, kid = KID): string {
  const header = { alg: 'RS256', kid, typ: 'JWT' }
  const headerB64 = base64url(JSON.stringify(header))
  const payloadB64 = base64url(JSON.stringify(payload))
  const signature = signData('RSA-SHA256', Buffer.from(`${headerB64}.${payloadB64}`), privateKey)
  return `${headerB64}.${payloadB64}.${signature.toString('base64url')}`
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'google-subject-123',
    aud: CONFIG.clientId,
    iss: 'https://accounts.google.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: 'person@example.com',
    email_verified: true,
    ...overrides,
  }
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockFetch(handlers: { jwks?: () => Response; token?: () => Response }) {
  globalThis.fetch = (async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('certs') && handlers.jwks) return handlers.jwks()
    if (url.includes('token') && handlers.token) return handlers.token()
    return new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
}

describe('buildAuthorizationUrl', () => {
  test('builds an authorization URL requesting only openid+email, with the given state', () => {
    const url = new URL(buildAuthorizationUrl(CONFIG, 'the-state'))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe(CONFIG.clientId)
    expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('openid email')
    expect(url.searchParams.get('state')).toBe('the-state')
  })
})

describe('exchangeCodeForTokens', () => {
  test('returns the id_token on success', async () => {
    mockFetch({ token: () => Response.json({ id_token: 'abc.def.ghi' }) })
    await expect(exchangeCodeForTokens(CONFIG, 'the-code')).resolves.toEqual({ idToken: 'abc.def.ghi' })
  })

  test('throws when the response is not ok', async () => {
    mockFetch({ token: () => new Response(null, { status: 400 }) })
    await expect(exchangeCodeForTokens(CONFIG, 'the-code')).rejects.toBeInstanceOf(GoogleOAuthError)
  })

  test('throws when the response has no id_token', async () => {
    mockFetch({ token: () => Response.json({ access_token: 'x' }) })
    await expect(exchangeCodeForTokens(CONFIG, 'the-code')).rejects.toThrow('missing id_token')
  })
})

describe('verifyIdToken', () => {
  test('accepts a validly-signed, unexpired token for the right audience', async () => {
    mockFetch({ jwks: () => Response.json(JWKS_RESPONSE) })
    const token = signJwt(validPayload())
    await expect(verifyIdToken(CONFIG, token)).resolves.toEqual({
      subject: 'google-subject-123',
      email: 'person@example.com',
    })
  })

  test('accepts the bare "accounts.google.com" issuer form too', async () => {
    mockFetch({ jwks: () => Response.json(JWKS_RESPONSE) })
    const token = signJwt(validPayload({ iss: 'accounts.google.com' }))
    await expect(verifyIdToken(CONFIG, token)).resolves.toEqual({
      subject: 'google-subject-123',
      email: 'person@example.com',
    })
  })

  test('rejects a token with no email claim', async () => {
    mockFetch({ jwks: () => Response.json(JWKS_RESPONSE) })
    const token = signJwt(validPayload({ email: undefined }))
    await expect(verifyIdToken(CONFIG, token)).rejects.toThrow('missing email')
  })

  test('rejects a token whose email is not verified', async () => {
    mockFetch({ jwks: () => Response.json(JWKS_RESPONSE) })
    const token = signJwt(validPayload({ email_verified: false }))
    await expect(verifyIdToken(CONFIG, token)).rejects.toThrow('not verified')
  })

  test('rejects a malformed token with the wrong number of segments', async () => {
    await expect(verifyIdToken(CONFIG, 'not-a-jwt')).rejects.toThrow('malformed')
  })

  test('rejects a token whose header/payload segments are not valid JSON', async () => {
    await expect(verifyIdToken(CONFIG, 'not.json.here')).rejects.toThrow('malformed')
  })

  test('rejects a token with an unsupported algorithm', async () => {
    const header = base64url(JSON.stringify({ alg: 'HS256', kid: KID, typ: 'JWT' }))
    const payload = base64url(JSON.stringify(validPayload()))
    await expect(verifyIdToken(CONFIG, `${header}.${payload}.sig`)).rejects.toThrow('unsupported')
  })

  test('rejects a token with the wrong audience', async () => {
    mockFetch({ jwks: () => Response.json(JWKS_RESPONSE) })
    const token = signJwt(validPayload({ aud: 'someone-elses-client-id' }))
    await expect(verifyIdToken(CONFIG, token)).rejects.toThrow('audience')
  })

  test('rejects a token with an unexpected issuer', async () => {
    mockFetch({ jwks: () => Response.json(JWKS_RESPONSE) })
    const token = signJwt(validPayload({ iss: 'https://evil.example' }))
    await expect(verifyIdToken(CONFIG, token)).rejects.toThrow('issuer')
  })

  test('rejects an expired token', async () => {
    mockFetch({ jwks: () => Response.json(JWKS_RESPONSE) })
    const token = signJwt(validPayload({ exp: Math.floor(Date.now() / 1000) - 10 }))
    await expect(verifyIdToken(CONFIG, token)).rejects.toThrow('expired')
  })

  test('rejects a token with a tampered payload', async () => {
    mockFetch({ jwks: () => Response.json(JWKS_RESPONSE) })
    const token = signJwt(validPayload())
    const [header, , signature] = token.split('.')
    const tamperedPayload = base64url(JSON.stringify(validPayload({ sub: 'someone-else' })))
    await expect(verifyIdToken(CONFIG, `${header}.${tamperedPayload}.${signature}`)).rejects.toThrow('signature')
  })

  test('rejects a token signed with a kid absent from the JWKS', async () => {
    mockFetch({ jwks: () => Response.json(JWKS_RESPONSE) })
    const token = signJwt(validPayload(), 'unknown-kid')
    await expect(verifyIdToken(CONFIG, token)).rejects.toThrow('no matching signing key')
  })

  test('throws when the JWKS endpoint itself fails', async () => {
    mockFetch({ jwks: () => new Response(null, { status: 503 }) })
    const token = signJwt(validPayload(), `never-cached-${crypto.randomUUID()}`)
    await expect(verifyIdToken(CONFIG, token)).rejects.toThrow('failed to fetch JWKS')
  })
})
