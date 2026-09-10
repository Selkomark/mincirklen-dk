import * as http from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, createSessionToken, runMigrations } from '@mincirklen/shared'
import { sql } from 'kysely'
import { Code, ConnectError, type ConnectRouter } from '@connectrpc/connect'
import { connectNodeAdapter } from '@connectrpc/connect-node'
import { InternalService, ModerationService } from '@mincirklen/proto'
import { createApp } from './app'
import { insertUser } from './repositories/userRepository'
import { linkIdentity } from './repositories/userIdentityRepository'
import { upsertUserProfile } from './repositories/userProfileRepository'

const pool = createPgPool(
  process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL,
  'test',
)
const db = createDb(pool)
const VAULT = {
  provider: 'vault' as const,
  vaultAddr: process.env.TEST_VAULT_ADDR ?? 'http://localhost:8200',
  vaultToken: process.env.TEST_VAULT_TOKEN ?? 'dev-only-not-for-production',
}
const INTERNAL_SERVICE_SECRET = 'session-integration-test-internal-secret'
const AUTH_SECRET = 'session-integration-test-secret'

let fakeModerationService: http.Server
let fakeModerationServicePort: number
let fakeWebsocketService: http.Server
let fakeWebsocketServicePort: number
let app: ReturnType<typeof createApp>

// Captured requests to the fake websocket-service's publish route — reset
// between tests so one test's fanout can't be mistaken for another's.
let publishedRequests: { sessionId: string; secretHeader: string | null; body: unknown }[] = []

// Captured calls to the fake websocket-service's roster/join route —
// used to prove join/visit only fan out a live "joined" notification for
// a genuinely new member, never for a revisit (see sessionRouter.ts's
// isNewJoin check).
let joinNotifications: { sessionId: string; userId: string }[] = []

// In-memory turn/roster state for the fake websocket-service — see the
// route handlers below. Reset between tests for the same reason as
// publishedRequests.
interface FakeTurnState {
  currentTurnUserId: string | null
  turnClaimedAt: number | null
  roster: { userId: string; turnOrder: number }[]
}
let fakeTurnStates = new Map<string, FakeTurnState>()

afterEach(() => {
  publishedRequests = []
  joinNotifications = []
  fakeTurnStates = new Map()
})

// Seeds from Postgres exactly once per session (mirrors
// websocket-service's own seed-on-first-touch behavior) — null means the
// session doesn't exist in Postgres either.
async function seedFakeTurnStateIfMissing(sessionId: string): Promise<FakeTurnState | null> {
  const existing = fakeTurnStates.get(sessionId)
  if (existing) return existing

  const session = await db.selectFrom('sessions').select('current_turn_user_id').where('id', '=', sessionId).executeTakeFirst()
  if (!session) return null

  const rows = await db
    .selectFrom('session_users')
    .select(['user_id', 'turn_order'])
    .where('session_id', '=', sessionId)
    .orderBy('turn_order', 'asc')
    .execute()
  const roster = rows.filter((r) => r.turn_order !== null).map((r) => ({ userId: r.user_id, turnOrder: r.turn_order as number }))

  const state: FakeTurnState = { currentTurnUserId: session.current_turn_user_id, turnClaimedAt: null, roster }
  fakeTurnStates.set(sessionId, state)
  return state
}

// sendMessage's publish to websocket-service is deliberately fire-and-forget
// (see websocketServiceAdapter.ts's publishMessage comment) — it isn't
// awaited into the sendMessage response, so a test asserting on it has to
// poll briefly rather than assume it's already landed the instant the
// response comes back.
async function waitForPublish(count: number): Promise<void> {
  for (let i = 0; i < 50 && publishedRequests.length < count; i++) {
    await new Promise((r) => setTimeout(r, 10))
  }
}

// notifyJoinedFireAndForget (sessionRouter.ts) is, as the name says,
// fire-and-forget — a join/visit call can return before its own
// notification has actually landed on the fake websocket-service. Same
// rationale as waitForPublish above.
async function waitForJoinNotification(count: number): Promise<void> {
  for (let i = 0; i < 50 && joinNotifications.length < count; i++) {
    await new Promise((r) => setTimeout(r, 10))
  }
}

