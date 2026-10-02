import { afterAll, describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, createSessionToken, runMigrations } from '@mincirklen/shared'
import { createApp } from './app'
import { insertUser, setEmail } from './repositories/userRepository'
import { encryptField } from './adapters/kmsAdapter'
import { createSession, joinSession } from './repositories/sessionRepository'
import { insertSessionReport } from './repositories/sessionReportRepository'
import { insertMessage, listMessages as listMessagesRepo } from './repositories/messageRepository'
import { linkIdentity } from './repositories/userIdentityRepository'
import { upsertState } from './repositories/featureGateStateRepository'
import {
  assignRoleToUser,
  createRole,
  createSessionPolicy,
  findRoleByName,
  setRoleSessionPolicy,
} from './repositories/rbacRepository'

const pool = createPgPool(
  process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL,
  'test',
)
const db = createDb(pool)

await runMigrations(db, 'test')

// platform_launch defaults to invite_only (packages/shared/src/gates/registry.ts)
// — this file exercises real auth.completeProfile flows through
// googleLinkedProcedure, which the gate now sits in front of
// (controllers/trpc.ts). Opening it here is the same thing a real admin
// does post-launch, not a workaround; requireGateAccess's own behavior is
// covered separately by app.integration.test.ts's dedicated gate tests
// below.
await upsertState(db, 'platform_launch', { mode: 'open', scheduledOpenAt: null, updatedBy: 'test-setup' })

// A real in-process fake, not a mocked fetch — same convention as
// oauth.integration.test.ts's fakeGoogle. requestDataExport (below)
// actually publishes through this, letting these tests assert on what
// was actually sent rather than trusting the adapter's own unit tests
// alone.
const publishedMessages: { topic: string; body: unknown }[] = []
const fakePubSub = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url)
    const match = url.pathname.match(/\/v1\/projects\/[^/]+\/topics\/([^/]+):publish$/)
    if (match?.[1] && req.method === 'POST') {
      publishedMessages.push({ topic: match[1], body: await req.json() })
      return Response.json({ messageIds: ['fake-message-id'] })
    }
    return new Response('not found', { status: 404 })
  },
})

const AUTH_SECRET = 'integration-test-secret'

const app = createApp({
  db,
  authSecret: AUTH_SECRET,
  moderationServiceUrl: 'http://unused.invalid',
  websocketServiceUrl: 'http://unused.invalid',
  internalServiceSecret: 'app-integration-test-internal-secret',
  publicBaseUrl: 'https://dev-mincirklen.dk',
  vault: {
    provider: 'vault',
    vaultAddr: process.env.TEST_VAULT_ADDR ?? 'http://localhost:8200',
    vaultToken: process.env.TEST_VAULT_TOKEN ?? 'dev-only-not-for-production',
  },
  pubsub: {
    provider: 'emulator',
    emulatorUrl: `http://localhost:${fakePubSub.port}`,
    projectId: 'app-integration-test',
    topic: 'data-export-requests',
  },
  identityHashKey: 'app-integration-test-identity-hash-key',
  gcs: { provider: 'gcp', bucket: 'unused-in-this-test' },
  downloadTokenSecret: 'app-integration-test-download-token-secret',
  trpcPublicBaseUrl: 'https://trpc.dev-mincirklen.dk',
  gateInviteSecret: 'app-integration-test-gate-invite-secret',
})

afterAll(async () => {
  fakePubSub.stop(true)
  await db.destroy()
})

// Stand-in for the removed auth.createAnonymousSession endpoint (see
// SECURITY_FINDINGS.md H1) — Google sign-in (oauth.integration.test.ts)
// is this platform's only real login door, so these tests mint a bare,
// unverified user directly against the repository/token layer instead of
// through a public HTTP endpoint. The Domain-scoped cookie behavior this
// used to assert on is exercised by oauth.integration.test.ts, which
// still goes through the real login route end-to-end.
async function mintBareUserCookie(): Promise<{ cookie: string; userId: string }> {
  const user = await insertUser(db)
  const token = createSessionToken(user.id, AUTH_SECRET)
  return { cookie: `mc_session=${token}`, userId: user.id }
}

