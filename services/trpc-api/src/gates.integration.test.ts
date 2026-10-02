import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, createSessionToken, runMigrations } from '@mincirklen/shared'
import { createApp } from './app'
import { insertUser } from './repositories/userRepository'
import { linkIdentity } from './repositories/userIdentityRepository'
import { upsertUserProfile } from './repositories/userProfileRepository'
import { createRole, listPermissions, replaceRolePermissions, assignRoleToUser } from './repositories/rbacRepository'
import { upsertState } from './repositories/featureGateStateRepository'

const pool = createPgPool(
  process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL,
  'test',
)
const db = createDb(pool)

await runMigrations(db, 'test')

const AUTH_SECRET = 'gates-integration-test-secret'
const VAULT = {
  provider: 'vault' as const,
  vaultAddr: process.env.TEST_VAULT_ADDR ?? 'http://localhost:8200',
  vaultToken: process.env.TEST_VAULT_TOKEN ?? 'dev-only-not-for-production',
}

const app = createApp({
  db,
  authSecret: AUTH_SECRET,
  moderationServiceUrl: 'http://unused.invalid',
  websocketServiceUrl: 'http://unused.invalid',
  internalServiceSecret: 'gates-integration-test-internal-secret',
  publicBaseUrl: 'https://dev-mincirklen.dk',
  vault: VAULT,
  pubsub: { provider: 'gcp', projectId: 'gates-integration-test', topic: 'data-export-requests' },
  identityHashKey: 'gates-integration-test-identity-hash-key',
  gcs: { provider: 'gcp', bucket: 'unused-in-this-test' },
  downloadTokenSecret: 'gates-integration-test-download-token-secret',
  trpcPublicBaseUrl: 'https://trpc.dev-mincirklen.dk',
  gateInviteSecret: 'gates-integration-test-gate-invite-secret',
})

afterAll(async () => {
  await db.destroy()
})

// Every test in this file cares about platform_launch's own mode, so
// reset it to the real code default (invite_only, no schedule) before
// each one rather than each test needing to know what an earlier test
// left it as.
beforeEach(async () => {
  await upsertState(db, 'platform_launch', { mode: 'invite_only', scheduledOpenAt: null, updatedBy: 'test-setup' })
})

interface Actor {
  cookie: string
  userId: string
}

async function mintBareUserCookie(): Promise<Actor> {
  const user = await insertUser(db)
  const token = createSessionToken(user.id, AUTH_SECRET)
  return { cookie: `mc_session=${token}`, userId: user.id }
}

async function createVerifiedActor(): Promise<Actor> {
  const actor = await mintBareUserCookie()
  await linkIdentity(db, actor.userId, 'google', `test-subject-${actor.userId}`)
  await upsertUserProfile(db, VAULT, {
    userId: actor.userId,
    firstName: 'Test',
    lastName: 'Actor',
    gender: 'other',
    country: 'US',
    mobileNumber: '+1 555 0100',
    stayAnonymous: true,
    termsAcceptedAt: new Date(),
  })
  return actor
}

async function createAdminActor(): Promise<Actor> {
  const actor = await createVerifiedActor()
  const role = await createRole(db, { name: `test-admin-${actor.userId}`, description: null })
  const permissions = await listPermissions(db)
  // users.read_pii too: since gatesRouter.ts masks signup addresses for
  // roles without it, and these tests match signups by address, the
  // actor mirrors a real launch manager (migration 0011).
  const ids = permissions.filter((p) => ['admin.access', 'gates.read', 'gates.manage', 'users.read_pii'].includes(p.slug)).map((p) => p.id)
  await replaceRolePermissions(db, role.id, ids)
  await assignRoleToUser(db, actor.userId, role.id)
  return actor
}

