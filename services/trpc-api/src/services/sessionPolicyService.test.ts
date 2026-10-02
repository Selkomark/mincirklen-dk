import { describe, expect, test } from 'bun:test'
import { resolveEffectiveMaxIdleSeconds } from './sessionPolicyService'

const DEFAULT = 60 * 60 * 24 * 180 // 180 days, seconds — ordinary members
const ROLE_CEILING = 60 * 60 * 24 * 14 // 2 weeks, seconds — anyone holding a role

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
      ROLE_CEILING,
    )

    expect(result).toBe(DEFAULT)
  })

  test('falls back to the role ceiling, not the global default, when held roles carry no policy', async () => {
    const result = await resolveEffectiveMaxIdleSeconds(
      { findSessionPolicyAttributesForRoles: async () => [] },
      ['role-1', 'role-2'],
      DEFAULT,
      ROLE_CEILING,
    )

    expect(result).toBe(ROLE_CEILING)
  })

  test('uses a single attached policy duration', async () => {
    const result = await resolveEffectiveMaxIdleSeconds(
      { findSessionPolicyAttributesForRoles: async () => [{ maxIdleSeconds: 900 }] },
      ['role-1'],
      DEFAULT,
      ROLE_CEILING,
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
      ROLE_CEILING,
    )

    expect(result).toBe(60)
  })

  test('a policy can only shorten a role session, never lengthen it past the role ceiling', async () => {
    const result = await resolveEffectiveMaxIdleSeconds(
      { findSessionPolicyAttributesForRoles: async () => [{ maxIdleSeconds: 60 * 60 * 24 * 30 }] }, // 30 days
      ['role-1'],
      DEFAULT,
      ROLE_CEILING,
    )

    expect(result).toBe(ROLE_CEILING)
  })

  test('the role ceiling itself never exceeds the global default', async () => {
    const shortGlobalDefault = 60 * 60 * 24 // a deployment that sets a 1-day platform default
    const result = await resolveEffectiveMaxIdleSeconds(
      { findSessionPolicyAttributesForRoles: async () => [] },
      ['role-1'],
      shortGlobalDefault,
      ROLE_CEILING,
    )

    expect(result).toBe(shortGlobalDefault)
  })

  test('ignores a policy attribute with no maxIdleSeconds set', async () => {
    const result = await resolveEffectiveMaxIdleSeconds(
      {
        findSessionPolicyAttributesForRoles: async () => [{}, { maxIdleSeconds: 300 }],
      },
      ['role-1', 'role-2'],
      DEFAULT,
      ROLE_CEILING,
    )

    expect(result).toBe(300)
  })
})