beforeAll(async () => {
  await runMigrations(db, 'test')

  // The real moderation-service is intentionally not published to the host
  // (see docs/local_dev.md), and it only ever returns 'pass' anyway — this
  // in-process fake stands in for it so classifyMessage's real Connect RPC
  // round trip is still exercised, without touching docker-compose port
  // publishing. Body-triggered classification, mirroring the real
  // moderation-service's request/response contract exactly (unlike the
  // real stub, this fake can return flag/crisis too — real moderation
  // logic is proprietary and permanently a "pass"-only stub, so this is
  // the only way to exercise sessionRouter's flag/crisis wiring against a
  // real Connect round trip rather than only via messageService's mocked
  // unit tests).
  const moderationHandler = connectNodeAdapter({
    routes: (router: ConnectRouter) =>
      router.service(ModerationService, {
        async classify(req) {
          const result = req.message === 'FLAG_ME' ? 'flag' : req.message === 'CRISIS_ME' ? 'crisis' : 'pass'
          return { result }
        },
      }),
  })
  fakeModerationService = http.createServer(moderationHandler)
  fakeModerationServicePort = await new Promise<number>((resolve) => {
    fakeModerationService.listen(0, '127.0.0.1', () => {
      resolve((fakeModerationService.address() as { port: number }).port)
    })
  })

  // Stands in for websocket-service's whole InternalService RPC surface —
  // exercises sessionRouter.ts's real Connect calls
  // (websocketServiceAdapter.ts) rather than mocking them away, same
  // rationale as fakeModerationService above. The turn/roster methods are
  // a minimal in-memory simulation, not a reimplementation of the real
  // Redis/Lua compare-and-swap logic — that's exhaustively covered in
  // websocket-service's own suite (redisTurnStateAdapter.integration.test.ts,
  // rpcServer.integration.test.ts). This only needs to behave correctly
  // enough for trpc-api's own wiring to be exercised end to end.
  const rpcHandler = connectNodeAdapter({
    routes: (router: ConnectRouter) =>
      router.service(InternalService, {
        async publishMessage(req, context) {
          publishedRequests.push({
            sessionId: req.sessionId,
            secretHeader: context.requestHeader.get('x-internal-secret'),
            body: { id: req.messageId, sessionId: req.sessionId, userId: req.userId, body: req.body, type: req.type, createdAt: req.createdAt },
          })
          return {}
        },

        async getTurnState(req) {
          const state = await seedFakeTurnStateIfMissing(req.sessionId)
          if (!state) throw new ConnectError('not found', Code.NotFound)
          // This fake never simulates live presence (that's exhaustively
          // covered in websocket-service's own suite — see this block's
          // doc comment) — always empty, never omitted, so trpc-api's own
          // wiring for the field is still exercised end to end.
          return { currentTurnUserId: state.currentTurnUserId ?? '', roster: state.roster, onlineUserIds: [] }
        },

        async joinRoster(req) {
          joinNotifications.push({ sessionId: req.sessionId, userId: req.userId })
          const state = await seedFakeTurnStateIfMissing(req.sessionId)
          if (!state) throw new ConnectError('not found', Code.NotFound)
          if (!state.roster.some((r) => r.userId === req.userId)) {
            state.roster.push({ userId: req.userId, turnOrder: req.turnOrder })
          }
          return {}
        },

        async notifyProfileUpdated() {
          return {}
        },

        async claimTurn(req) {
          const state = fakeTurnStates.get(req.sessionId)
          if (!state) throw new ConnectError('not found', Code.NotFound)
          if (state.currentTurnUserId !== req.userId) throw new ConnectError('forbidden', Code.PermissionDenied)
          if (state.turnClaimedAt !== null && Date.now() - state.turnClaimedAt < 15000) {
            throw new ConnectError('conflict', Code.AlreadyExists)
          }
          state.turnClaimedAt = Date.now()
          return {}
        },

        async releaseTurnClaim(req) {
          const state = fakeTurnStates.get(req.sessionId)
          if (state) state.turnClaimedAt = null
          return {}
        },

        async advanceTurn(req) {
          const state = fakeTurnStates.get(req.sessionId)
          if (!state || state.roster.length === 0) return { nextTurnUserId: '' }
          const currentIndex = state.roster.findIndex((r) => r.userId === state.currentTurnUserId)
          const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % state.roster.length
          state.currentTurnUserId = state.roster[nextIndex]?.userId ?? null
          state.turnClaimedAt = null
          return { nextTurnUserId: state.currentTurnUserId ?? '' }
        },
      }),
  })

  fakeWebsocketService = http.createServer(rpcHandler)
  fakeWebsocketServicePort = await new Promise<number>((resolve) => {
    fakeWebsocketService.listen(0, '127.0.0.1', () => {
      resolve((fakeWebsocketService.address() as { port: number }).port)
    })
  })

  app = createApp({
    db,
    authSecret: AUTH_SECRET,
    moderationServiceUrl: `http://127.0.0.1:${fakeModerationServicePort}`,
    websocketServiceUrl: `http://127.0.0.1:${fakeWebsocketServicePort}`,
    internalServiceSecret: INTERNAL_SERVICE_SECRET,
    publicBaseUrl: 'https://dev-mincirklen.dk',
    vault: VAULT,
    // Never actually called by anything this file exercises — see
    // app.integration.test.ts's identical comment.
    pubsub: { provider: 'gcp', projectId: 'session-integration-test', topic: 'data-export-requests' },
    identityHashKey: 'session-integration-test-identity-hash-key',
    gcs: { provider: 'gcp', bucket: 'unused-in-this-test' },
    downloadTokenSecret: 'session-integration-test-download-token-secret',
    trpcPublicBaseUrl: 'https://trpc.dev-mincirklen.dk',
  })
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => fakeModerationService.close((err) => (err ? reject(err) : resolve())))
  await new Promise<void>((resolve, reject) => fakeWebsocketService.close((err) => (err ? reject(err) : resolve())))
  await db.destroy()
})

interface Actor {
  cookie: string
  userId: string
}

// sessionRouter's procedures are verifiedProcedure-gated (Google-linked +
// completed profile — see controllers/trpc.ts), so every actor used
// against session.* has to actually clear that bar, not just hold a
// session cookie. There's no fake-Google harness in this file (that's
// oauth.integration.test.ts's job) — inserting the user and signing a
// token directly, then linking the identity and completing the profile
// via the repositories, is the same setup shortcut oauth.integration.test.ts
// already uses for the profile half. This used to go through the now-
// removed auth.createAnonymousSession endpoint (see SECURITY_FINDINGS.md
// H1) — Google sign-in is this platform's only real login door, so a
// bare unverified user is minted directly here instead.
async function mintBareUserCookie(): Promise<{ cookie: string; userId: string }> {
  const user = await insertUser(db)
  const token = createSessionToken(user.id, AUTH_SECRET)
  return { cookie: `mc_session=${token}`, userId: user.id }
}

