import { describe, expect, test } from 'bun:test'
import { hashEmail, normalizeEmail } from './emailHash'

describe('emailHash', () => {
  test('normalises case and surrounding whitespace before hashing', () => {
    expect(normalizeEmail('  Ann@Example.COM ')).toBe('ann@example.com')
    expect(hashEmail('  Ann@Example.COM ', 'k')).toBe(hashEmail('ann@example.com', 'k'))
  })

  test('is a 64-char hex digest that depends on the key', () => {
    const a = hashEmail('a@b.c', 'key-one')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(hashEmail('a@b.c', 'key-two')).not.toBe(a)
    expect(hashEmail('x@b.c', 'key-one')).not.toBe(a)
  })
})