// Mirrors sessionToken.test.ts's own signToken helper — a hand-signed
// token with an arbitrary issuedAt, so the session-policy idle-expiry
// tests below don't need to actually wait out a real duration.
function signTokenWithIssuedAt(userId: string, issuedAtSeconds: number, secret: string): string {
  const payload = `${userId}.${issuedAtSeconds}`
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function secondsAgo(seconds: number): number {
  return Math.floor(Date.now() / 1000) - seconds
}

describe('auth flow through the Hono app', () => {
  test('whoAmI succeeds with the issued cookie and fails without it', async () => {
    const { cookie, userId } = await mintBareUserCookie()

    const authed = await app.request('/trpc/auth.whoAmI', {
      headers: { cookie },
    })
    expect(authed.status).toBe(200)
    const authedBody = (await authed.json()) as { result: { data: { userId: string } } }
    expect(authedBody.result.data.userId).toBe(userId)

    const unauthed = await app.request('/trpc/auth.whoAmI')
    expect(unauthed.status).toBe(401)
  })

  test('logout clears the session cookie and works even with no session at all', async () => {
    const { cookie } = await mintBareUserCookie()

    const res = await app.request('/trpc/auth.logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const sessionCookieHeader = res.headers.getSetCookie().find((c) => c.startsWith('mc_session='))
    expect(sessionCookieHeader).toBeDefined()
    expect(sessionCookieHeader).toContain('Max-Age=0')
    // The clearing cookie must carry the same Domain as the one that set
    // it — a browser matches a cookie to clear by name+domain+path, so a
    // mismatched Domain here would silently fail to clear it.
    expect(sessionCookieHeader).toContain('Domain=dev-mincirklen.dk')

    const withoutSession = await app.request('/trpc/auth.logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(withoutSession.status).toBe(200)
  })

  test('completeProfile rejects a session that has no linked Google identity', async () => {
    const { cookie } = await mintBareUserCookie()

    const input = {
      firstName: 'Ada',
      lastName: 'Lovelace',
      gender: 'other',
      country: 'GB',
      mobileNumber: '+44 20 7946 0958',
      stayAnonymous: true,
    }

    // A bare unverified session — no Google link yet — must never be able
    // to "complete" a profile. Filling in name/mobile only counts once
    // it's tied to a real, traceable Google identity.
    const res = await app.request('/trpc/auth.completeProfile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(input),
    })
    expect(res.status).toBe(403)

    const unauthed = await app.request('/trpc/auth.completeProfile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    expect(unauthed.status).toBe(401)
  })

  test('completeProfile persists the submitted profile once Google-linked', async () => {
    const { cookie, userId } = await mintBareUserCookie()
    await linkIdentity(db, userId, 'google', `test-subject-${userId}`)

    const res = await app.request('/trpc/auth.completeProfile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        firstName: 'Ada',
        lastName: 'Lovelace',
        gender: 'other',
        country: 'GB',
        mobileNumber: '+44 20 7946 0958',
        stayAnonymous: true,
      }),
    })
    expect(res.status).toBe(200)
  })

  test('myProfile reports hasLinkedIdentity/hasProfile/profile through the full verification lifecycle, and requires auth', async () => {
    const { cookie, userId } = await mintBareUserCookie()

    const bare = await app.request('/trpc/auth.myProfile', { headers: { cookie } })
    expect(bare.status).toBe(200)
    const bareBody = (await bare.json()) as {
      result: { data: { hasLinkedIdentity: boolean; hasProfile: boolean; profile: unknown } }
    }
    expect(bareBody.result.data).toEqual({ hasLinkedIdentity: false, hasProfile: false, profile: null })

    await linkIdentity(db, userId, 'google', `test-subject-${userId}`)

    const linked = await app.request('/trpc/auth.myProfile', { headers: { cookie } })
    const linkedBody = (await linked.json()) as {
      result: { data: { hasLinkedIdentity: boolean; hasProfile: boolean; profile: unknown } }
    }
    expect(linkedBody.result.data).toEqual({ hasLinkedIdentity: true, hasProfile: false, profile: null })

    await app.request('/trpc/auth.completeProfile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        firstName: 'Grace',
        lastName: 'Hopper',
        gender: 'other',
        country: 'US',
        mobileNumber: '+1 202 555 0119',
        stayAnonymous: false,
      }),
    })

    const after = await app.request('/trpc/auth.myProfile', { headers: { cookie } })
    const afterBody = (await after.json()) as {
      result: { data: { hasLinkedIdentity: boolean; hasProfile: boolean; profile: { firstName: string } | null } }
    }
    expect(afterBody.result.data.hasLinkedIdentity).toBe(true)
    expect(afterBody.result.data.hasProfile).toBe(true)
    expect(afterBody.result.data.profile?.firstName).toBe('Grace')

    const unauthed = await app.request('/trpc/auth.myProfile')
    expect(unauthed.status).toBe(401)
  })

  test('myProfile reports hasProfile:true (and keeps the app usable) even when the profile ciphertext cannot be decrypted', async () => {
    // Reproduces the real incident: Vault's transit key rotated/reset out
    // from under existing ciphertext. Before this fix, myProfile's
    // hasProfile signal was derived from decrypt success — a KMS/Vault
    // outage silently reported a fully-registered user as "needs
    // profile," bouncing them back into the registration flow forever
    // instead of just degrading PII display.
    const { cookie, userId } = await mintBareUserCookie()
    await linkIdentity(db, userId, 'google', `test-subject-${userId}`)

    await app.request('/trpc/auth.completeProfile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        firstName: 'Ada',
        lastName: 'Lovelace',
        gender: 'other',
        country: 'GB',
        mobileNumber: '+44 20 7946 0958',
        stayAnonymous: true,
      }),
    })

    await db
      .updateTable('user_profiles')
      .set({ pii_ciphertext: 'not-a-real-vault-ciphertext' })
      .where('user_id', '=', userId)
      .execute()

    const res = await app.request('/trpc/auth.myProfile', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      result: { data: { hasLinkedIdentity: boolean; hasProfile: boolean; profile: unknown } }
    }
    expect(body.result.data).toEqual({ hasLinkedIdentity: true, hasProfile: true, profile: null })
  })

  test('requestDataExport inserts a pending row and publishes it, and getDataExportStatus reports it back to the same user only', async () => {
    const { cookie } = await mintBareUserCookie()

    const before = publishedMessages.length
    const requestRes = await app.request('/trpc/auth.requestDataExport', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({}),
    })
    expect(requestRes.status).toBe(200)

    expect(publishedMessages.length).toBe(before + 1)
    const published = publishedMessages[publishedMessages.length - 1]
    expect(published?.topic).toBe('data-export-requests')

    const statusRes = await app.request('/trpc/auth.getDataExportStatus', { headers: { cookie } })
    expect(statusRes.status).toBe(200)
    const statusBody = (await statusRes.json()) as {
      result: { data: { id: string; status: string }[] }
    }
    expect(statusBody.result.data).toHaveLength(1)
    expect(statusBody.result.data[0]?.status).toBe('pending')

    // A different user must never see this one's export request.
    const { cookie: otherCookie } = await mintBareUserCookie()
    const otherStatusRes = await app.request('/trpc/auth.getDataExportStatus', { headers: { cookie: otherCookie } })
    const otherStatusBody = (await otherStatusRes.json()) as { result: { data: unknown[] } }
    expect(otherStatusBody.result.data).toEqual([])

    const unauthed = await app.request('/trpc/auth.getDataExportStatus')
    expect(unauthed.status).toBe(401)
  })

  test('deleteAccount removes the user (cascading their profile) and clears the session cookie', async () => {
    const { cookie, userId } = await mintBareUserCookie()
    await linkIdentity(db, userId, 'google', `delete-test-subject-${userId}`)
    await app.request('/trpc/auth.completeProfile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        firstName: 'Delete',
        lastName: 'Me',
        gender: 'other',
        country: 'GB',
        mobileNumber: '+44 20 7946 0958',
        stayAnonymous: true,
      }),
    })

    const res = await app.request('/trpc/auth.deleteAccount', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)

    const clearedCookie = res.headers.getSetCookie().find((c) => c.startsWith('mc_session=') && c.includes('Max-Age=0'))
    expect(clearedCookie).toBeDefined()

    const remainingUser = await db.selectFrom('users').select('id').where('id', '=', userId).executeTakeFirst()
    expect(remainingUser).toBeUndefined()
    const remainingProfile = await db
      .selectFrom('user_profiles')
      .select('id')
      .where('user_id', '=', userId)
      .executeTakeFirst()
    expect(remainingProfile).toBeUndefined()

    // The now-deleted account's own cookie is dead — same as any session
    // for a user that no longer exists.
    const whoAmIAfter = await app.request('/trpc/auth.whoAmI', { headers: { cookie } })
    expect(whoAmIAfter.status).toBe(401)

    const unauthed = await app.request('/trpc/auth.deleteAccount', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(unauthed.status).toBe(401)
  })

  test('a banned account (banned_at set) is treated as unauthenticated on its very next request', async () => {
    const { cookie, userId } = await mintBareUserCookie()

    const stillActive = await app.request('/trpc/auth.whoAmI', { headers: { cookie } })
    expect(stillActive.status).toBe(200)

    await db.updateTable('users').set({ banned_at: new Date() }).where('id', '=', userId).execute()

    const afterBan = await app.request('/trpc/auth.whoAmI', { headers: { cookie } })
    expect(afterBan.status).toBe(401)
  })
})

