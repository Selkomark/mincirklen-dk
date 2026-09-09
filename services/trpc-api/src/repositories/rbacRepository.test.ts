import { describe, expect, test } from 'bun:test'
import { maskEmail } from './rbacRepository'

describe('maskEmail', () => {
  test('keeps the first character of the local part and the full domain', () => {
    expect(maskEmail('mahan@selkomark.com')).toBe('m***@selkomark.com')
  })

  test('masks a single-character local part the same way', () => {
    expect(maskEmail('a@example.com')).toBe('a***@example.com')
  })

  test('falls back to a fixed placeholder for a malformed address', () => {
    expect(maskEmail('not-an-email')).toBe('***')
  })
})
