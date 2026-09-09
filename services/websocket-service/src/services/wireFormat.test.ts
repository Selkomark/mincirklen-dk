import { describe, expect, test } from 'bun:test'
import { decodeFrame, encodeFrame, reencodeForClient } from './wireFormat'

const SAMPLE_FRAME = {
  type: 'roster-update',
  sessionId: 's1',
  currentTurnUserId: 'u1',
  roster: [
    { userId: 'u1', turnOrder: 0 },
    { userId: 'u2', turnOrder: 1 },
  ],
}

describe('encodeFrame / decodeFrame round-trip', () => {
  test('json mode: encodes to a string, decodes back to the same value', () => {
    const encoded = encodeFrame('json', SAMPLE_FRAME)
    expect(typeof encoded).toBe('string')
    expect(decodeFrame('json', encoded as string)).toEqual(SAMPLE_FRAME)
  })

  test('binary mode: encodes to a Uint8Array, decodes back to the same value', () => {
    const encoded = encodeFrame('binary', SAMPLE_FRAME)
    expect(encoded).toBeInstanceOf(Uint8Array)
    expect(decodeFrame('binary', encoded as Uint8Array)).toEqual(SAMPLE_FRAME)
  })

  test('binary mode is smaller on the wire than json mode for the same frame', () => {
    const jsonEncoded = encodeFrame('json', SAMPLE_FRAME) as string
    const binaryEncoded = encodeFrame('binary', SAMPLE_FRAME) as Uint8Array
    expect(binaryEncoded.byteLength).toBeLessThan(jsonEncoded.length)
  })
})

describe('decodeFrame malformed input', () => {
  test('json mode: invalid JSON text decodes to undefined, does not throw', () => {
    expect(decodeFrame('json', 'not json')).toBeUndefined()
  })

  test('json mode: a non-string raw value decodes to undefined', () => {
    expect(decodeFrame('json', new Uint8Array([1, 2, 3]))).toBeUndefined()
  })

  test('binary mode: garbage bytes decode to undefined, does not throw', () => {
    expect(decodeFrame('binary', new Uint8Array([0xff, 0xff, 0xff, 0xff]))).toBeUndefined()
  })

  test('binary mode: accepts a plain ArrayBuffer, not just a Uint8Array', () => {
    const encoded = encodeFrame('binary', SAMPLE_FRAME) as Uint8Array
    const arrayBuffer = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
    expect(decodeFrame('binary', arrayBuffer)).toEqual(SAMPLE_FRAME)
  })
})

describe('reencodeForClient', () => {
  test('transcodes a NATS JSON string into json mode (identity)', () => {
    const natsJson = JSON.stringify(SAMPLE_FRAME)
    expect(reencodeForClient('json', natsJson)).toBe(natsJson)
  })

  test('transcodes a NATS JSON string into binary mode', () => {
    const natsJson = JSON.stringify(SAMPLE_FRAME)
    const reencoded = reencodeForClient('binary', natsJson)
    expect(reencoded).toBeInstanceOf(Uint8Array)
    expect(decodeFrame('binary', reencoded as Uint8Array)).toEqual(SAMPLE_FRAME)
  })
})