describe('session-policy idle expiry', () => {
  async function userWithPolicy(maxIdleSeconds: number): Promise<{ userId: string }> {
    const user = await insertUser(db)
    const policy = await createSessionPolicy(db, { name: `test-policy-${crypto.randomUUID()}`, attributes: { maxIdleSeconds } })
    const role = await createRole(db, { name: `test-role-${crypto.randomUUID()}`, description: null })
    await setRoleSessionPolicy(db, role.id, policy.id)
    await assignRoleToUser(db, user.id, role.id)
    return { userId: user.id }
  }

  test('a token stale against the role-resolved duration is rejected, even though it would be fine against the platform default', async () => {
    const { userId } = await userWithPolicy(60)
    const cookie = `mc_session=${signTokenWithIssuedAt(userId, secondsAgo(120), AUTH_SECRET)}`

    const res = await app.request('/trpc/auth.whoAmI', { headers: { cookie } })
    expect(res.status).toBe(401)
  })

  test('the same token age is accepted once it is within the role-resolved duration', async () => {
    const { userId } = await userWithPolicy(60)
    const cookie = `mc_session=${signTokenWithIssuedAt(userId, secondsAgo(10), AUTH_SECRET)}`

    const res = await app.request('/trpc/auth.whoAmI', { headers: { cookie } })
    expect(res.status).toBe(200)
  })

  test('a user holding no duration-bearing role is unaffected (falls back to the platform default)', async () => {
    const { cookie } = await mintBareUserCookie()
    // Old relative to any short test policy, nowhere near the 180-day default.
    const user = await insertUser(db)
    const oldButWithinDefault = `mc_session=${signTokenWithIssuedAt(user.id, secondsAgo(60 * 60 * 24 * 30), AUTH_SECRET)}`

    const freshRes = await app.request('/trpc/auth.whoAmI', { headers: { cookie } })
    expect(freshRes.status).toBe(200)

    const oldRes = await app.request('/trpc/auth.whoAmI', { headers: { cookie: oldButWithinDefault } })
    expect(oldRes.status).toBe(200)
  })

  test('min-wins: holding a second, longer-duration role does not rescue a token stale against the shorter one', async () => {
    const user = await insertUser(db)

    const shortPolicy = await createSessionPolicy(db, { name: `short-${crypto.randomUUID()}`, attributes: { maxIdleSeconds: 60 } })
    const shortRole = await createRole(db, { name: `short-role-${crypto.randomUUID()}`, description: null })
    await setRoleSessionPolicy(db, shortRole.id, shortPolicy.id)
    await assignRoleToUser(db, user.id, shortRole.id)

    const longPolicy = await createSessionPolicy(db, {
      name: `long-${crypto.randomUUID()}`,
      attributes: { maxIdleSeconds: 60 * 60 * 24 }, // 1 day
    })
    const longRole = await createRole(db, { name: `long-role-${crypto.randomUUID()}`, description: null })
    await setRoleSessionPolicy(db, longRole.id, longPolicy.id)
    await assignRoleToUser(db, user.id, longRole.id)

    // Within the 1-day policy, but past the 60s one — the 60s policy must govern.
    const cookie = `mc_session=${signTokenWithIssuedAt(user.id, secondsAgo(90), AUTH_SECRET)}`
    const res = await app.request('/trpc/auth.whoAmI', { headers: { cookie } })
    expect(res.status).toBe(401)
  })

  test('sliding expiration: a fresh token is reissued once past half the resolved duration, keeping the request authenticated', async () => {
    const { userId } = await userWithPolicy(60)
    const originalToken = signTokenWithIssuedAt(userId, secondsAgo(35), AUTH_SECRET) // > 30s half-life, < 60s ceiling

    const res = await app.request('/trpc/auth.whoAmI', { headers: { cookie: `mc_session=${originalToken}` } })
    expect(res.status).toBe(200)

    const reissued = res.headers.getSetCookie().find((c) => c.startsWith('mc_session='))
    expect(reissued).toBeDefined()
    expect(reissued).not.toContain(originalToken)
  })

  test('rbac.sessionPolicies CRUD and rbac.roles.setSessionPolicy work end to end for an admin', async () => {
    const admin = await findRoleByName(db, 'ADMIN')
    if (!admin) throw new Error('seeded admin role not found — check migrations/0001_init.ts')

    // verifiedProcedure (which hasPermission builds on) requires a linked
    // Google identity AND a completed profile, not just a role — a bare
    // insertUser row 403s regardless of permissions. Same setup as
    // 'completeProfile persists the submitted profile...' above.
    const { cookie: adminCookie, userId } = await mintBareUserCookie()
    await linkIdentity(db, userId, 'google', `test-subject-${userId}`)
    const profileRes = await app.request('/trpc/auth.completeProfile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        firstName: 'Admin',
        lastName: 'Test',
        gender: 'other',
        country: 'GB',
        mobileNumber: '+44 20 7946 0958',
        stayAnonymous: true,
      }),
    })
    expect(profileRes.status).toBe(200)
    await assignRoleToUser(db, userId, admin.id)

    const createRes = await app.request('/trpc/rbac.sessionPolicies.create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: `e2e-policy-${crypto.randomUUID()}`, attributes: { maxIdleSeconds: 300 } }),
    })
    expect(createRes.status).toBe(200)
    const created = (await createRes.json()) as { result: { data: { id: string; name: string } } }
    expect(created.result.data.id).toBeDefined()

    const listRes = await app.request('/trpc/rbac.sessionPolicies.list', { headers: { cookie: adminCookie } })
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { result: { data: { id: string }[] } }
    expect(list.result.data.some((p) => p.id === created.result.data.id)).toBe(true)

    const testRole = await createRole(db, { name: `e2e-role-${crypto.randomUUID()}`, description: null })
    const setRes = await app.request('/trpc/rbac.roles.setSessionPolicy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ roleId: testRole.id, sessionPolicyId: created.result.data.id }),
    })
    expect(setRes.status).toBe(200)

    const rolesRes = await app.request('/trpc/rbac.roles.list', { headers: { cookie: adminCookie } })
    const roles = (await rolesRes.json()) as { result: { data: { id: string; sessionPolicyId: string | null }[] } }
    expect(roles.result.data.find((r) => r.id === testRole.id)?.sessionPolicyId).toBe(created.result.data.id)
  })
})

