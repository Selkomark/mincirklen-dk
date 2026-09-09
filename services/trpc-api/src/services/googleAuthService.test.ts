import { describe, expect, test } from 'bun:test'
import { resolveGoogleLogin } from './googleAuthService'

describe('resolveGoogleLogin', () => {
  test('a known identity wins over an active anonymous session', async () => {
    const calls: string[] = []
    const result = await resolveGoogleLogin(
      {
        findUserIdByIdentity: async () => {
          calls.push('find')
          return 'established-user'
        },
        createUser: async () => {
          calls.push('create')
          return { id: 'should-not-be-created' }
        },
        linkIdentity: async () => {
          calls.push('link')
        },
        hasProfile: async () => true,
        userExists: async () => {
          throw new Error('should not check existence when the identity is already linked')
        },
      },
      'active-anonymous-user',
    )

    expect(result).toEqual({ userId: 'established-user', hasProfile: true })
    expect(calls).toEqual(['find'])
  })

  test('a known identity with no completed profile reports hasProfile: false', async () => {
    const result = await resolveGoogleLogin(
      {
        findUserIdByIdentity: async () => 'established-user',
        createUser: async () => {
          throw new Error('should not create a new user when one already exists')
        },
        linkIdentity: async () => {
          throw new Error('should not link an already-linked identity')
        },
        hasProfile: async () => false,
        userExists: async () => {
          throw new Error('should not check existence when the identity is already linked')
        },
      },
      null,
    )

    expect(result).toEqual({ userId: 'established-user', hasProfile: false })
  })

  test('a new identity upgrades the existing anonymous session, if it still exists', async () => {
    const linked: string[] = []
    const result = await resolveGoogleLogin(
      {
        findUserIdByIdentity: async () => null,
        createUser: async () => {
          throw new Error('should not create a new user when the existing one is still valid')
        },
        linkIdentity: async (userId) => {
          linked.push(userId)
        },
        hasProfile: async () => false,
        userExists: async () => true,
      },
      'active-anonymous-user',
    )

    expect(result).toEqual({ userId: 'active-anonymous-user', hasProfile: false })
    expect(linked).toEqual(['active-anonymous-user'])
  })

  test('a stale existingUserId (e.g. a deleted account) falls back to creating a fresh user instead of crashing', async () => {
    const linked: string[] = []
    const result = await resolveGoogleLogin(
      {
        findUserIdByIdentity: async () => null,
        createUser: async () => ({ id: 'brand-new-user' }),
        linkIdentity: async (userId) => {
          linked.push(userId)
        },
        hasProfile: async () => false,
        userExists: async () => false,
      },
      'deleted-user',
    )

    expect(result).toEqual({ userId: 'brand-new-user', hasProfile: false })
    expect(linked).toEqual(['brand-new-user'])
  })

  test('a new identity with no active anonymous session creates a fresh user', async () => {
    const linked: string[] = []
    const result = await resolveGoogleLogin(
      {
        findUserIdByIdentity: async () => null,
        createUser: async () => ({ id: 'brand-new-user' }),
        linkIdentity: async (userId) => {
          linked.push(userId)
        },
        hasProfile: async () => false,
        userExists: async () => {
          throw new Error('should not check existence when there is no existingUserId')
        },
      },
      null,
    )

    expect(result).toEqual({ userId: 'brand-new-user', hasProfile: false })
    expect(linked).toEqual(['brand-new-user'])
  })

  test('propagates a linkIdentity failure', async () => {
    await expect(
      resolveGoogleLogin(
        {
          findUserIdByIdentity: async () => null,
          createUser: async () => ({ id: 'p1' }),
          linkIdentity: async () => {
            throw new Error('db unavailable')
          },
          hasProfile: async () => false,
          userExists: async () => {
            throw new Error('should not check existence when there is no existingUserId')
          },
        },
        null,
      ),
    ).rejects.toThrow('db unavailable')
  })
})
