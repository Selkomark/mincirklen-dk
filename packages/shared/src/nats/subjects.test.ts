import { describe, expect, test } from 'bun:test'
import { presenceSubject, roomSubject } from './subjects'

describe('roomSubject', () => {
  test('scopes the subject to the given session', () => {
    expect(roomSubject('s1')).toBe('room.s1.messages')
  })
})

describe('presenceSubject', () => {
  test('scopes the subject to the given session, distinct from roomSubject', () => {
    expect(presenceSubject('s1')).toBe('room.s1.presence')
    expect(presenceSubject('s1')).not.toBe(roomSubject('s1'))
  })
})
