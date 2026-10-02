import { describe, expect, test } from 'bun:test'
import { createRoleInputSchema, ROLE_NAME_PATTERN, updateRoleInputSchema } from './rbac'

const ROLE_ID = '00000000-0000-4000-8000-000000000000'

describe('role name convention', () => {
  test.each(['ADMIN', 'TRUST-SAFETY-LEAD', 'TIER2', 'A1-B2'])('accepts %s', (name) => {
    expect(ROLE_NAME_PATTERN.test(name)).toBe(true)
    expect(createRoleInputSchema.safeParse({ name }).success).toBe(true)
    expect(updateRoleInputSchema.safeParse({ roleId: ROLE_ID, name }).success).toBe(true)
  })

  test.each([
    ['admin', 'lowercase'],
    ['Trust-Safety', 'mixed case'],
    ['TRUST_SAFETY', 'underscore separator'],
    ['TRUST SAFETY', 'space separator'],
    ['-ADMIN', 'leading dash'],
    ['ADMIN-', 'trailing dash'],
    ['TRUST--SAFETY', 'double dash'],
    ['ADMIN!', 'punctuation'],
    ['ÅDMIN', 'non-ASCII letter'],
  ])('rejects %s (%s)', (name) => {
    expect(ROLE_NAME_PATTERN.test(name)).toBe(false)
    expect(createRoleInputSchema.safeParse({ name }).success).toBe(false)
    expect(updateRoleInputSchema.safeParse({ roleId: ROLE_ID, name }).success).toBe(false)
  })

  test('keeps the existing length bounds', () => {
    expect(createRoleInputSchema.safeParse({ name: 'A' }).success).toBe(false)
    expect(createRoleInputSchema.safeParse({ name: 'A'.repeat(101) }).success).toBe(false)
    expect(createRoleInputSchema.safeParse({ name: 'A'.repeat(100) }).success).toBe(true)
  })
})