describe('session reports review (sessionReports.*)', () => {
  // Same admin setup as the rbac.sessionPolicies CRUD test above —
  // hasPermission builds on verifiedProcedure, which needs a linked
  // identity and a completed profile, not just the ADMIN role.
  async function adminCookie(): Promise<string> {
    const admin = await findRoleByName(db, 'ADMIN')
    if (!admin) throw new Error('seeded ADMIN role not found — check migrations/0001_init.ts')
    const { cookie, userId } = await mintBareUserCookie()
    await linkIdentity(db, userId, 'google', `test-subject-${userId}`)
    const profileRes = await app.request('/trpc/auth.completeProfile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        firstName: 'Admin',
        lastName: 'Test',
        gender: 'other',
        country: 'GB',
        mobileNumber: '+44 20 7946 0958',
        stayAnonymous: true,
      }),
    })
    expect(profileRes.status).toBe(200)
    await assignRoleToUser(db, userId, admin.id)
    return cookie
  }

  async function fileReport(body: string): Promise<{ sessionId: string; reporterId: string; aboutId: string }> {
    const session = await createSession(db)
    const reporter = await insertUser(db)
    const about = await insertUser(db)
    await insertSessionReport(db, { sessionId: session.id, reporterUserId: reporter.id, aboutUserIds: [about.id], body })
    return { sessionId: session.id, reporterId: reporter.id, aboutId: about.id }
  }

  type ReportRow = {
    id: string
    sessionId: string
    reporterUserId: string | null
    aboutUserIds: string[]
    body: string
    status: string
    reviewedBy: string | null
    decisionNote: string | null
  }

  async function listAll(cookie: string, status: 'open' | 'reviewed' | 'dismissed'): Promise<ReportRow[]> {
    const out: ReportRow[] = []
    let cursor: string | undefined
    do {
      const input = encodeURIComponent(JSON.stringify({ status, limit: 50, ...(cursor ? { cursor } : {}) }))
      const res = await app.request(`/trpc/sessionReports.list?input=${input}`, { headers: { cookie } })
      expect(res.status).toBe(200)
      const page = (await res.json()) as { result: { data: { reports: ReportRow[]; nextCursor: string | null } } }
      out.push(...page.result.data.reports)
      cursor = page.result.data.nextCursor ?? undefined
    } while (cursor)
    return out
  }

  test('a filed report shows up open with its session, reporter, subjects and body', async () => {
    const cookie = await adminCookie()
    const body = `e2e report ${crypto.randomUUID()}`
    const { sessionId, reporterId, aboutId } = await fileReport(body)

    const open = await listAll(cookie, 'open')
    const row = open.find((r) => r.body === body)
    expect(row).toBeDefined()
    expect(row).toMatchObject({ sessionId, reporterUserId: reporterId, aboutUserIds: [aboutId], status: 'open', reviewedBy: null })
  })

  test('reviewing moves a report from open to reviewed, attributed to the reviewer', async () => {
    const cookie = await adminCookie()
    const body = `e2e review ${crypto.randomUUID()}`
    await fileReport(body)
    const target = (await listAll(cookie, 'open')).find((r) => r.body === body)!

    const res = await app.request('/trpc/sessionReports.review', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ reportId: target.id, status: 'reviewed', note: 'Talked it through with both; resolved.' }),
    })
    expect(res.status).toBe(200)

    expect((await listAll(cookie, 'open')).some((r) => r.id === target.id)).toBe(false)
    const reviewed = (await listAll(cookie, 'reviewed')).find((r) => r.id === target.id)
    expect(reviewed?.status).toBe('reviewed')
    expect(reviewed?.reviewedBy).not.toBeNull()
    expect(reviewed?.decisionNote).toBe('Talked it through with both; resolved.')
  })

  test('a decided report cannot be decided again (409), and an unknown id is 404', async () => {
    const cookie = await adminCookie()
    const body = `e2e dismiss ${crypto.randomUUID()}`
    await fileReport(body)
    const target = (await listAll(cookie, 'open')).find((r) => r.body === body)!

    const first = await app.request('/trpc/sessionReports.review', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ reportId: target.id, status: 'dismissed', note: 'No grounds.' }),
    })
    expect(first.status).toBe(200)

    const again = await app.request('/trpc/sessionReports.review', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ reportId: target.id, status: 'reviewed', note: 'Second thoughts.' }),
    })
    expect(again.status).toBe(409)

    const missing = await app.request('/trpc/sessionReports.review', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ reportId: crypto.randomUUID(), status: 'reviewed', note: 'x' }),
    })
    expect(missing.status).toBe(404)
  })

  test('a decision without a note is rejected by input validation', async () => {
    const cookie = await adminCookie()
    const body = `e2e no-note ${crypto.randomUUID()}`
    await fileReport(body)
    const target = (await listAll(cookie, 'open')).find((r) => r.body === body)!

    const res = await app.request('/trpc/sessionReports.review', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ reportId: target.id, status: 'reviewed', note: '   ' }),
    })
    expect(res.status).toBe(400)
    expect((await listAll(cookie, 'open')).some((r) => r.id === target.id)).toBe(true)
  })

  test('the transcript opens around the report and pages both ways with the circle-style roster', async () => {
    const cookie = await adminCookie()
    const session = await createSession(db)
    const reporter = await insertUser(db)
    const about = await insertUser(db)
    await joinSession(db, session.id, reporter.id)
    await joinSession(db, session.id, about.id)

    // Rows default to now() per statement; a short pause between the
    // phases keeps "before", the report, and "after" in unambiguous
    // order on a fast machine.
    const pause = () => new Promise((resolve) => setTimeout(resolve, 5))
    for (let i = 0; i < 4; i++) await insertMessage(db, { sessionId: session.id, userId: about.id, body: `before ${i}` })
    await pause()
    await insertSessionReport(db, { sessionId: session.id, reporterUserId: reporter.id, aboutUserIds: [about.id], body: 'e2e transcript' })
    await pause()
    const report = (await listAll(cookie, 'open')).find((r) => r.sessionId === session.id)!
    for (let i = 0; i < 4; i++) await insertMessage(db, { sessionId: session.id, userId: reporter.id, body: `after ${i}` })

    type Transcript = {
      messages: { id: string; body: string; userId: string }[]
      olderCursor: string | null
      newerCursor: string | null
      roster: { userId: string; turnOrder: number; displayName: string | null }[]
      reportedAt: string
      aboutUserIds: string[]
    }
    const fetchWindow = async (input: Record<string, unknown>): Promise<Transcript> => {
      const res = await app.request(`/trpc/sessionReports.transcript?input=${encodeURIComponent(JSON.stringify(input))}`, { headers: { cookie } })
      expect(res.status).toBe(200)
      return ((await res.json()) as { result: { data: Transcript } }).result.data
    }

    // Two before + two after around the report, cursors pointing both ways.
    const around = await fetchWindow({ reportId: report.id, direction: 'around', limit: 2 })
    expect(around.messages.map((m) => m.body)).toEqual(['before 2', 'before 3', 'after 0', 'after 1'])
    expect(around.olderCursor).not.toBeNull()
    expect(around.newerCursor).not.toBeNull()
    expect(around.aboutUserIds).toEqual([about.id])
    // Roster is the circle's own view: turn order, anonymous (null) names
    // for these bare test users — never an email or decrypted identity.
    expect(around.roster.map((r) => r.userId).sort()).toEqual([reporter.id, about.id].sort())
    expect(around.roster.every((r) => r.displayName === null)).toBe(true)
    expect(Object.keys(around.roster[0]!).sort()).toEqual(['displayName', 'turnOrder', 'userId'])

    // Scrolling up reaches the start; scrolling down reaches the end.
    const older = await fetchWindow({ reportId: report.id, direction: 'before', cursor: around.olderCursor, limit: 10 })
    expect(older.messages.map((m) => m.body)).toEqual(['before 0', 'before 1'])
    expect(older.olderCursor).toBeNull()
    const newer = await fetchWindow({ reportId: report.id, direction: 'after', cursor: around.newerCursor, limit: 10 })
    expect(newer.messages.map((m) => m.body)).toEqual(['after 2', 'after 3'])
    expect(newer.newerCursor).toBeNull()

    const missing = await app.request(
      `/trpc/sessionReports.transcript?input=${encodeURIComponent(JSON.stringify({ reportId: crypto.randomUUID() }))}`,
      { headers: { cookie } },
    )
    expect(missing.status).toBe(404)
  })

  test('pages through open reports with the cursor', async () => {
    const cookie = await adminCookie()
    const marker = crypto.randomUUID()
    for (let i = 0; i < 3; i++) await fileReport(`e2e page ${marker} ${i}`)

    const seen = new Set<string>()
    let cursor: string | undefined
    let pages = 0
    do {
      const input = encodeURIComponent(JSON.stringify({ status: 'open', limit: 1, ...(cursor ? { cursor } : {}) }))
      const res = await app.request(`/trpc/sessionReports.list?input=${input}`, { headers: { cookie } })
      const page = (await res.json()) as { result: { data: { reports: ReportRow[]; nextCursor: string | null } } }
      for (const r of page.result.data.reports) {
        expect(seen.has(r.id)).toBe(false)
        seen.add(r.id)
      }
      cursor = page.result.data.nextCursor ?? undefined
      pages++
    } while (cursor && pages < 200)

    const mine = [...seen].length
    expect(mine).toBeGreaterThanOrEqual(3)
  })

  test('a verified user without the permission is forbidden', async () => {
    const { cookie, userId } = await mintBareUserCookie()
    await linkIdentity(db, userId, 'google', `test-subject-${userId}`)
    await app.request('/trpc/auth.completeProfile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ firstName: 'No', lastName: 'Perms', gender: 'other', country: 'GB', mobileNumber: '+44 20 7946 0958', stayAnonymous: true }),
    })
    const input = encodeURIComponent(JSON.stringify({ status: 'open', limit: 10 }))
    const res = await app.request(`/trpc/sessionReports.list?input=${input}`, { headers: { cookie } })
    expect(res.status).toBe(403)
  })
})

