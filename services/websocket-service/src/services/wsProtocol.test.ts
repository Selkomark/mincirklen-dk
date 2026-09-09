import { describe, expect, test } from 'bun:test'
import { isLiveCountFrame, parseClientFrame } from './wsProtocol'

describe('parseClientFrame', () => {
  test('parses a session subscribe frame', () => {
    expect(parseClientFrame({ type: 'subscribe', scope: 'session', sessionId: 's1' })).toEqual({
      type: 'subscribe',
      scope: 'session',
      sessionId: 's1',
    })
  })

  test('parses a session unsubscribe frame', () => {
    expect(parseClientFrame({ type: 'unsubscribe', scope: 'session', sessionId: 's1' })).toEqual({
      type: 'unsubscribe',
      scope: 'session',
      sessionId: 's1',
    })
  })

  test('parses a browse subscribe frame', () => {
    expect(parseClientFrame({ type: 'subscribe', scope: 'browse', sessionIds: ['s1', 's2'] })).toEqual({
      type: 'subscribe',
      scope: 'browse',
      sessionIds: ['s1', 's2'],
    })
  })

  test('parses an empty browse window as a valid frame, not a rejection', () => {
    expect(parseClientFrame({ type: 'subscribe', scope: 'browse', sessionIds: [] })).toEqual({
      type: 'subscribe',
      scope: 'browse',
      sessionIds: [],
    })
  })

  test('parses a ping frame', () => {
    expect(parseClientFrame({ type: 'ping' })).toEqual({ type: 'ping' })
  })

  test('rejects a value that is not an object', () => {
    expect(parseClientFrame('hello')).toBeNull()
    expect(parseClientFrame(null)).toBeNull()
    expect(parseClientFrame(42)).toBeNull()
    expect(parseClientFrame(undefined)).toBeNull()
  })

  test('rejects an unrecognized type', () => {
    expect(parseClientFrame({ type: 'send', body: 'hi' })).toBeNull()
  })

  test('rejects a session subscribe missing sessionId', () => {
    expect(parseClientFrame({ type: 'subscribe', scope: 'session' })).toBeNull()
  })

  test('rejects a session subscribe with a non-string sessionId', () => {
    expect(parseClientFrame({ type: 'subscribe', scope: 'session', sessionId: 42 })).toBeNull()
  })

  test('rejects a browse subscribe with a non-array sessionIds', () => {
    expect(parseClientFrame({ type: 'subscribe', scope: 'browse', sessionIds: 's1' })).toBeNull()
  })

  test('rejects a browse subscribe with a non-string entry in sessionIds', () => {
    expect(parseClientFrame({ type: 'subscribe', scope: 'browse', sessionIds: ['s1', 42] })).toBeNull()
  })

  test('rejects an unrecognized scope', () => {
    expect(parseClientFrame({ type: 'subscribe', scope: 'planet', sessionId: 's1' })).toBeNull()
  })
})

describe('isLiveCountFrame', () => {
  test('true for a live-count-changed frame', () => {
    expect(isLiveCountFrame(JSON.stringify({ type: 'live-count-changed', sessionId: 's1', count: 3 }))).toBe(true)
  })

  test('false for another frame type', () => {
    expect(isLiveCountFrame(JSON.stringify({ type: 'roster-update', sessionId: 's1' }))).toBe(false)
    expect(isLiveCountFrame(JSON.stringify({ type: 'participant-joined', sessionId: 's1', userId: 'u1' }))).toBe(false)
  })

  test('false for invalid JSON', () => {
    expect(isLiveCountFrame('not json')).toBe(false)
  })
})