async function call(path: string, input: unknown, actor?: Actor) {
  return app.request(`/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(actor ? { cookie: actor.cookie } : {}) },
    body: JSON.stringify(input),
  })
}

async function query(path: string, input: Record<string, unknown>, actor?: Actor) {
  const search = new URLSearchParams({ input: JSON.stringify(input) })
  return app.request(`/trpc/${path}?${search.toString()}`, {
    headers: actor ? { cookie: actor.cookie } : {},
  })
}

function uniqueEmail(): string {
  return `${crypto.randomUUID()}@example.com`
}

describe('gates.submitSignup / gates.getStatus (public)', () => {
  test('submitting adds a pending signup, resubmitting is a no-op', async () => {
    const email = uniqueEmail()
    const first = await call('gates.submitSignup', { gateKey: 'platform_launch', email })
    expect(first.status).toBe(200)
    const second = await call('gates.submitSignup', { gateKey: 'platform_launch', email })
    expect(second.status).toBe(200)
  })

  test('getStatus reports closed with no access when invite_only and no cookie', async () => {
    const res = await query('gates.getStatus', { gateKey: 'platform_launch' })
    const body = (await res.json()) as { result: { data: { open: boolean; unlocked: boolean; hasAccess: boolean } } }
    expect(body.result.data).toEqual({ open: false, unlocked: false, hasAccess: false })
  })

  test('getStatus reports open/unlocked/access once the gate is flipped open', async () => {
    await upsertState(db, 'platform_launch', { mode: 'open', scheduledOpenAt: null, updatedBy: 'test' })
    const res = await query('gates.getStatus', { gateKey: 'platform_launch' })
    const body = (await res.json()) as { result: { data: { open: boolean; unlocked: boolean; hasAccess: boolean } } }
    expect(body.result.data).toEqual({ open: true, unlocked: true, hasAccess: true })
  })

  test('getStatus reports unlocked (not just hasAccess) for a real redeemed cookie, gate still closed', async () => {
    const admin = await createAdminActor()
    const email = uniqueEmail()
    await call('gates.submitSignup', { gateKey: 'platform_launch', email })
    const listRes = await query('gates.listSignups', { gateKey: 'platform_launch', status: 'pending', limit: 50 }, admin)
    const listBody = (await listRes.json()) as { result: { data: { signups: { id: string; email: string }[] } } }
    const target = listBody.result.data.signups.find((s) => s.email === email)!

    const grantRes = await call('gates.grantSignup', { signupId: target.id }, admin)
    const grantBody = (await grantRes.json()) as { result: { data: { inviteUrl: string } } }
    const token = new URL(grantBody.result.data.inviteUrl).searchParams.get('invite')!
    const redeemRes = await call('gates.redeemInvite', { token })
    const redeemedCookie = redeemRes.headers.get('set-cookie')!.split(';')[0]!

    const res = await app.request(`/trpc/gates.getStatus?${new URLSearchParams({ input: JSON.stringify({ gateKey: 'platform_launch' }) })}`, {
      headers: { cookie: redeemedCookie },
    })
    const body = (await res.json()) as { result: { data: { open: boolean; unlocked: boolean; hasAccess: boolean } } }
    expect(body.result.data).toEqual({ open: false, unlocked: true, hasAccess: true })
  })

  test('getStatus reports hasAccess but NOT unlocked for an admin bypass with no cookie of their own', async () => {
    const admin = await createAdminActor()
    const res = await query('gates.getStatus', { gateKey: 'platform_launch' }, admin)
    const body = (await res.json()) as { result: { data: { open: boolean; unlocked: boolean; hasAccess: boolean } } }
    expect(body.result.data).toEqual({ open: false, unlocked: false, hasAccess: true })
  })

  test('getStatus treats a past scheduled_open_at as open', async () => {
    await upsertState(db, 'platform_launch', {
      mode: 'invite_only',
      scheduledOpenAt: new Date(Date.now() - 60_000),
      updatedBy: 'test',
    })
    const res = await query('gates.getStatus', { gateKey: 'platform_launch' })
    const body = (await res.json()) as { result: { data: { open: boolean } } }
    expect(body.result.data.open).toBe(true)
  })

  test('getStatus rejects an unregistered gate key', async () => {
    const res = await query('gates.getStatus', { gateKey: 'not_a_real_gate' })
    expect(res.status).toBe(400)
  })
})

describe('requireGateAccess enforcement on a real gated procedure (auth.completeProfile)', () => {
  test('a bare, un-invited verified-path user is forbidden while the gate is invite_only', async () => {
    const actor = await mintBareUserCookie()
    await linkIdentity(db, actor.userId, 'google', `gate-test-${actor.userId}`)

    const res = await call(
      'auth.completeProfile',
      {
        firstName: 'X',
        lastName: 'Y',
        gender: 'other',
        country: 'US',
        mobileNumber: '+1 555 0100',
        stayAnonymous: true,
      },
      actor,
    )
    expect(res.status).toBe(403)
  })

  test('an admin (admin.access) passes with no gate cookie at all', async () => {
    const admin = await createAdminActor()
    // completeProfile requires googleLinkedProcedure only — admin already
    // satisfies that via createVerifiedActor's identity link, so this
    // proves the admin.access bypass in requireGateAccess itself, not
    // just downstream permission checks.
    const res = await call(
      'auth.completeProfile',
      {
        firstName: 'Admin',
        lastName: 'Actor',
        gender: 'other',
        country: 'US',
        mobileNumber: '+1 555 0100',
        stayAnonymous: true,
      },
      admin,
    )
    expect(res.status).toBe(200)
  })

  test('passes once the gate is flipped open, with no cookie', async () => {
    await upsertState(db, 'platform_launch', { mode: 'open', scheduledOpenAt: null, updatedBy: 'test' })
    const actor = await mintBareUserCookie()
    await linkIdentity(db, actor.userId, 'google', `gate-test-${actor.userId}`)

    const res = await call(
      'auth.completeProfile',
      {
        firstName: 'X',
        lastName: 'Y',
        gender: 'other',
        country: 'US',
        mobileNumber: '+1 555 0100',
        stayAnonymous: true,
      },
      actor,
    )
    expect(res.status).toBe(200)
  })
})

describe('grant -> redeem -> access, end to end', () => {
  test('a granted signup can redeem its invite and then pass the gate', async () => {
    const admin = await createAdminActor()
    const email = uniqueEmail()
    await call('gates.submitSignup', { gateKey: 'platform_launch', email })

    const listRes = await query('gates.listSignups', { gateKey: 'platform_launch', status: 'pending', limit: 50 }, admin)
    const listBody = (await listRes.json()) as { result: { data: { signups: { id: string; email: string }[] } } }
    const target = listBody.result.data.signups.find((s) => s.email === email)!

    const grantRes = await call('gates.grantSignup', { signupId: target.id }, admin)
    expect(grantRes.status).toBe(200)
    const grantBody = (await grantRes.json()) as { result: { data: { inviteUrl: string } } }
    const { inviteUrl } = grantBody.result.data
    const token = new URL(inviteUrl).searchParams.get('invite')!

    const redeemRes = await call('gates.redeemInvite', { token })
    expect(redeemRes.status).toBe(200)
    const setCookie = redeemRes.headers.get('set-cookie')
    expect(setCookie).toContain('mc_gate_platform_launch=')

    const redeemedCookie = setCookie!.split(';')[0]!

    // The redeemed cookie now lets a *different, ungranted* verified user
    // through the same gated procedure — proving the cookie itself (not
    // the granted user's identity) is what requireGateAccess checks,
    // matching the "bearer credential, not identity-bound" design.
    const otherActor = await mintBareUserCookie()
    await linkIdentity(db, otherActor.userId, 'google', `gate-test-${otherActor.userId}`)
    const res = await call(
      'auth.completeProfile',
      {
        firstName: 'X',
        lastName: 'Y',
        gender: 'other',
        country: 'US',
        mobileNumber: '+1 555 0100',
        stayAnonymous: true,
      },
      { cookie: `${otherActor.cookie}; ${redeemedCookie}`, userId: otherActor.userId },
    )
    expect(res.status).toBe(200)
  })

  test('redeemInvite rejects an invalid token', async () => {
    const res = await call('gates.redeemInvite', { token: 'not-a-real-token' })
    expect(res.status).toBe(400)
  })

  // The whole point of GatesTab.tsx's Revoke button: an admin undoing a
  // grant must cut off someone who *already* redeemed their invite and
  // has been sitting on a real gate cookie, not just block a future
  // redemption of a link nobody's used yet. Before this re-check existed,
  // requireGateAccess/getStatus only verified the cookie's own signature
  // — a revoke would update the DB row but the still-valid-looking cookie
  // kept working forever.
  test('revoking a grant cuts off a cookie that already redeemed it, both for enforcement and for getStatus', async () => {
    const admin = await createAdminActor()
    const email = uniqueEmail()
    await call('gates.submitSignup', { gateKey: 'platform_launch', email })

    const listRes = await query('gates.listSignups', { gateKey: 'platform_launch', status: 'pending', limit: 50 }, admin)
    const listBody = (await listRes.json()) as { result: { data: { signups: { id: string; email: string }[] } } }
    const target = listBody.result.data.signups.find((s) => s.email === email)!

    const grantRes = await call('gates.grantSignup', { signupId: target.id }, admin)
    const grantBody = (await grantRes.json()) as { result: { data: { inviteUrl: string } } }
    const token = new URL(grantBody.result.data.inviteUrl).searchParams.get('invite')!

    const redeemRes = await call('gates.redeemInvite', { token })
    const redeemedCookie = redeemRes.headers.get('set-cookie')!.split(';')[0]!

    const otherActor = await mintBareUserCookie()
    await linkIdentity(db, otherActor.userId, 'google', `gate-test-${otherActor.userId}`)
    const invitedActor: Actor = { cookie: `${otherActor.cookie}; ${redeemedCookie}`, userId: otherActor.userId }

    // Confirm it actually works before revoking — otherwise a later 403
    // could just as easily mean the setup was wrong, not that revoke did
    // anything.
    const before = await call(
      'auth.completeProfile',
      { firstName: 'X', lastName: 'Y', gender: 'other', country: 'US', mobileNumber: '+1 555 0100', stayAnonymous: true },
      invitedActor,
    )
    expect(before.status).toBe(200)

    const revokeRes = await call('gates.revokeSignup', { signupId: target.id }, admin)
    expect(revokeRes.status).toBe(200)

    const statusRes = await app.request(`/trpc/gates.getStatus?${new URLSearchParams({ input: JSON.stringify({ gateKey: 'platform_launch' }) })}`, {
      headers: { cookie: redeemedCookie },
    })
    const statusBody = (await statusRes.json()) as { result: { data: { unlocked: boolean; hasAccess: boolean } } }
    expect(statusBody.result.data).toMatchObject({ unlocked: false, hasAccess: false })

    // A second, freshly-created user presenting the exact same (now-
    // revoked) cookie must also be rejected — this is a bearer-token
    // gate, not tied to whichever identity redeemed it first.
    const anotherActor = await mintBareUserCookie()
    await linkIdentity(db, anotherActor.userId, 'google', `gate-test-${anotherActor.userId}`)
    const after = await call(
      'auth.completeProfile',
      { firstName: 'X', lastName: 'Y', gender: 'other', country: 'US', mobileNumber: '+1 555 0100', stayAnonymous: true },
      { cookie: `${anotherActor.cookie}; ${redeemedCookie}`, userId: anotherActor.userId },
    )
    expect(after.status).toBe(403)
  })
})

describe('gates.list / gates.update (admin only)', () => {
  test('a non-admin verified user is forbidden', async () => {
    await upsertState(db, 'platform_launch', { mode: 'open', scheduledOpenAt: null, updatedBy: 'test' })
    const actor = await createVerifiedActor()
    const res = await query('gates.list', {}, actor)
    expect(res.status).toBe(403)
  })

  test('an admin sees platform_launch with aggregated stats', async () => {
    const admin = await createAdminActor()
    const email = uniqueEmail()
    await call('gates.submitSignup', { gateKey: 'platform_launch', email })

    const res = await query('gates.list', {}, admin)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      result: { data: { key: string; pendingCount: number; grantedCount: number }[] }
    }
    const gates = body.result.data
    const platformLaunch = gates.find((g) => g.key === 'platform_launch')!
    expect(platformLaunch.pendingCount).toBeGreaterThanOrEqual(1)
  })

  test('an admin can toggle the mode', async () => {
    const admin = await createAdminActor()
    const res = await call('gates.update', { gateKey: 'platform_launch', mode: 'open', scheduledOpenAt: null }, admin)
    expect(res.status).toBe(200)

    const status = await query('gates.getStatus', { gateKey: 'platform_launch' })
    expect(((await status.json()) as { result: { data: { open: boolean } } }).result.data.open).toBe(true)
  })

  test('update rejects an unregistered gate key', async () => {
    const admin = await createAdminActor()
    const res = await call('gates.update', { gateKey: 'not_a_real_gate', mode: 'open', scheduledOpenAt: null }, admin)
    expect(res.status).toBe(400)
  })
})
