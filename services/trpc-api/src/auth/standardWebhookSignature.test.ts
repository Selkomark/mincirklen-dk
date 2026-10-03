import { describe, expect, test } from 'bun:test'
import { decodeStandardWebhookSecret, signStandardWebhook, verifyStandardWebhookSignature } from './standardWebhookSignature'

// Shaped like a real AhaSend secret (`aha-whsec-` + an opaque token) —
// not a `whsec_<base64>` one. Confirmed directly against a live
// `ahasend webhooks listen` session that AhaSend signs with this exact
// string's raw bytes, prefix included, never base64-decoded — see this
// file's own doc comment. Deliberately not valid base64 payload-wise,
// so a regression back to the old strip-and-decode behavior would fail
// loudly here instead of silently passing.
const SECRET = 'aha-whsec-dWiior5LxSoboJuNonP96S01PI1P7pdcyuSaRXkr6pnmx1002pOemDhcrBRlXDgZ'
const NOW = new Date('2026-10-03T12:00:00Z')
const TS = String(Math.floor(NOW.getTime() / 1000))
const BODY = '{"type":"message.delivered","data":{"id":"<m1@x>"}}'

function headers(sig: string, overrides: Partial<{ id: string; ts: string }> = {}) {
  return { webhookId: overrides.id ?? 'msg_1', timestamp: overrides.ts ?? TS, signatureHeader: sig }
}

describe('decodeStandardWebhookSecret', () => {
  test('is the untouched secret string, prefix included — never stripped or base64-decoded', () => {
    expect(decodeStandardWebhookSecret(SECRET)).toEqual(Buffer.from(SECRET, 'utf8'))
  })
})

describe('verifyStandardWebhookSignature', () => {
  test('accepts a correctly signed delivery', () => {
    expect(verifyStandardWebhookSignature(headers(signStandardWebhook('msg_1', TS, BODY, SECRET)), BODY, SECRET, NOW)).toBe(true)
  })

  // The real bug this reproduces: a previous version of this file
  // stripped `aha-whsec-`/`whsec_` and base64-decoded the remainder,
  // which made every self-consistency test above pass (sign and verify
  // used the same wrong derivation) while rejecting every real AhaSend
  // delivery. This recomputes the signature the way AhaSend's own CLI
  // actually does — raw secret bytes, no decoding — independently of
  // signStandardWebhook, so a regression to the old behavior fails here
  // even though the rest of this suite would still pass.
  test('matches a signature computed independently the way AhaSend actually signs (regression guard)', () => {
    const { createHmac } = require('node:crypto') as typeof import('node:crypto')
    const independentSig = createHmac('sha256', Buffer.from(SECRET, 'utf8')).update(`msg_1.${TS}.${BODY}`).digest('base64')
    expect(verifyStandardWebhookSignature(headers(`v1,${independentSig}`), BODY, SECRET, NOW)).toBe(true)
  })

  test('rejects a wrong secret, a tampered body, or a different webhook id', () => {
    const sig = signStandardWebhook('msg_1', TS, BODY, SECRET)
    expect(verifyStandardWebhookSignature(headers(sig), BODY, 'whsec_' + Buffer.from('other').toString('base64'), NOW)).toBe(false)
    expect(verifyStandardWebhookSignature(headers(sig), BODY + ' ', SECRET, NOW)).toBe(false)
    expect(verifyStandardWebhookSignature(headers(sig, { id: 'msg_2' }), BODY, SECRET, NOW)).toBe(false)
  })

  test('rejects a timestamp outside the window, in either direction, or not a number', () => {
    const old = String(Number(TS) - 301)
    expect(verifyStandardWebhookSignature(headers(signStandardWebhook('msg_1', old, BODY, SECRET), { ts: old }), BODY, SECRET, NOW)).toBe(false)
    const future = String(Number(TS) + 301)
    expect(verifyStandardWebhookSignature(headers(signStandardWebhook('msg_1', future, BODY, SECRET), { ts: future }), BODY, SECRET, NOW)).toBe(false)
    const edge = String(Number(TS) - 300)
    expect(verifyStandardWebhookSignature(headers(signStandardWebhook('msg_1', edge, BODY, SECRET), { ts: edge }), BODY, SECRET, NOW)).toBe(true)
    expect(verifyStandardWebhookSignature(headers(signStandardWebhook('msg_1', 'soon', BODY, SECRET), { ts: 'soon' }), BODY, SECRET, NOW)).toBe(false)
  })

  test('accepts when any v1 entry matches and ignores other versions and junk', () => {
    const good = signStandardWebhook('msg_1', TS, BODY, SECRET)
    expect(verifyStandardWebhookSignature(headers(`v1,AAAA ${good}`), BODY, SECRET, NOW)).toBe(true)
    expect(verifyStandardWebhookSignature(headers(`v2,${good.slice(3)}`), BODY, SECRET, NOW)).toBe(false)
    expect(verifyStandardWebhookSignature(headers('v1, nonsense v1'), BODY, SECRET, NOW)).toBe(false)
    expect(verifyStandardWebhookSignature(headers('v1,!!!not-base64!!!'), BODY, SECRET, NOW)).toBe(false)
  })

  test('rejects missing headers and an empty secret', () => {
    const good = signStandardWebhook('msg_1', TS, BODY, SECRET)
    expect(verifyStandardWebhookSignature({ webhookId: undefined, timestamp: TS, signatureHeader: good }, BODY, SECRET, NOW)).toBe(false)
    expect(verifyStandardWebhookSignature({ webhookId: 'msg_1', timestamp: undefined, signatureHeader: good }, BODY, SECRET, NOW)).toBe(false)
    expect(verifyStandardWebhookSignature({ webhookId: 'msg_1', timestamp: TS, signatureHeader: undefined }, BODY, SECRET, NOW)).toBe(false)
    expect(verifyStandardWebhookSignature(headers(good), BODY, '', NOW)).toBe(false)
  })

  test('defaults `now` to the clock', () => {
    const ts = String(Math.floor(Date.now() / 1000))
    expect(verifyStandardWebhookSignature(headers(signStandardWebhook('msg_1', ts, BODY, SECRET), { ts }), BODY, SECRET)).toBe(true)
  })
})
