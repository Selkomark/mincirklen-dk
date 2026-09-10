import { describe, expect, test } from 'bun:test'
import { resolveGoogleLogin } from './googleAuthService'

describe('resolveGoogleLogin', () => {
  test('a known identity returns its existing user id without creating or linking anything', async () => {
    const calls: string[] = []
    const result = await resolveGoogleLogin({
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
    })

    expect(result).toEqual({ userId: 'established-user', hasProfile: true })
    expect(calls).toEqual(['find'])
  })

  test('a known identity with no completed profile reports hasProfile: false', async () => {
    const result = await resolveGoogleLogin({
      findUserIdByIdentity: async () => 'established-user',
      createUser: async () => {
        throw new Error('should not create a new user when one already exists')
      },
      linkIdentity: async () => {
        throw new Error('should not link an already-linked identity')
      },
      hasProfile: async () => false,
    })

    expect(result).toEqual({ userId: 'established-user', hasProfile: false })
  })

  test('a new identity creates a fresh user and links it', async () => {
    const linked: string[] = []
    const result = await resolveGoogleLogin({
      findUserIdByIdentity: async () => null,
      createUser: async () => ({ id: 'brand-new-user' }),
      linkIdentity: async (userId) => {
        linked.push(userId)
      },
      hasProfile: async () => false,
    })

    expect(result).toEqual({ userId: 'brand-new-user', hasProfile: false })
    expect(linked).toEqual(['brand-new-user'])
  })

  test('propagates a linkIdentity failure', async () => {
    await expect(
      resolveGoogleLogin({
        findUserIdByIdentity: async () => null,
        createUser: async () => ({ id: 'p1' }),
        linkIdentity: async () => {
          throw new Error('db unavailable')
        },
        hasProfile: async () => false,
      }),
    ).rejects.toThrow('db unavailable')
  })
})