describe('reports that name messages', () => {
  async function verifiedMember(sessionId: string): Promise<{ cookie: string; userId: string }> {
    const { cookie, userId } = await mintBareUserCookie()
    await linkIdentity(db, userId, 'google', `test-subject-${userId}`)
    const profileRes = await app.request('/trpc/auth.completeProfile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ firstName: 'Member', lastName: 'Test', gender: 'other', country: 'GB', mobileNumber: '+44 20 7946 0958', stayAnonymous: true }),
    })
    expect(profileRes.status).toBe(200)
    await joinSession(db, sessionId, userId)
    return { cookie, userId }
  }

  test('session.report folds the authors of named messages into the subjects and stores the ids', async () => {
    const session = await createSession(db)
    const reporter = await verifiedMember(session.id)
    const alice = await insertUser(db)
    const bob = await insertUser(db)
    await joinSession(db, session.id, alice.id)
    await joinSession(db, session.id, bob.id)
    const aliceMessage = await insertMessage(db, { sessionId: session.id, userId: alice.id, body: 'something hurtful' })
    const bobMessage = await insertMessage(db, { sessionId: session.id, userId: bob.id, body: 'piling on' })

    // Picks only Alice as a subject but points at one of Bob's messages too.
    const res = await app.request('/trpc/session.report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: reporter.cookie },
      body: JSON.stringify({ sessionId: session.id, aboutUserIds: [alice.id], messageIds: [aliceMessage.id, bobMessage.id], body: 'e2e message report' }),
    })
    expect(res.status).toBe(200)

    const stored = await db.selectFrom('session_reports').select(['about_user_ids', 'message_ids']).where('session_id', '=', session.id).executeTakeFirstOrThrow()
    expect([...stored.about_user_ids].sort()).toEqual([alice.id, bob.id].sort())
    expect([...stored.message_ids].sort()).toEqual([aliceMessage.id, bobMessage.id].sort())
  })

  test('session.report refuses a message from another circle, and a report naming nothing at all', async () => {
    const session = await createSession(db)
    const other = await createSession(db)
    const reporter = await verifiedMember(session.id)
    const stranger = await insertUser(db)
    await joinSession(db, other.id, stranger.id)
    const elsewhere = await insertMessage(db, { sessionId: other.id, userId: stranger.id, body: 'not in your circle' })

    const foreign = await app.request('/trpc/session.report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: reporter.cookie },
      body: JSON.stringify({ sessionId: session.id, messageIds: [elsewhere.id], body: 'x' }),
    })
    expect(foreign.status).toBe(403)

    const empty = await app.request('/trpc/session.report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: reporter.cookie },
      body: JSON.stringify({ sessionId: session.id, body: 'x' }),
    })
    expect(empty.status).toBe(400)
  })

  test('the moderator transcript still opens on the filing moment, and returns the named ids', async () => {
    const admin = await findRoleByName(db, 'ADMIN')
    if (!admin) throw new Error('seeded ADMIN role not found')
    const session = await createSession(db)
    const moderator = await verifiedMember(session.id)
    await assignRoleToUser(db, moderator.userId, admin.id)
    const alice = await insertUser(db)
    await joinSession(db, session.id, alice.id)

    const pause = () => new Promise((resolve) => setTimeout(resolve, 5))
    const early = await insertMessage(db, { sessionId: session.id, userId: alice.id, body: 'early' })
    await pause()
    const named = await insertMessage(db, { sessionId: session.id, userId: alice.id, body: 'the one reported' })
    await pause()
    await insertMessage(db, { sessionId: session.id, userId: alice.id, body: 'later' })
    await pause()
    await insertSessionReport(db, { sessionId: session.id, reporterUserId: moderator.userId, aboutUserIds: [alice.id], messageIds: [named.id], body: 'e2e anchored' })
    // Looked up directly, not by paging the whole open queue — on a test
    // schema that has accumulated many runs, a single page wouldn't
    // reliably contain it (ARCHITECTURE.md: tests must survive re-runs).
    const report = await db.selectFrom('session_reports').select(['id', 'message_ids']).where('session_id', '=', session.id).executeTakeFirstOrThrow()
    expect(report.message_ids).toEqual([named.id])

    // The window is around the filing moment (after every message here),
    // so with one each side only the newest message appears, on the
    // "before" side — the named message is further up, reached by paging.
    const res = await app.request(
      `/trpc/sessionReports.transcript?input=${encodeURIComponent(JSON.stringify({ reportId: report.id, direction: 'around', limit: 1 }))}`,
      { headers: { cookie: moderator.cookie } },
    )
    expect(res.status).toBe(200)
    const transcript = (await res.json()) as { result: { data: { messages: { id: string; body: string }[]; messageIds: string[]; olderCursor: string | null; newerCursor: string | null } } }
    expect(transcript.result.data.messages.map((m) => m.body)).toEqual(['later'])
    expect(transcript.result.data.messageIds).toEqual([named.id])
    expect(transcript.result.data.olderCursor).not.toBeNull()
    expect(transcript.result.data.newerCursor).toBeNull()
    expect(early.id).toBeDefined()
  })
})

