import { afterAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, createSessionToken, runMigrations } from '@mincirklen/shared'
import { createApp } from './app'
import { insertUser } from './repositories/userRepository'
import { linkIdentity } from './repositories/userIdentityRepository'

const pool = createPgPool(
  process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL,
  'test',
)
const db = createDb(pool)

await runMigrations(db, 'test')

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

describe('/health', () => {
  test('reports each dependency check', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)

    const body = (await res.json()) as { service: string; postgres: string }
    expect(body.service).toBe('trpc-api')
    expect(body.postgres).toBe('ok')
  })
})
