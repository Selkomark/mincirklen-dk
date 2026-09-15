import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { createGateInviteToken, verifyGateInviteToken } from './gateInviteToken'

const SECRET = 'test-secret'
const GATE_KEY = 'platform_launch'
const SIGNUP_ID = '11111111-1111-1111-1111-111111111111'

function signToken(gateKey: string, signupId: string, issuedAtSeconds: number, secret: string): string {
  const payload = `${gateKey}.${signupId}.${issuedAtSeconds}`
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

describe('gateInviteToken', () => {
  test('round-trips a freshly created token', () => {
    const token = createGateInviteToken(GATE_KEY, SIGNUP_ID, SECRET)
    const result = verifyGateInviteToken(token, SECRET)

    expect(result).not.toBeNull()
    expect(result?.gateKey).toBe(GATE_KEY)
    expect(result?.signupId).toBe(SIGNUP_ID)
  })

  test('rejects a token signed with a different secret', () => {
    const token = createGateInviteToken(GATE_KEY, SIGNUP_ID, SECRET)
    expect(verifyGateInviteToken(token, 'wrong-secret')).toBeNull()
  })

  test('rejects a tampered gateKey (cannot be replayed against a different gate)', () => {
    const token = createGateInviteToken(GATE_KEY, SIGNUP_ID, SECRET)
    const [, signupId, issuedAt, signature] = token.split('.')
    const tampered = `other_gate.${signupId}.${issuedAt}.${signature}`

    expect(verifyGateInviteToken(tampered, SECRET)).toBeNull()
  })

  test('rejects a malformed token', () => {
    expect(verifyGateInviteToken('not-a-valid-token', SECRET)).toBeNull()
  })

  test('rejects a token whose signature has a different length', () => {
    const token = createGateInviteToken(GATE_KEY, SIGNUP_ID, SECRET)
    const [gateKey, signupId, issuedAt] = token.split('.')
    expect(verifyGateInviteToken(`${gateKey}.${signupId}.${issuedAt}.short`, SECRET)).toBeNull()
  })

  test('rejects a token past its max age', () => {
    const issuedAtSeconds = Math.floor(Date.now() / 1000) - 1000
    const token = signToken(GATE_KEY, SIGNUP_ID, issuedAtSeconds, SECRET)

    expect(verifyGateInviteToken(token, SECRET, 500)).toBeNull()
  })

  test('rejects a token issued in the future', () => {
    const issuedAtSeconds = Math.floor(Date.now() / 1000) + 1000
    const token = signToken(GATE_KEY, SIGNUP_ID, issuedAtSeconds, SECRET)

    expect(verifyGateInviteToken(token, SECRET)).toBeNull()
  })

  test('rejects a token with a non-numeric issuedAt', () => {
    const token = signToken(GATE_KEY, SIGNUP_ID, Number.NaN, SECRET)
    expect(verifyGateInviteToken(token, SECRET)).toBeNull()
  })

  test('accepts a token within a custom max age', () => {
    const issuedAtSeconds = Math.floor(Date.now() / 1000) - 10
    const token = signToken(GATE_KEY, SIGNUP_ID, issuedAtSeconds, SECRET)

    expect(verifyGateInviteToken(token, SECRET, 60)?.signupId).toBe(SIGNUP_ID)
  })
})