describe('session report actions', () => {
  async function verifiedUser(extraRoleName?: string): Promise<{ cookie: string; userId: string }> {
    const { cookie, userId } = await mintBareUserCookie()
    await linkIdentity(db, userId, 'google', `test-subject-${userId}`)
    const profileRes = await app.request('/trpc/auth.completeProfile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ firstName: 'Mod', lastName: 'Test', gender: 'other', country: 'GB', mobileNumber: '+44 20 7946 0958', stayAnonymous: true }),
    })
    expect(profileRes.status).toBe(200)
    if (extraRoleName) {
      const role = await findRoleByName(db, extraRoleName)
      if (!role) throw new Error(`seeded ${extraRoleName} role not found`)
      await assignRoleToUser(db, userId, role.id)
    }
    return { cookie, userId }
  }

  async function reportedScenario() {
    const session = await createSession(db)
    const reporter = await insertUser(db)
    const alice = await insertUser(db)
    await linkIdentity(db, alice.id, 'google', `test-subject-${alice.id}`)
    await joinSession(db, session.id, reporter.id)
    await joinSession(db, session.id, alice.id)
    const message = await insertMessage(db, { sessionId: session.id, userId: alice.id, body: 'reported text' })
    await insertSessionReport(db, { sessionId: session.id, reporterUserId: reporter.id, aboutUserIds: [alice.id], messageIds: [message.id], body: 'e2e action' })
    const report = await db.selectFrom('session_reports').select('id').where('session_id', '=', session.id).executeTakeFirstOrThrow()
    return { session, reporter, alice, message, reportId: report.id }
  }

  const review = (cookie: string, body: Record<string, unknown>) =>
    app.request('/trpc/sessionReports.review', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) })

  test("note: lands in the member's history, readable via rbac.users.listNotes", async () => {
    const mod = await verifiedUser('MODERATOR')
    const { alice, reportId } = await reportedScenario()
    const res = await review(mod.cookie, { reportId, status: 'reviewed', note: 'Pattern worth watching.', outcomes: [{ action: 'note', targetUserIds: [alice.id] }] })
    expect(res.status).toBe(200)

    const admin = await verifiedUser('ADMIN')
    const notesRes = await app.request(`/trpc/rbac.users.listNotes?input=${encodeURIComponent(JSON.stringify({ userId: alice.id }))}`, { headers: { cookie: admin.cookie } })
    expect(notesRes.status).toBe(200)
    const notes = (await notesRes.json()) as { result: { data: { body: string; reportId: string | null; createdBy: string | null }[] } }
    expect(notes.result.data).toHaveLength(1)
    expect(notes.result.data[0]).toMatchObject({ body: 'Pattern worth watching.', reportId, createdBy: mod.userId })

    const stored = await db.selectFrom('session_report_actions').select(['action', 'target_user_ids']).where('report_id', '=', reportId).execute()
    expect(stored).toEqual([{ action: 'note', target_user_ids: [alice.id] }])
  })

  test('remove_from_session: the member stops being a member of that circle', async () => {
    const mod = await verifiedUser('MODERATOR')
    const { session, alice, reportId } = await reportedScenario()
    const res = await review(mod.cookie, { reportId, status: 'reviewed', note: 'Out of this circle.', outcomes: [{ action: 'remove_from_session', targetUserIds: [alice.id] }] })
    expect(res.status).toBe(200)
    const row = await db.selectFrom('session_users').select('left_at').where('session_id', '=', session.id).where('user_id', '=', alice.id).executeTakeFirstOrThrow()
    expect(row.left_at).not.toBeNull()
  })

  test('a removed member who comes back is refused with a fixed FORBIDDEN message, not re-joined', async () => {
    const mod = await verifiedUser('MODERATOR')
    const session = await createSession(db)
    const member = await verifiedUser()
    const reporter = await insertUser(db)
    await joinSession(db, session.id, reporter.id)
    await joinSession(db, session.id, member.userId)
    await insertSessionReport(db, { sessionId: session.id, reporterUserId: reporter.id, aboutUserIds: [member.userId], messageIds: [], body: 'e2e removal' })
    const report = await db.selectFrom('session_reports').select('id').where('session_id', '=', session.id).executeTakeFirstOrThrow()
    expect((await review(mod.cookie, { reportId: report.id, status: 'reviewed', note: 'Removed.', outcomes: [{ action: 'remove_from_session', targetUserIds: [member.userId] }] })).status).toBe(200)

    const visit = await app.request('/trpc/session.visit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: member.cookie },
      body: JSON.stringify({ sessionId: session.id }),
    })
    expect(visit.status).toBe(403)
    const body = (await visit.json()) as { error: { message: string } }
    expect(body.error.message).toBe('removed_from_session')
    const row = await db.selectFrom('session_users').select('left_at').where('session_id', '=', session.id).where('user_id', '=', member.userId).executeTakeFirstOrThrow()
    expect(row.left_at).not.toBeNull()
  })

  test('hide_messages: the named messages become removed, and the author still sees them as such', async () => {
    const mod = await verifiedUser('MODERATOR')
    const { session, alice, message, reportId } = await reportedScenario()
    const res = await review(mod.cookie, { reportId, status: 'reviewed', note: 'Took it down.', outcomes: [{ action: 'hide_messages' }] })
    expect(res.status).toBe(200)
    const row = await db.selectFrom('messages').select(['moderation_status', 'removed_by']).where('id', '=', message.id).executeTakeFirstOrThrow()
    expect(row.moderation_status).toBe('removed')
    expect(row.removed_by).toBe(mod.userId)

    // Another member's read of the circle no longer includes it; the
    // author's does (the same WHERE rule as flag/crisis).
    const others = await listMessagesRepo(db, { sessionId: session.id, limit: 50, requestingUserId: mod.userId })
    expect(others.messages.some((m) => m.id === message.id)).toBe(false)
    const own = await listMessagesRepo(db, { sessionId: session.id, limit: 50, requestingUserId: alice.id })
    expect(own.messages.find((m) => m.id === message.id)?.moderationStatus).toBe('removed')
  })

  test('warn: needs member text, then records the decision (delivery is the logging stand-in)', async () => {
    const mod = await verifiedUser('MODERATOR')
    const { alice, reportId } = await reportedScenario()
    const missing = await review(mod.cookie, { reportId, status: 'reviewed', note: 'Warned.', outcomes: [{ action: 'warn', targetUserIds: [alice.id] }] })
    expect(missing.status).toBe(400)
    const res = await review(mod.cookie, { reportId, status: 'reviewed', note: 'Warned.', outcomes: [{ action: 'warn', targetUserIds: [alice.id], memberMessage: 'Please keep it kind.' }] })
    expect(res.status).toBe(200)
    const stored = await db.selectFrom('session_report_actions').select(['action', 'member_message']).where('report_id', '=', reportId).execute()
    expect(stored).toEqual([{ action: 'warn', member_message: 'Please keep it kind.' }])
  })

  test('ban: refused without users.ban; with it, records the identity ban with evidence and blocks the account', async () => {
    const { alice, message, reportId } = await reportedScenario()

    const mod = await verifiedUser('MODERATOR')
    const forbidden = await review(mod.cookie, { reportId, status: 'reviewed', note: 'Ban.', outcomes: [{ action: 'ban', targetUserIds: [alice.id], banReasonCategory: 'harassment' }] })
    expect(forbidden.status).toBe(403)

    const lead = await verifiedUser('TRUST-SAFETY-LEAD')
    const res = await review(lead.cookie, { reportId, status: 'reviewed', note: 'Repeated harassment, see messages.', outcomes: [{ action: 'ban', targetUserIds: [alice.id], banReasonCategory: 'harassment' }] })
    expect(res.status).toBe(200)

    const ban = await db.selectFrom('account_bans').selectAll().where('user_id_at_ban_time', '=', alice.id).executeTakeFirstOrThrow()
    expect(ban.provider).toBe('google')
    expect(ban.identity_hash).toBe(`test-subject-${alice.id}`)
    expect(ban.reason_category).toBe('harassment')
    expect(ban.banned_by).toBe(lead.userId)
    const evidence = await db.selectFrom('account_ban_evidence').select(['evidence_type', 'snapshot']).where('ban_id', '=', ban.id).execute()
    expect(evidence.map((e) => e.evidence_type).sort()).toEqual(['message', 'operator_note'])
    expect(evidence.find((e) => e.evidence_type === 'message')?.snapshot).toMatchObject({ messageId: message.id, body: 'reported text' })

    const user = await db.selectFrom('users').select('banned_at').where('id', '=', alice.id).executeTakeFirstOrThrow()
    expect(user.banned_at).not.toBeNull()
  })

  test('one decision, different outcomes per member: warn one and ban another', async () => {
    const lead = await verifiedUser('TRUST-SAFETY-LEAD')
    const session = await createSession(db)
    const reporter = await insertUser(db)
    const alice = await insertUser(db)
    const bob = await insertUser(db)
    await linkIdentity(db, bob.id, 'google', `test-subject-${bob.id}`)
    for (const u of [reporter, alice, bob]) await joinSession(db, session.id, u.id)
    await insertSessionReport(db, { sessionId: session.id, reporterUserId: reporter.id, aboutUserIds: [alice.id, bob.id], messageIds: [], body: 'two of them' })
    const report = await db.selectFrom('session_reports').select('id').where('session_id', '=', session.id).executeTakeFirstOrThrow()

    const res = await review(lead.cookie, {
      reportId: report.id,
      status: 'reviewed',
      note: 'Alice was provoked; Bob started it and kept going.',
      outcomes: [
        { action: 'warn', targetUserIds: [alice.id], memberMessage: 'Please step back next time.' },
        { action: 'ban', targetUserIds: [bob.id], banReasonCategory: 'harassment' },
      ],
    })
    expect(res.status).toBe(200)

    const stored = await db.selectFrom('session_report_actions').select(['action', 'target_user_ids']).where('report_id', '=', report.id).orderBy('position').execute()
    expect(stored.map((r) => [r.action, r.target_user_ids])).toEqual([
      ['warn', [alice.id]],
      ['ban', [bob.id]],
    ])
    expect((await db.selectFrom('users').select('banned_at').where('id', '=', alice.id).executeTakeFirstOrThrow()).banned_at).toBeNull()
    expect((await db.selectFrom('users').select('banned_at').where('id', '=', bob.id).executeTakeFirstOrThrow()).banned_at).not.toBeNull()

    const one = await app.request(`/trpc/sessionReports.get?input=${encodeURIComponent(JSON.stringify({ reportId: report.id }))}`, { headers: { cookie: lead.cookie } })
    const got = (await one.json()) as { result: { data: { outcomes: { action: string; targetUserIds: string[] }[] } } }
    expect(got.result.data.outcomes.map((o) => o.action)).toEqual(['warn', 'ban'])
  })

  test('an action on someone the report is not about is rejected', async () => {
    const mod = await verifiedUser('MODERATOR')
    const { reportId } = await reportedScenario()
    const stranger = await insertUser(db)
    const res = await review(mod.cookie, { reportId, status: 'reviewed', note: 'x', outcomes: [{ action: 'note', targetUserIds: [stranger.id] }] })
    expect(res.status).toBe(400)
  })
})