async function createActor(): Promise<Actor> {
  const { cookie, userId } = await mintBareUserCookie()

  await linkIdentity(db, userId, 'google', `test-subject-${userId}`)
  await upsertUserProfile(db, VAULT, {
    userId,
    firstName: 'Test',
    lastName: 'Actor',
    gender: 'other',
    country: 'US',
    mobileNumber: '+1 555 0100',
    stayAnonymous: true,
    termsAcceptedAt: new Date(),
  })

  return { cookie, userId }
}

async function call(actor: Actor, path: string, input: unknown) {
  return app.request(`/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: actor.cookie },
    body: JSON.stringify(input),
  })
}

async function query(actor: Actor, path: string, input: Record<string, unknown>) {
  const search = new URLSearchParams({ input: JSON.stringify(input) })
  return app.request(`/trpc/${path}?${search.toString()}`, {
    headers: { cookie: actor.cookie },
  })
}

describe('verifiedProcedure gate on session.*', () => {
  test('a bare unverified session (no Google link, no profile) is rejected', async () => {
    const { cookie } = await mintBareUserCookie()

    const createRes = await call({ cookie, userId: '' }, 'session.create', {})
    expect(createRes.status).toBe(403)
  })

  test('a Google-linked session with no completed profile is rejected', async () => {
    const { cookie, userId } = await mintBareUserCookie()

    await linkIdentity(db, userId, 'google', `test-subject-${userId}`)

    const createRes = await call({ cookie, userId }, 'session.create', {})
    expect(createRes.status).toBe(403)
  })

  test('a fully verified actor (Google-linked + profiled) is allowed through', async () => {
    const actor = await createActor()
    const createRes = await call(actor, 'session.create', {})
    expect(createRes.status).toBe(200)
  })
})

describe('session + message pipeline', () => {
  test('create, join, send in turn order, and fan out to websocket-service', async () => {
    const alice = await createActor()
    const bob = await createActor()

    const createRes = await call(alice, 'session.create', {})
    expect(createRes.status).toBe(200)
    const { result: created } = (await createRes.json()) as { result: { data: { id: string } } }
    const sessionId = created.data.id

    const aliceJoin = await call(alice, 'session.join', { sessionId })
    expect(aliceJoin.status).toBe(200)
    const bobJoin = await call(bob, 'session.join', { sessionId })
    expect(bobJoin.status).toBe(200)

    const stateRes = await query(alice, 'session.getState', { sessionId })
    const { result: state } = (await stateRes.json()) as {
      result: { data: { currentTurnUserId: string; roster: { userId: string; turnOrder: number; displayName: string | null }[] } }
    }
    expect(state.data.currentTurnUserId).toBe(alice.userId)
    // Neither actor has a profile with stay_anonymous off in this test,
    // so both roster entries stay anonymous (displayName: null) — see
    // userProfileRepository.integration.test.ts for the "reveals a name"
    // and "masks it again once re-anonymized" cases.
    expect(state.data.roster).toEqual([
      { userId: alice.userId, turnOrder: 0, displayName: null },
      { userId: bob.userId, turnOrder: 1, displayName: null },
    ])

    // Bob is not the current-turn holder — rejected.
    const bobTriesEarly = await call(bob, 'session.sendMessage', { sessionId, body: 'not my turn' })
    expect(bobTriesEarly.status).toBe(403)

    const aliceSends = await call(alice, 'session.sendMessage', { sessionId, body: 'hello room' })
    expect(aliceSends.status).toBe(200)
    const { result: sent } = (await aliceSends.json()) as { result: { data: { status: string } } }
    expect(sent.data.status).toBe('sent')

    // 3 publishes total: alice's and bob's join each fan out a "joined"
    // system message (see migrations/0001_init.ts), plus
    // alice's real send — fire-and-forget, so find the one that matters
    // rather than assume a fixed index/order across them.
    await waitForPublish(3)
    expect(publishedRequests).toHaveLength(3)
    const sendPublish = publishedRequests.find((r) => (r.body as { body?: string }).body === 'hello room')
    expect(sendPublish?.sessionId).toBe(sessionId)
    expect(sendPublish?.secretHeader).toBe(INTERNAL_SERVICE_SECRET)
    expect(sendPublish?.body).toMatchObject({ sessionId, userId: alice.userId, body: 'hello room' })

    const afterState = await query(alice, 'session.getState', { sessionId })
    const { result: afterData } = (await afterState.json()) as {
      result: { data: { currentTurnUserId: string } }
    }
    expect(afterData.data.currentTurnUserId).toBe(bob.userId)

    const messagesRes = await query(alice, 'session.listMessages', { sessionId })
    const { result: messages } = (await messagesRes.json()) as {
      result: { data: { messages: { body: string; type: string }[] } }
    }
    expect(messages.data.messages.filter((m) => m.type === 'user').map((m) => m.body)).toEqual(['hello room'])

    // Alice's turn has passed — sending again is rejected.
    const aliceSendsAgain = await call(alice, 'session.sendMessage', { sessionId, body: 'again' })
    expect(aliceSendsAgain.status).toBe(403)
  })

  test('skipTurn forfeits the turn without persisting anything, and only the actual holder can call it', async () => {
    const alice = await createActor()
    const bob = await createActor()

    const createRes = await call(alice, 'session.create', {})
    const { result: created } = (await createRes.json()) as { result: { data: { id: string } } }
    const sessionId = created.data.id
    await call(alice, 'session.join', { sessionId })
    await call(bob, 'session.join', { sessionId })

    // Bob doesn't hold the turn yet — rejected, same guarantee as sendMessage.
    const bobTriesEarly = await call(bob, 'session.skipTurn', { sessionId })
    expect(bobTriesEarly.status).toBe(403)

    const aliceSkips = await call(alice, 'session.skipTurn', { sessionId })
    expect(aliceSkips.status).toBe(200)
    const { result: skipped } = (await aliceSkips.json()) as { result: { data: { status: string } } }
    expect(skipped.data.status).toBe('skipped')

    const stateRes = await query(alice, 'session.getState', { sessionId })
    const { result: state } = (await stateRes.json()) as { result: { data: { currentTurnUserId: string } } }
    expect(state.data.currentTurnUserId).toBe(bob.userId)

    // No new publish from the skip itself, none persisted — a skip is
    // silent. The 2 publishes already present are alice's and bob's join
    // system messages (see migrations/0001_init.ts).
    await waitForPublish(2)
    expect(publishedRequests).toHaveLength(2)
    const messagesRes = await query(alice, 'session.listMessages', { sessionId })
    const { result: messages } = (await messagesRes.json()) as { result: { data: { messages: { type: string }[] } } }
    expect(messages.data.messages.filter((m) => m.type === 'user')).toEqual([])

    // Alice's turn already passed — skipping again is rejected.
    const aliceSkipsAgain = await call(alice, 'session.skipTurn', { sessionId })
    expect(aliceSkipsAgain.status).toBe(403)
  })

  test('rejects a non-member trying to skip', async () => {
    const alice = await createActor()
    const outsider = await createActor()

    const createRes = await call(alice, 'session.create', {})
    const { result: created } = (await createRes.json()) as { result: { data: { id: string } } }

    const res = await call(outsider, 'session.skipTurn', { sessionId: created.data.id })
    expect(res.status).toBe(403)
  })

  test('rejects a non-member trying to send', async () => {
    const alice = await createActor()
    const outsider = await createActor()

    const createRes = await call(alice, 'session.create', {})
    const { result: created } = (await createRes.json()) as { result: { data: { id: string } } }

    const res = await call(outsider, 'session.sendMessage', { sessionId: created.data.id, body: 'hi' })
    expect(res.status).toBe(403)
  })

  test('rejects a non-member reading session state or message history — no cross-session visibility', async () => {
    const alice = await createActor()
    const bob = await createActor()
    const outsider = await createActor()

    const createRes = await call(alice, 'session.create', {})
    const { result: created } = (await createRes.json()) as { result: { data: { id: string } } }
    const sessionId = created.data.id
    await call(alice, 'session.join', { sessionId })
    await call(bob, 'session.join', { sessionId })
    await call(alice, 'session.sendMessage', { sessionId, body: 'private to this circle' })

    const outsiderState = await query(outsider, 'session.getState', { sessionId })
    expect(outsiderState.status).toBe(403)

    const outsiderMessages = await query(outsider, 'session.listMessages', { sessionId })
    expect(outsiderMessages.status).toBe(403)

    // A member can still read both — confirms this isn't just blocking everyone.
    const memberState = await query(bob, 'session.getState', { sessionId })
    expect(memberState.status).toBe(200)
    const memberMessages = await query(bob, 'session.listMessages', { sessionId })
    expect(memberMessages.status).toBe(200)
  })

  test('listMessages paginates with cursor/limit, oldest-first within each page', async () => {
    const alice = await createActor()
    const bob = await createActor()

    const createRes = await call(alice, 'session.create', {})
    const { result: created } = (await createRes.json()) as { result: { data: { id: string } } }
    const sessionId = created.data.id
    await call(alice, 'session.join', { sessionId })
    await call(bob, 'session.join', { sessionId })

    await call(alice, 'session.sendMessage', { sessionId, body: 'first' })
    await call(bob, 'session.sendMessage', { sessionId, body: 'second' })
    await call(alice, 'session.sendMessage', { sessionId, body: 'third' })

    // Alice's and bob's joins each land a "joined" system message ahead of
    // the real sends (migrations/0001_init.ts), so the exact
    // page boundaries for a fixed limit shift — walk every page via cursor
    // (same guarded-loop pattern as messageRepository.integration.test.ts's
    // pagination test) instead of asserting fixed page contents, then check
    // only the real messages came back complete and in order.
    const collected: { body: string; type: string }[] = []
    let cursor: string | null | undefined
    for (let guard = 0; guard < 10; guard++) {
      const pageRes = await query(alice, 'session.listMessages', cursor ? { sessionId, limit: 2, cursor } : { sessionId, limit: 2 })
      const { result: page } = (await pageRes.json()) as {
        result: { data: { messages: { body: string; type: string }[]; nextCursor: string | null } }
      }
      collected.unshift(...page.data.messages)
      if (page.data.nextCursor === null) break
      cursor = page.data.nextCursor
    }

    expect(collected.filter((m) => m.type === 'user').map((m) => m.body)).toEqual(['first', 'second', 'third'])
  })

  test('"flag": holds the message back but still advances the turn', async () => {
    const alice = await createActor()
    const bob = await createActor()

    const createRes = await call(alice, 'session.create', {})
    const { result: created } = (await createRes.json()) as { result: { data: { id: string } } }
    const sessionId = created.data.id
    await call(alice, 'session.join', { sessionId })
    await call(bob, 'session.join', { sessionId })

    const res = await call(alice, 'session.sendMessage', { sessionId, body: 'FLAG_ME' })
    expect(res.status).toBe(200)
    const { result } = (await res.json()) as { result: { data: { status: string } } }
    expect(result.data.status).toBe('held')

    // The message is persisted now (messageRepository.ts's
    // recordFlaggedMessage) — held back from the group, but visible back
    // to its own author.
    const aliceMessagesRes = await query(alice, 'session.listMessages', { sessionId })
    const { result: aliceMessages } = (await aliceMessagesRes.json()) as {
      result: { data: { messages: { type: string; body: string; moderationStatus: string }[] } }
    }
    const aliceUserMessages = aliceMessages.data.messages.filter((m) => m.type === 'user')
    expect(aliceUserMessages).toHaveLength(1)
    expect(aliceUserMessages[0]?.body).toBe('FLAG_ME')
    expect(aliceUserMessages[0]?.moderationStatus).toBe('flag')

    // ...but never to another member — the privacy boundary is the
    // WHERE clause in listMessages, not a client-side hide.
    const bobMessagesRes = await query(bob, 'session.listMessages', { sessionId })
    const { result: bobMessages } = (await bobMessagesRes.json()) as { result: { data: { messages: { type: string }[] } } }
    expect(bobMessages.data.messages.filter((m) => m.type === 'user')).toHaveLength(0)

    const stateRes = await query(alice, 'session.getState', { sessionId })
    const { result: state } = (await stateRes.json()) as { result: { data: { currentTurnUserId: string } } }
    expect(state.data.currentTurnUserId).toBe(bob.userId)
  })

  test('"crisis": returns the resource card, persists the message to its author only, and advances the turn', async () => {
    const alice = await createActor()
    const bob = await createActor()

    const createRes = await call(alice, 'session.create', {})
    const { result: created } = (await createRes.json()) as { result: { data: { id: string } } }
    const sessionId = created.data.id
    await call(alice, 'session.join', { sessionId })
    await call(bob, 'session.join', { sessionId })

    const res = await call(alice, 'session.sendMessage', { sessionId, body: 'CRISIS_ME' })
    expect(res.status).toBe(200)
    const { result } = (await res.json()) as {
      result: { data: { status: string; resource: { resources: unknown[] } } }
    }
    expect(result.data.status).toBe('crisis')
    expect(result.data.resource.resources.length).toBeGreaterThan(0)

    // Same visibility rule as a flag (messageRepository.ts's
    // recordCrisisMessage/listMessages): persisted, visible to its own
    // author, never to another member.
    const aliceMessagesRes = await query(alice, 'session.listMessages', { sessionId })
    const { result: aliceMessages } = (await aliceMessagesRes.json()) as {
      result: { data: { messages: { type: string; body: string; moderationStatus: string }[] } }
    }
    const aliceUserMessages = aliceMessages.data.messages.filter((m) => m.type === 'user')
    expect(aliceUserMessages).toHaveLength(1)
    expect(aliceUserMessages[0]?.body).toBe('CRISIS_ME')
    expect(aliceUserMessages[0]?.moderationStatus).toBe('crisis')

    const bobMessagesRes = await query(bob, 'session.listMessages', { sessionId })
    const { result: bobMessages } = (await bobMessagesRes.json()) as { result: { data: { messages: { type: string }[] } } }
    expect(bobMessages.data.messages.filter((m) => m.type === 'user')).toHaveLength(0)

    const stateRes = await query(alice, 'session.getState', { sessionId })
    const { result: state } = (await stateRes.json()) as { result: { data: { currentTurnUserId: string } } }
    // Turn now advances the same as a flag — see messageService.ts's
    // sendMessage comment for why this is a deliberate product decision.
    expect(state.data.currentTurnUserId).toBe(bob.userId)
  })

  test('join surfaces "session full" and "session not found" through the router', async () => {
    const host = await createActor()
    const createRes = await call(host, 'session.create', {})
    const { result: created } = (await createRes.json()) as { result: { data: { id: string } } }
    const sessionId = created.data.id

    for (let i = 0; i < 8; i++) {
      const actor = await createActor()
      const joinRes = await call(actor, 'session.join', { sessionId })
      expect(joinRes.status).toBe(200)
    }

    const oneTooMany = await createActor()
    const fullRes = await call(oneTooMany, 'session.join', { sessionId })
    expect(fullRes.status).toBe(409)

    const notFoundRes = await call(oneTooMany, 'session.join', {
      sessionId: '00000000-0000-0000-0000-000000000000',
    })
    expect(notFoundRes.status).toBe(404)
  })
})

describe('topics.list', () => {
  test('returns the seeded topics to a verified actor', async () => {
    const actor = await createActor()
    const res = await query(actor, 'topics.list', {})
    expect(res.status).toBe(200)

    const { result } = (await res.json()) as { result: { data: { slug: string; label: string }[] } }
    expect(result.data.some((t) => t.slug === 'grief' && t.label === 'Grief')).toBe(true)
  })
})

describe('scheduled circles (/p/new, /p/join)', () => {
  async function griefTopicId(actor: Actor): Promise<string> {
    const res = await query(actor, 'topics.list', {})
    const { result } = (await res.json()) as { result: { data: { id: string; slug: string }[] } }
    return result.data.find((t) => t.slug === 'grief')!.id
  }

  test('create persists topic/schedule/duration/capacity, and the circle appears in listOpen', async () => {
    const alice = await createActor()
    const topicId = await griefTopicId(alice)

    const createRes = await call(alice, 'session.create', {
      topicId,
      name: 'Weekly grief circle',
      scheduledAt: '2026-09-01T18:00:00.000Z',
      durationMinutes: 45,
      capacity: 6,
    })
    expect(createRes.status).toBe(200)
    const { result: created } = (await createRes.json()) as { result: { data: { id: string } } }

    const openRes = await query(alice, 'session.listOpen', { topicId, limit: 50 })
    expect(openRes.status).toBe(200)
    const { result: open } = (await openRes.json()) as {
      result: {
        data: {
          sessions: {
            id: string
            name: string
            durationMinutes: number | null
            capacity: number
            joinedCount: number
            topic: { id: string; slug: string; label: string }
          }[]
          nextCursor: string | null
        }
      }
    }
    const listed = open.data.sessions.find((s) => s.id === created.data.id)
    expect(listed).toMatchObject({
      name: 'Weekly grief circle',
      durationMinutes: 45,
      capacity: 6,
      joinedCount: 0,
      topic: { id: topicId, slug: 'grief', label: 'Grief' },
    })
  })

  test('listOpen supports filtering by search term and paging via nextCursor', async () => {
    const alice = await createActor()
    const topicId = await griefTopicId(alice)
    const marker = crypto.randomUUID().slice(0, 8)

    for (let i = 0; i < 3; i++) {
      await call(alice, 'session.create', {
        topicId,
        name: `Search filter circle ${marker} ${i}`,
        scheduledAt: '2026-09-01T18:00:00.000Z',
        durationMinutes: 30,
        capacity: 8,
      })
    }

    const firstPageRes = await query(alice, 'session.listOpen', { search: marker, limit: 2 })
    expect(firstPageRes.status).toBe(200)
    const { result: firstPage } = (await firstPageRes.json()) as {
      result: { data: { sessions: { id: string }[]; nextCursor: string | null; prevCursor: string | null } }
    }
    expect(firstPage.data.sessions).toHaveLength(2)
    expect(firstPage.data.nextCursor).not.toBeNull()
    expect(firstPage.data.prevCursor).toBeNull()

    const secondPageRes = await query(alice, 'session.listOpen', {
      search: marker,
      limit: 2,
      cursor: firstPage.data.nextCursor as string,
    })
    const { result: secondPage } = (await secondPageRes.json()) as {
      result: { data: { sessions: { id: string }[]; nextCursor: string | null; prevCursor: string | null } }
    }
    expect(secondPage.data.sessions).toHaveLength(1)
    expect(secondPage.data.nextCursor).toBeNull()
    expect(secondPage.data.prevCursor).not.toBeNull()

    const allIds = new Set([...firstPage.data.sessions, ...secondPage.data.sessions].map((s) => s.id))
    expect(allIds.size).toBe(3)

    // Windowed browsing (StartJoinPage.tsx) relies on this: paging
    // backward from the second page's own prevCursor must reproduce the
    // first page exactly.
    const backRes = await query(alice, 'session.listOpen', {
      search: marker,
      limit: 2,
      cursor: secondPage.data.prevCursor as string,
      direction: 'before',
    })
    const { result: back } = (await backRes.json()) as { result: { data: { sessions: { id: string }[] } } }
    expect(back.data.sessions.map((s) => s.id)).toEqual(firstPage.data.sessions.map((s) => s.id))
  })

  test('enforces the circle\'s own capacity rather than the ad-hoc default of 8', async () => {
    const alice = await createActor()
    const topicId = await griefTopicId(alice)

    const createRes = await call(alice, 'session.create', {
      topicId,
      name: 'Small grief circle',
      scheduledAt: '2026-09-01T18:00:00.000Z',
      durationMinutes: null,
      capacity: 1,
    })
    const { result: created } = (await createRes.json()) as { result: { data: { id: string } } }
    const sessionId = created.data.id

    await call(alice, 'session.join', { sessionId })

    const bob = await createActor()
    const fullRes = await call(bob, 'session.join', { sessionId })
    expect(fullRes.status).toBe(409)
  })

  test('rejects a partially-filled scheduling input', async () => {
    const alice = await createActor()
    const res = await call(alice, 'session.create', { topicId: await griefTopicId(alice) })
    expect(res.status).toBe(400)
  })

  test('rejects scheduling a circle more than a week out', async () => {
    const alice = await createActor()
    const eightDaysOut = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString()

    const res = await call(alice, 'session.create', {
      topicId: await griefTopicId(alice),
      name: 'Too far out',
      scheduledAt: eightDaysOut,
      durationMinutes: 60,
      capacity: 6,
    })
    expect(res.status).toBe(400)
  })
})

describe('session.visit / session.listRecentVisits', () => {
  async function griefTopicId(actor: Actor): Promise<string> {
    const res = await query(actor, 'topics.list', {})
    const { result } = (await res.json()) as { result: { data: { id: string; slug: string }[] } }
    return result.data.find((t) => t.slug === 'grief')!.id
  }

  async function createNamed(actor: Actor, topicId: string, name: string): Promise<string> {
    const res = await call(actor, 'session.create', {
      topicId,
      name,
      scheduledAt: new Date().toISOString(),
      durationMinutes: 30,
      capacity: 6,
    })
    const { result } = (await res.json()) as { result: { data: { id: string } } }
    return result.data.id
  }

  test('visiting a session the actor never explicitly joined auto-joins them (SessionPage.tsx\'s "observe any session" path)', async () => {
    const alice = await createActor()
    const bob = await createActor()

    const createRes = await call(alice, 'session.create', {})
    const { result: created } = (await createRes.json()) as { result: { data: { id: string } } }
    const sessionId = created.data.id
    await call(alice, 'session.join', { sessionId })

    // Bob never called session.join — visiting is what grants him access.
    const visitRes = await call(bob, 'session.visit', { sessionId })
    expect(visitRes.status).toBe(200)
    const { result } = (await visitRes.json()) as { result: { data: { id: string } } }
    expect(result.data.id).toBe(sessionId)

    // getState/listMessages stay membership-gated exactly as before —
    // this only passes because visiting joined him.
    const stateRes = await query(bob, 'session.getState', { sessionId })
    expect(stateRes.status).toBe(200)
  })

  test('visiting a session that does not exist is a 404, not a crash', async () => {
    const alice = await createActor()
    const res = await call(alice, 'session.visit', { sessionId: '00000000-0000-0000-0000-000000000000' })
    expect(res.status).toBe(404)
  })

  test('revisiting an already-visited session bumps it to the top of listRecentVisits', async () => {
    const alice = await createActor()
    const topicId = await griefTopicId(alice)
    const firstId = await createNamed(alice, topicId, 'First circle')
    const secondId = await createNamed(alice, topicId, 'Second circle')

    await call(alice, 'session.visit', { sessionId: firstId })
    await call(alice, 'session.visit', { sessionId: secondId })

    const before = await query(alice, 'session.listRecentVisits', { limit: 10 })
    const { result: beforeResult } = (await before.json()) as { result: { data: { visits: { id: string }[] } } }
    expect(beforeResult.data.visits.map((v) => v.id)).toEqual([secondId, firstId])

    await call(alice, 'session.visit', { sessionId: firstId }) // revisit

    const after = await query(alice, 'session.listRecentVisits', { limit: 10 })
    const { result: afterResult } = (await after.json()) as { result: { data: { visits: { id: string }[] } } }
    expect(afterResult.data.visits.map((v) => v.id)).toEqual([firstId, secondId])
  })

  test('revisiting a session does not re-announce a live join to other members', async () => {
    const alice = await createActor()
    const bob = await createActor()

    const createRes = await call(alice, 'session.create', {})
    const { result: created } = (await createRes.json()) as { result: { data: { id: string } } }
    const sessionId = created.data.id
    await call(alice, 'session.join', { sessionId })
    await waitForJoinNotification(1) // alice's own join notification, before resetting
    joinNotifications = [] // only care about what happens after alice's own real join

    // Bob's first visit is a genuinely new join — one notification.
    await call(bob, 'session.visit', { sessionId })
    await waitForJoinNotification(1)
    expect(joinNotifications).toEqual([{ sessionId, userId: bob.userId }])

    // Navigating away and back (e.g. viewing a different session, then
    // returning) calls visit again for an already-joined member — this
    // must not fan out a second "joined" event, or every viewer sees a
    // spurious repeat join notification (the bug this test guards).
    await call(bob, 'session.visit', { sessionId })
    await call(bob, 'session.visit', { sessionId })
    // Nothing further to explicitly wait for (no new notification should
    // fire) — a short delay gives a regression a real chance to land
    // before asserting its absence, rather than racing past it.
    await new Promise((r) => setTimeout(r, 100))
    expect(joinNotifications).toEqual([{ sessionId, userId: bob.userId }])
  })

  test('listRecentVisits search filters by name, same as /p/join', async () => {
    const alice = await createActor()
    const topicId = await griefTopicId(alice)
    const griefId = await createNamed(alice, topicId, 'Weekly grief circle')
    const anxietyId = await createNamed(alice, topicId, 'Anxiety support circle')
    await call(alice, 'session.visit', { sessionId: griefId })
    await call(alice, 'session.visit', { sessionId: anxietyId })

    const res = await query(alice, 'session.listRecentVisits', { search: 'grief', limit: 10 })
    const { result } = (await res.json()) as { result: { data: { visits: { id: string }[] } } }
    expect(result.data.visits.map((v) => v.id)).toEqual([griefId])
  })

  test('listRecentVisits never returns another user\'s visits', async () => {
    const alice = await createActor()
    const bob = await createActor()
    const topicId = await griefTopicId(alice)
    const aliceSessionId = await createNamed(alice, topicId, "Alice's circle")
    await call(alice, 'session.visit', { sessionId: aliceSessionId })

    const res = await query(bob, 'session.listRecentVisits', { limit: 10 })
    const { result } = (await res.json()) as { result: { data: { visits: { id: string }[] } } }
    expect(result.data.visits).toEqual([])
  })
})

describe('session.getSummary', () => {
  test('returns the session without joining it — a read-only existence check', async () => {
    const alice = await createActor()
    const bob = await createActor()

    const createRes = await call(alice, 'session.create', {})
    const { result: created } = (await createRes.json()) as { result: { data: { id: string } } }
    const sessionId = created.data.id

    const summaryRes = await query(bob, 'session.getSummary', { sessionId })
    expect(summaryRes.status).toBe(200)
    const { result } = (await summaryRes.json()) as { result: { data: { id: string } } }
    expect(result.data.id).toBe(sessionId)

    // Bob only called getSummary, never join/visit — getState (membership-
    // gated) must still reject him.
    const stateRes = await query(bob, 'session.getState', { sessionId })
    expect(stateRes.status).toBe(403)
  })

  test('a session that does not exist is a 404', async () => {
    const alice = await createActor()
    const res = await query(alice, 'session.getSummary', { sessionId: '00000000-0000-0000-0000-000000000000' })
    expect(res.status).toBe(404)
  })
})

describe('session.checkGuidelines / session.agreeToGuidelines', () => {
  test('reports not agreed until agreeToGuidelines is called, for a session the user has joined', async () => {
    const alice = await createActor()
    const created = await call(alice, 'session.create', {})
    const { result } = (await created.json()) as { result: { data: { id: string } } }
    const sessionId = result.data.id
    await call(alice, 'session.visit', { sessionId })

    const before = await call(alice, 'session.checkGuidelines', { sessionId })
    const { result: beforeResult } = (await before.json()) as { result: { data: { agreed: boolean; agreedKeys: string[] } } }
    expect(beforeResult.data.agreed).toBe(false)
    expect(beforeResult.data.agreedKeys).toEqual([])

    const agreeRes = await call(alice, 'session.agreeToGuidelines', { sessionId })
    expect(agreeRes.status).toBe(200)

    const after = await call(alice, 'session.checkGuidelines', { sessionId })
    const { result: afterResult } = (await after.json()) as { result: { data: { agreed: boolean; agreedKeys: string[] } } }
    expect(afterResult.data.agreed).toBe(true)
    expect(afterResult.data.agreedKeys.length).toBeGreaterThan(0)
  })

  test('a returning user missing only a newly-added required key sees the rest pre-checked, not a blank slate', async () => {
    const alice = await createActor()
    const created = await call(alice, 'session.create', {})
    const { result } = (await created.json()) as { result: { data: { id: string } } }
    const sessionId = result.data.id
    await call(alice, 'session.visit', { sessionId })

    // Simulates "agreed before a checkbox was added" — write a partial
    // agreements object directly, missing one required key.
    const partialTimestamp = new Date().toISOString()
    const partial = { community_guidelines: partialTimestamp, privacy_policy: partialTimestamp, anonymity_acknowledgement: partialTimestamp }
    await db
      .updateTable('session_users')
      .set({ agreements: sql`${JSON.stringify(partial)}::jsonb` })
      .where('session_id', '=', sessionId)
      .execute()

    const status = await call(alice, 'session.checkGuidelines', { sessionId })
    const { result: statusResult } = (await status.json()) as { result: { data: { agreed: boolean; agreedKeys: string[] } } }
    expect(statusResult.data.agreed).toBe(false)
    expect(statusResult.data.agreedKeys.sort()).toEqual(['anonymity_acknowledgement', 'community_guidelines', 'privacy_policy'])
    expect(statusResult.data.agreedKeys).not.toContain('terms_of_service')
  })

  test('is per-membership-row, not global — but a returning user is never asked twice: checkGuidelines auto-copies a prior agreement onto a new session', async () => {
    const alice = await createActor()

    const first = await call(alice, 'session.create', {})
    const { result: firstCreated } = (await first.json()) as { result: { data: { id: string } } }
    await call(alice, 'session.visit', { sessionId: firstCreated.data.id })
    await call(alice, 'session.agreeToGuidelines', { sessionId: firstCreated.data.id })

    const second = await call(alice, 'session.create', {})
    const { result: secondCreated } = (await second.json()) as { result: { data: { id: string } } }
    await call(alice, 'session.visit', { sessionId: secondCreated.data.id })

    // Never explicitly agreed on the second session — checkGuidelines
    // alone must report agreed, having copied the first session's
    // agreement forward.
    const status = await call(alice, 'session.checkGuidelines', { sessionId: secondCreated.data.id })
    const { result } = (await status.json()) as { result: { data: { agreed: boolean } } }
    expect(result.data.agreed).toBe(true)
  })

  test('a brand-new user with no prior agreement anywhere is not auto-agreed', async () => {
    const alice = await createActor()
    const created = await call(alice, 'session.create', {})
    const { result } = (await created.json()) as { result: { data: { id: string } } }
    await call(alice, 'session.visit', { sessionId: result.data.id })

    const status = await call(alice, 'session.checkGuidelines', { sessionId: result.data.id })
    const { result: statusResult } = (await status.json()) as { result: { data: { agreed: boolean } } }
    expect(statusResult.data.agreed).toBe(false)
  })
})
