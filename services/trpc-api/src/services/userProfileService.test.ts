import { describe, expect, test } from 'bun:test'
import { completeUserProfile } from './userProfileService'

const INPUT = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  gender: 'other' as const,
  country: 'GB',
  mobileNumber: '+44 20 7946 0958',
  stayAnonymous: true,
  trainingConsent: true,
}

describe('completeUserProfile', () => {
  test('stamps termsAcceptedAt with the current time and passes the rest through', async () => {
    const before = Date.now()
    let received: unknown

    const result = await completeUserProfile(
      {
        upsertUserProfile: async (params) => {
          received = params
          return { id: 'profile-1' }
        },
      },
      INPUT,
    )

    const after = Date.now()

    expect(result).toEqual({ id: 'profile-1' })
    expect(received).toMatchObject(INPUT)
    const termsAcceptedAt = (received as { termsAcceptedAt: Date }).termsAcceptedAt
    expect(termsAcceptedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(termsAcceptedAt.getTime()).toBeLessThanOrEqual(after)
  })
})
