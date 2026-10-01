import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import {
  createSessionToken,
  isSessionTokenFresh,
  shouldReissueSessionToken,
  verifySessionToken,
  verifySessionTokenSignature,
} from './sessionToken'

const SECRET = 'test-secret'
const USER_ID = '11111111-1111-1111-1111-111111111111'

function signToken(userId: string, issuedAtSeconds: number, secret: string): string {
  const payload = `${userId}.${issuedAtSeconds}`
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

describe('sessionToken', () => {
  test('round-trips a freshly created token', () => {
    const token = createSessionToken(USER_ID, SECRET)
    const result = verifySessionToken(token, SECRET)

    expect(result).not.toBeNull()
    expect(result?.userId).toBe(USER_ID)
  })

  test('rejects a token signed with a different secret', () => {
    const token = createSessionToken(USER_ID, SECRET)
    expect(verifySessionToken(token, 'wrong-secret')).toBeNull()
  })

  test('rejects a tampered payload', () => {
    const token = createSessionToken(USER_ID, SECRET)
    const [, issuedAt, signature] = token.split('.')
    const tampered = `22222222-2222-2222-2222-222222222222.${issuedAt}.${signature}`

    expect(verifySessionToken(tampered, SECRET)).toBeNull()
  })

  test('rejects a malformed token', () => {
    expect(verifySessionToken('not-a-valid-token', SECRET)).toBeNull()
  })

  test('rejects a token whose signature has a different length', () => {
    const token = createSessionToken(USER_ID, SECRET)
    const [userId, issuedAt] = token.split('.')
    expect(verifySessionToken(`${userId}.${issuedAt}.short`, SECRET)).toBeNull()
  })

  test('rejects a token past its max age', () => {
    const issuedAtSeconds = Math.floor(Date.now() / 1000) - 1000
    const token = signToken(USER_ID, issuedAtSeconds, SECRET)

    expect(verifySessionToken(token, SECRET, 500)).toBeNull()
  })

  test('rejects a token issued in the future', () => {
    const issuedAtSeconds = Math.floor(Date.now() / 1000) + 1000
    const token = signToken(USER_ID, issuedAtSeconds, SECRET)

    expect(verifySessionToken(token, SECRET)).toBeNull()
  })

  test('rejects a token with a non-numeric issuedAt', () => {
    const token = signToken(USER_ID, Number.NaN, SECRET)
    expect(verifySessionToken(token, SECRET)).toBeNull()
  })

  test('accepts a token within a custom max age', () => {
    const issuedAtSeconds = Math.floor(Date.now() / 1000) - 10
    const token = signToken(USER_ID, issuedAtSeconds, SECRET)

    expect(verifySessionToken(token, SECRET, 60)?.userId).toBe(USER_ID)
  })
})

describe('verifySessionTokenSignature', () => {
  test('verifies a valid token regardless of age, with no maxAgeSeconds opinion', () => {
    const issuedAtSeconds = Math.floor(Date.now() / 1000) - 1_000_000
    const token = signToken(USER_ID, issuedAtSeconds, SECRET)

    const result = verifySessionTokenSignature(token, SECRET)
    expect(result?.userId).toBe(USER_ID)
  })

  test('still rejects a token issued in the future (tamper/clock-skew, not a duration concern)', () => {
    const issuedAtSeconds = Math.floor(Date.now() / 1000) + 1000
    const token = signToken(USER_ID, issuedAtSeconds, SECRET)

    expect(verifySessionTokenSignature(token, SECRET)).toBeNull()
  })

  test('rejects a tampered payload', () => {
    const token = createSessionToken(USER_ID, SECRET)
    const [, issuedAt, signature] = token.split('.')
    const tampered = `22222222-2222-2222-2222-222222222222.${issuedAt}.${signature}`

    expect(verifySessionTokenSignature(tampered, SECRET)).toBeNull()
  })
})

describe('isSessionTokenFresh', () => {
  test('true when age is under maxAgeSeconds', () => {
    const issuedAt = new Date(Date.now() - 10_000)
    expect(isSessionTokenFresh(issuedAt, 60)).toBe(true)
  })

  test('true exactly at the boundary', () => {
    const issuedAt = new Date(Date.now() - 60_000)
    expect(isSessionTokenFresh(issuedAt, 60)).toBe(true)
  })

  test('false once age exceeds maxAgeSeconds', () => {
    const issuedAt = new Date(Date.now() - 120_000)
    expect(isSessionTokenFresh(issuedAt, 60)).toBe(false)
  })
})

describe('shouldReissueSessionToken', () => {
  test('false before half the max age has elapsed', () => {
    const issuedAt = new Date(Date.now() - 10_000)
    expect(shouldReissueSessionToken(issuedAt, 60)).toBe(false)
  })

  test('true once at least half the max age has elapsed', () => {
    const issuedAt = new Date(Date.now() - 31_000)
    expect(shouldReissueSessionToken(issuedAt, 60)).toBe(true)
  })

  test('true for a token already past its full max age (still fresh-adjacent, caller checks freshness separately)', () => {
    const issuedAt = new Date(Date.now() - 90_000)
    expect(shouldReissueSessionToken(issuedAt, 60)).toBe(true)
  })
})