describe('session report history and labels', () => {
  async function verifiedUser(roleName: string): Promise<{ cookie: string; userId: string }> {
    const { cookie, userId } = await mintBareUserCookie()
    await linkIdentity(db, userId, 'google', `test-subject-${userId}`)
    const profileRes = await app.request('/trpc/auth.completeProfile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ firstName: 'Mod', lastName: 'Test', gender: 'other', country: 'GB', mobileNumber: '+44 20 7946 0958', stayAnonymous: true }),
    })
    expect(profileRes.status).toBe(200)
    const role = await findRoleByName(db, roleName)
    if (!role) throw new Error(`seeded ${roleName} role not found`)
    await assignRoleToUser(db, userId, role.id)
    return { cookie, userId }
  }

  test('a decision note shows up in the next report\'s history for the same member, with who wrote it', async () => {
    const mod = await verifiedUser('MODERATOR')
    const alice = await insertUser(db)
    const reporter = await insertUser(db)

    // First report: decided with a note on Alice.
    const first = await createSession(db)
    await joinSession(db, first.id, reporter.id)
    await joinSession(db, first.id, alice.id)
    await insertSessionReport(db, { sessionId: first.id, reporterUserId: reporter.id, aboutUserIds: [alice.id], messageIds: [], body: 'first time' })
    const firstReport = await db.selectFrom('session_reports').select('id').where('session_id', '=', first.id).executeTakeFirstOrThrow()
    const decide = await app.request('/trpc/sessionReports.review', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: mod.cookie },
      body: JSON.stringify({ reportId: firstReport.id, status: 'reviewed', note: 'Borderline — watch for a repeat.', outcomes: [{ action: 'note', targetUserIds: [alice.id] }] }),
    })
    expect(decide.status).toBe(200)

    // Second report about Alice: its history carries the note and the prior report.
    const second = await createSession(db)
    await joinSession(db, second.id, reporter.id)
    await joinSession(db, second.id, alice.id)
    await insertSessionReport(db, { sessionId: second.id, reporterUserId: reporter.id, aboutUserIds: [alice.id], messageIds: [], body: 'again' })
    const secondReport = await db.selectFrom('session_reports').select('id').where('session_id', '=', second.id).executeTakeFirstOrThrow()

    const res = await app.request(`/trpc/sessionReports.subjectHistory?input=${encodeURIComponent(JSON.stringify({ reportId: secondReport.id }))}`, { headers: { cookie: mod.cookie } })
    expect(res.status).toBe(200)
    const history = (await res.json()) as {
      result: { data: { subjects: { userId: string; notes: { body: string; createdByLabel: string | null; reportId: string | null }[]; priorReports: { id: string; outcomes: { action: string; appliedToThisMember: boolean }[]; reviewedByLabel: string | null }[] }[] } }
    }
    const subject = history.result.data.subjects.find((s) => s.userId === alice.id)!
    expect(subject.notes).toHaveLength(1)
    expect(subject.notes[0]).toMatchObject({ body: 'Borderline — watch for a repeat.', reportId: firstReport.id })
    // Bare test users carry no email, so the label is null here; the shape is what matters.
    expect(subject.notes[0]!.createdByLabel).toBeNull()
    expect(subject.priorReports.map((r) => r.id)).toEqual([firstReport.id])
    expect(subject.priorReports[0]!.outcomes).toEqual([{ action: 'note', appliedToThisMember: true }])

    // The report itself can be fetched by id, decided fields included.
    const one = await app.request(`/trpc/sessionReports.get?input=${encodeURIComponent(JSON.stringify({ reportId: firstReport.id }))}`, { headers: { cookie: mod.cookie } })
    expect(one.status).toBe(200)
    const got = (await one.json()) as { result: { data: { id: string; status: string; decisionNote: string | null; reviewedBy: string | null } } }
    expect(got.result.data).toMatchObject({ id: firstReport.id, status: 'reviewed', decisionNote: 'Borderline — watch for a repeat.', reviewedBy: mod.userId })

    const missing = await app.request(`/trpc/sessionReports.get?input=${encodeURIComponent(JSON.stringify({ reportId: crypto.randomUUID() }))}`, { headers: { cookie: mod.cookie } })
    expect(missing.status).toBe(404)
  })
})

