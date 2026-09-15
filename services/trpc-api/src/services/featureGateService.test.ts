import { describe, expect, test } from 'bun:test'
import {
  SignupNotFoundError,
  UnknownGateError,
  grantSignupAccess,
  isGateEffectivelyOpen,
  isGateOpen,
  listGatesWithStats,
  redeemGateInvite,
  revokeSignupAccess,
  submitSignup,
  updateGateState,
} from './featureGateService'

describe('isGateOpen', () => {
  test('open mode is always open', () => {
    expect(isGateOpen({ mode: 'open', scheduledOpenAt: null })).toBe(true)
  })

  test('invite_only with no schedule is closed', () => {
    expect(isGateOpen({ mode: 'invite_only', scheduledOpenAt: null })).toBe(false)
  })

  test('invite_only with a future schedule is still closed', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    expect(isGateOpen({ mode: 'invite_only', scheduledOpenAt: new Date('2026-06-01T00:00:00Z') }, now)).toBe(false)
  })

  test('invite_only with a past schedule is open', () => {
    const now = new Date('2026-06-02T00:00:00Z')
    expect(isGateOpen({ mode: 'invite_only', scheduledOpenAt: new Date('2026-06-01T00:00:00Z') }, now)).toBe(true)
  })

  test('invite_only with the schedule exactly now is open', () => {
    const now = new Date('2026-06-01T00:00:00Z')
    expect(isGateOpen({ mode: 'invite_only', scheduledOpenAt: now }, now)).toBe(true)
  })
})

describe('isGateEffectivelyOpen', () => {
  test('falls back to the registry default when no override exists', async () => {
    const open = await isGateEffectivelyOpen({ findState: async () => null }, 'platform_launch')
    expect(open).toBe(false) // platform_launch defaults to invite_only
  })

  test('uses the DB override when one exists', async () => {
    const open = await isGateEffectivelyOpen(
      { findState: async () => ({ mode: 'open', scheduledOpenAt: null }) },
      'platform_launch',
    )
    expect(open).toBe(true)
  })
})

describe('submitSignup', () => {
  test('rejects an unknown gate key', async () => {
    await expect(
      submitSignup({ insertSignup: async () => {} }, { gateKey: 'not_real', email: 'a@example.com' }),
    ).rejects.toBeInstanceOf(UnknownGateError)
  })

  test('inserts a signup for a known gate', async () => {
    const calls: Array<{ gateKey: string; email: string }> = []
    await submitSignup(
      { insertSignup: async (gateKey, email) => void calls.push({ gateKey, email }) },
      { gateKey: 'platform_launch', email: 'a@example.com' },
    )
    expect(calls).toEqual([{ gateKey: 'platform_launch', email: 'a@example.com' }])
  })
})

describe('updateGateState', () => {
  test('rejects an unknown gate key', async () => {
    await expect(
      updateGateState(
        { upsertState: async () => {} },
        { gateKey: 'not_real', mode: 'open', scheduledOpenAt: null, updatedBy: null },
      ),
    ).rejects.toBeInstanceOf(UnknownGateError)
  })

  test('upserts state for a known gate', async () => {
    const calls: unknown[] = []
    await updateGateState(
      { upsertState: async (key, params) => void calls.push({ key, params }) },
      { gateKey: 'platform_launch', mode: 'open', scheduledOpenAt: null, updatedBy: 'admin:mahan' },
    )
    expect(calls).toEqual([
      { key: 'platform_launch', params: { mode: 'open', scheduledOpenAt: null, updatedBy: 'admin:mahan' } },
    ])
  })
})

