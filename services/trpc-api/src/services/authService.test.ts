import { describe, expect, test } from 'bun:test'
import { resolveSession } from './authService'

const FRESH_ISSUED_AT = new Date(Date.now() - 10_000) // 10s ago
const STALE_ISSUED_AT = new Date(Date.now() - 120_000) // 2min ago
const DEFAULT_MAX_IDLE_SECONDS = 60 * 60 * 24 * 180

describe('resolveSession', () => {
  test('returns null when there is no verified token', async () => {
    const result = await resolveSession(
      {
        touchUser: async () => {
          throw new Error('should not be called')
        },
        isBanned: async () => {
          throw new Error('should not be called')
        },
      },
      null,
      DEFAULT_MAX_IDLE_SECONDS,
    )

    expect(result).toBeNull()
  })

  test('returns null when the token is stale relative to the resolved maxIdleSeconds', async () => {
    const result = await resolveSession(
      {
        touchUser: async () => {
          throw new Error('should not be called')
        },
        isBanned: async () => {
          throw new Error('should not be called')
        },
      },
      { userId: 'user-1', issuedAt: STALE_ISSUED_AT },
      60, // a short role-resolved duration the 2min-old token has already exceeded
    )

    expect(result).toBeNull()
  })

  test('accepts a token that is stale against the platform default but fresh against a longer resolved duration', async () => {
    const result = await resolveSession(
      { touchUser: async () => true, isBanned: async () => false },
      { userId: 'user-1', issuedAt: STALE_ISSUED_AT },
      DEFAULT_MAX_IDLE_SECONDS,
    )

    expect(result).toBe('user-1')
  })

  test('returns null when the user no longer exists (touch affects 0 rows)', async () => {
    const result = await resolveSession(
      {
        touchUser: async () => false,
        isBanned: async () => {
          throw new Error('should not be called')
        },
      },
      { userId: 'user-1', issuedAt: FRESH_ISSUED_AT },
      DEFAULT_MAX_IDLE_SECONDS,
    )

    expect(result).toBeNull()
  })

  test('returns null when the account is banned, even though fresh and touch both succeed', async () => {
    const result = await resolveSession(
      { touchUser: async () => true, isBanned: async () => true },
      { userId: 'user-1', issuedAt: FRESH_ISSUED_AT },
      DEFAULT_MAX_IDLE_SECONDS,
    )

    expect(result).toBeNull()
  })

  test('returns the user id when fresh, the touch succeeds, and the account is not banned', async () => {
    const result = await resolveSession(
      { touchUser: async () => true, isBanned: async () => false },
      { userId: 'user-1', issuedAt: FRESH_ISSUED_AT },
      DEFAULT_MAX_IDLE_SECONDS,
    )

    expect(result).toBe('user-1')
  })
})
