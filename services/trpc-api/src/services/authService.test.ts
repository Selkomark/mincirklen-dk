import { describe, expect, test } from 'bun:test'
import { resolveSession } from './authService'

describe('resolveSession', () => {
  test('returns null when no token is present', async () => {
    const result = await resolveSession(
      {
        verifyToken: () => {
          throw new Error('should not be called')
        },
        touchUser: async () => {
          throw new Error('should not be called')
        },
        isBanned: async () => {
          throw new Error('should not be called')
        },
      },
      null,
    )

    expect(result).toBeNull()
  })

  test('returns null when the token fails verification', async () => {
    const result = await resolveSession(
      {
        verifyToken: () => null,
        touchUser: async () => {
          throw new Error('should not be called')
        },
        isBanned: async () => {
          throw new Error('should not be called')
        },
      },
      'bad-token',
    )

    expect(result).toBeNull()
  })

  test('returns null when the user no longer exists (touch affects 0 rows)', async () => {
    const result = await resolveSession(
      {
        verifyToken: () => ({ userId: 'user-1' }),
        touchUser: async () => false,
        isBanned: async () => {
          throw new Error('should not be called')
        },
      },
      'good-token',
    )

    expect(result).toBeNull()
  })

  test('returns null when the account is banned, even though the token and touch both succeed', async () => {
    const result = await resolveSession(
      {
        verifyToken: () => ({ userId: 'user-1' }),
        touchUser: async () => true,
        isBanned: async () => true,
      },
      'good-token',
    )

    expect(result).toBeNull()
  })

  test('returns the user id when the token verifies, the touch succeeds, and the account is not banned', async () => {
    const result = await resolveSession(
      {
        verifyToken: () => ({ userId: 'user-1' }),
        touchUser: async () => true,
        isBanned: async () => false,
      },
      'good-token',
    )

    expect(result).toBe('user-1')
  })
})