describe('grantSignupAccess', () => {
  test('rejects a signup that does not exist', async () => {
    await expect(
      grantSignupAccess(
        { markGranted: async () => null, createInviteToken: () => 'unused' },
        { signupId: 'missing', grantedBy: null },
      ),
    ).rejects.toBeInstanceOf(SignupNotFoundError)
  })

  test('marks granted and mints an invite token', async () => {
    const result = await grantSignupAccess(
      {
        markGranted: async () => ({ id: 'signup-1', gateKey: 'platform_launch' }),
        createInviteToken: (gateKey, signupId) => `token-for-${gateKey}-${signupId}`,
      },
      { signupId: 'signup-1', grantedBy: 'admin:mahan' },
    )
    expect(result).toEqual({ signupId: 'signup-1', gateKey: 'platform_launch', token: 'token-for-platform_launch-signup-1' })
  })
})

describe('revokeSignupAccess', () => {
  test('rejects a signup that is not currently granted (missing, pending, or already revoked)', async () => {
    await expect(revokeSignupAccess({ markRevoked: async () => null }, { signupId: 'missing' })).rejects.toBeInstanceOf(
      SignupNotFoundError,
    )
  })

  test('marks revoked', async () => {
    const result = await revokeSignupAccess(
      { markRevoked: async () => ({ id: 'signup-1', gateKey: 'platform_launch' }) },
      { signupId: 'signup-1' },
    )
    expect(result).toEqual({ gateKey: 'platform_launch' })
  })
})

describe('redeemGateInvite', () => {
  test('rejects an invalid/unverifiable token', async () => {
    const result = await redeemGateInvite(
      { verifyToken: () => null, findSignupById: async () => ({ gateKey: 'platform_launch', status: 'granted' }) },
      'bad-token',
    )
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  test('rejects a token whose signup no longer exists', async () => {
    const result = await redeemGateInvite(
      {
        verifyToken: () => ({ gateKey: 'platform_launch', signupId: 'signup-1' }),
        findSignupById: async () => null,
      },
      'token',
    )
    expect(result).toEqual({ ok: false, reason: 'not_granted' })
  })

  test('rejects a token whose gateKey no longer matches the signup row', async () => {
    const result = await redeemGateInvite(
      {
        verifyToken: () => ({ gateKey: 'platform_launch', signupId: 'signup-1' }),
        findSignupById: async () => ({ gateKey: 'other_gate', status: 'granted' }),
      },
      'token',
    )
    expect(result).toEqual({ ok: false, reason: 'not_granted' })
  })

  test('rejects a signup that is no longer granted', async () => {
    const result = await redeemGateInvite(
      {
        verifyToken: () => ({ gateKey: 'platform_launch', signupId: 'signup-1' }),
        findSignupById: async () => ({ gateKey: 'platform_launch', status: 'pending' }),
      },
      'token',
    )
    expect(result).toEqual({ ok: false, reason: 'not_granted' })
  })

  test('accepts a valid, still-granted token', async () => {
    const result = await redeemGateInvite(
      {
        verifyToken: () => ({ gateKey: 'platform_launch', signupId: 'signup-1' }),
        findSignupById: async () => ({ gateKey: 'platform_launch', status: 'granted' }),
      },
      'token',
    )
    expect(result).toEqual({ ok: true, gateKey: 'platform_launch' })
  })
})

describe('listGatesWithStats', () => {
  test('zero-fills a registry key with no state row and no signups', async () => {
    const result = await listGatesWithStats({ listStates: async () => [], countsByGateKey: async () => new Map() })

    expect(result).toEqual([
      {
        key: 'platform_launch',
        name: 'Platform launch',
        description: 'Locks the whole platform behind an invite-only waitlist until public launch.',
        mode: 'invite_only',
        scheduledOpenAt: null,
        open: false,
        pendingCount: 0,
        grantedCount: 0,
        revokedCount: 0,
      },
    ])
  })

  test('merges a DB override and signup counts onto the registry entry', async () => {
    const result = await listGatesWithStats({
      listStates: async () => [{ key: 'platform_launch', mode: 'open', scheduledOpenAt: null }],
      countsByGateKey: async () => new Map([['platform_launch', { pending: 3, granted: 2, revoked: 1 }]]),
    })

    expect(result[0]).toMatchObject({ mode: 'open', open: true, pendingCount: 3, grantedCount: 2, revokedCount: 1 })
  })
})
