import { describe, expect, test } from 'bun:test'
import { isFullyVerified, isGoogleLinked } from './verificationService'

describe('isGoogleLinked', () => {
  test('reflects hasLinkedIdentity', async () => {
    expect(await isGoogleLinked({ hasLinkedIdentity: async () => true })).toBe(true)
    expect(await isGoogleLinked({ hasLinkedIdentity: async () => false })).toBe(false)
  })
})

describe('isFullyVerified', () => {
  test('true only when both linked and profiled', async () => {
    expect(
      await isFullyVerified({ hasLinkedIdentity: async () => true, hasProfile: async () => true }),
    ).toBe(true)
  })

  test('false when linked but not profiled', async () => {
    expect(
      await isFullyVerified({ hasLinkedIdentity: async () => true, hasProfile: async () => false }),
    ).toBe(false)
  })

  test('false when profiled but not linked (should not be reachable in practice)', async () => {
    expect(
      await isFullyVerified({ hasLinkedIdentity: async () => false, hasProfile: async () => true }),
    ).toBe(false)
  })

  test('false when neither', async () => {
    expect(
      await isFullyVerified({ hasLinkedIdentity: async () => false, hasProfile: async () => false }),
    ).toBe(false)
  })
})