describe('users.read_pii', () => {
  const TEST_VAULT = {
    provider: 'vault' as const,
    vaultAddr: process.env.TEST_VAULT_ADDR ?? 'http://localhost:8200',
    vaultToken: process.env.TEST_VAULT_TOKEN ?? 'dev-only-not-for-production',
  }

  async function verifiedUser(roleName: string): Promise<{ cookie: string; userId: string }> {
    const { cookie, userId } = await mintBareUserCookie()
    await linkIdentity(db, userId, 'google', `test-subject-${userId}`)
    const profileRes = await app.request('/trpc/auth.completeProfile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ firstName: 'Mod', lastName: 'Test', gender: 'other', country: 'GB', mobileNumber: '+44 20 7946 0958', stayAnonymous: true }),
    })
    expect(profileRes.status).toBe(200)
    const role = await findRoleByName(db, roleName)
    if (!role) throw new Error(`seeded ${roleName} role not found`)
    await assignRoleToUser(db, userId, role.id)
    return { cookie, userId }
  }

  test('the full email comes back only to a role holding users.read_pii; everyone else gets the mask', async () => {
    const member = await insertUser(db)
    const address = `pii-${member.id}@example.com`
    await setEmail(db, member.id, await encryptField(TEST_VAULT, address))

    type Row = { id: string; email: string | null; emailMasked: string | null }
    const listFor = async (cookie: string): Promise<Row | undefined> => {
      const res = await app.request(`/trpc/rbac.users.list?input=${encodeURIComponent(JSON.stringify({ limit: 50 }))}`, { headers: { cookie } })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { result: { data: { users: Row[] } } }
      return body.result.data.users.find((u) => u.id === member.id)
    }

    // AUDITOR reads users but was not granted users.read_pii.
    const auditor = await verifiedUser('AUDITOR')
    const masked = await listFor(auditor.cookie)
    expect(masked?.emailMasked).toBe(`p***@example.com`)
    expect(masked?.email).toBeNull()

    const admin = await verifiedUser('ADMIN')
    const unmasked = await listFor(admin.cookie)
    expect(unmasked?.email).toBe(address)
    expect(unmasked?.emailMasked).toBe(`p***@example.com`)
  })
})

describe('/health', () => {
  test('reports each dependency check', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)

    const body = (await res.json()) as { service: string; postgres: string }
    expect(body.service).toBe('trpc-api')
    expect(body.postgres).toBe('ok')
  })
})
