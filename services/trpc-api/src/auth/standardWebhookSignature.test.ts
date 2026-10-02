import { describe, expect, test } from 'bun:test'
import { decodeStandardWebhookSecret, signStandardWebhook, verifyStandardWebhookSignature } from './standardWebhookSignature'

const SECRET = 'whsec_' + Buffer.from('a-32-byte-ish-secret-for-tests!!').toString('base64')
const NOW = new Date('2026-10-03T12:00:00Z')
const TS = String(Math.floor(NOW.getTime() / 1000))
const BODY = '{"type":"message.delivered","data":{"id":"<m1@x>"}}'

function headers(sig: string, overrides: Partial<{ id: string; ts: string }> = {}) {
  return { webhookId: overrides.id ?? 'msg_1', timestamp: overrides.ts ?? TS, signatureHeader: sig }
}

describe('verifyStandardWebhookSignature', () => {
  test('accepts a correctly signed delivery under either secret prefix', () => {
    expect(verifyStandardWebhookSignature(headers(signStandardWebhook('msg_1', TS, BODY, SECRET)), BODY, SECRET, NOW)).toBe(true)
    const aha = SECRET.replace('whsec_', 'aha-whsec-')
    expect(verifyStandardWebhookSignature(headers(signStandardWebhook('msg_1', TS, BODY, aha)), BODY, aha, NOW)).toBe(true)
    expect(decodeStandardWebhookSecret(aha).equals(decodeStandardWebhookSecret(SECRET))).toBe(true)
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
    expect(verifyStandardWebhookSignature(headers(good), BODY, 'whsec_', NOW)).toBe(false)
  })

  test('defaults `now` to the clock', () => {
    const ts = String(Math.floor(Date.now() / 1000))
    expect(verifyStandardWebhookSignature(headers(signStandardWebhook('msg_1', ts, BODY, SECRET), { ts }), BODY, SECRET)).toBe(true)
  })
})
