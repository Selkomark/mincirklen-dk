import { describe, expect, test } from 'bun:test'
import { resolveEffectiveMaxIdleSeconds } from './sessionPolicyService'

const DEFAULT = 60 * 60 * 24 * 180 // 180 days, seconds

describe('resolveEffectiveMaxIdleSeconds', () => {
  test('returns the global default when the user holds no roles', async () => {
    const result = await resolveEffectiveMaxIdleSeconds(
      {
        findSessionPolicyAttributesForRoles: async () => {
          throw new Error('should not be called')
        },
      },
      [],
      DEFAULT,
    )

    expect(result).toBe(DEFAULT)
  })

  test('returns the global default when none of the held roles carry a policy', async () => {
    const result = await resolveEffectiveMaxIdleSeconds(
      { findSessionPolicyAttributesForRoles: async () => [] },
      ['role-1', 'role-2'],
      DEFAULT,
    )

    expect(result).toBe(DEFAULT)
  })

  test('uses a single attached policy duration', async () => {
    const result = await resolveEffectiveMaxIdleSeconds(
      { findSessionPolicyAttributesForRoles: async () => [{ maxIdleSeconds: 900 }] },
      ['role-1'],
      DEFAULT,
    )

    expect(result).toBe(900)
  })

  test('min-wins: the shortest of several attached policy durations governs', async () => {
    const result = await resolveEffectiveMaxIdleSeconds(
      {
        findSessionPolicyAttributesForRoles: async () => [
          { maxIdleSeconds: 60 * 60 * 24 }, // 1 day, the "moderator on non-threat sections" example
          { maxIdleSeconds: 60 }, // 1 minute, the "admin" example
        ],
      },
      ['role-moderator', 'role-admin'],
      DEFAULT,
    )

    expect(result).toBe(60)
  })

  test('a policy can only shorten the session, never lengthen it past the platform default', async () => {
    const result = await resolveEffectiveMaxIdleSeconds(
      { findSessionPolicyAttributesForRoles: async () => [{ maxIdleSeconds: 60 * 60 * 24 * 365 }] }, // 1 year
      ['role-1'],
      DEFAULT,
    )

    expect(result).toBe(DEFAULT)
  })

  test('ignores a policy attribute with no maxIdleSeconds set', async () => {
    const result = await resolveEffectiveMaxIdleSeconds(
      {
        findSessionPolicyAttributesForRoles: async () => [{}, { maxIdleSeconds: 300 }],
      },
      ['role-1', 'role-2'],
      DEFAULT,
    )

    expect(result).toBe(300)
  })
})
