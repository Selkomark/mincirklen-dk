import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, presenceSubject, runMigrations } from '@mincirklen/shared'
import { Redis } from 'ioredis'
import { connect, type NatsConnection } from 'nats'
import { Code, ConnectError, createClient, type Client, type Interceptor } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-node'
import { InternalService } from '@mincirklen/proto'
import type { FastifyInstance } from 'fastify'
import { createRpcServer } from './rpcServer'

const AUTH_SECRET = 'rpc-server-integration-test-secret'
const INTERNAL_SERVICE_SECRET = 'rpc-server-integration-test-internal-secret'
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:4222'

const pool = createPgPool(process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL, 'test')
const db = createDb(pool)

let redis: Redis
let nats: NatsConnection
let server: FastifyInstance
let baseUrl: string
let client: Client<typeof InternalService>

// A second server sharing the same Redis/NATS but wired to an already-
// destroyed Postgres pool — every query against it rejects immediately.
// Used only to exercise the fire-and-forget write-back's catch branch
// (claimTurn/advanceTurn): the claim/advance itself must still succeed
// (Redis is authoritative), and the swallowed Postgres failure must never
// surface to the caller.
let brokenDbPool: ReturnType<typeof createPgPool>
let brokenDbServer: FastifyInstance
let brokenDbClient: Client<typeof InternalService>

const secretInterceptor: Interceptor = (next) => (req) => {
  req.header.set('x-internal-secret', INTERNAL_SERVICE_SECRET)
  return next(req)
}

beforeAll(async () => {
  await runMigrations(db, 'test')
  redis = new Redis(REDIS_URL)
  nats = await connect({ servers: NATS_URL })

  server = createRpcServer({ db, nats, redis, authSecret: AUTH_SECRET, allowedOrigins: [], internalServiceSecret: INTERNAL_SERVICE_SECRET, wireFormat: 'json' })
  baseUrl = await server.listen({ port: 0, host: '127.0.0.1' })
  client = createClient(InternalService, createConnectTransport({ httpVersion: '1.1', baseUrl, interceptors: [secretInterceptor] }))

  brokenDbPool = createPgPool(process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL, 'test')
  const brokenDb = createDb(brokenDbPool)
  await brokenDbPool.end()
  brokenDbServer = createRpcServer({
    db: brokenDb,
    nats,
    redis,
    authSecret: AUTH_SECRET,
    allowedOrigins: [],
    internalServiceSecret: INTERNAL_SERVICE_SECRET,
    wireFormat: 'json',
  })
  const brokenDbBaseUrl = await brokenDbServer.listen({ port: 0, host: '127.0.0.1' })
  brokenDbClient = createClient(InternalService, createConnectTransport({ httpVersion: '1.1', baseUrl: brokenDbBaseUrl, interceptors: [secretInterceptor] }))
})

afterAll(async () => {
  await server.close()
  await brokenDbServer.close()
  redis.disconnect()
  await nats.close()
  await db.destroy()
})

async function expectCode(promise: Promise<unknown>, code: Code): Promise<void> {
  try {
    await promise
    throw new Error(`expected a ConnectError with code ${code}, but the call succeeded`)
  } catch (err) {
    if (!(err instanceof ConnectError)) throw err
    expect(err.code).toBe(code)
  }
}

// A second, independent NATS connection standing in for a connected
// client's own subscription (mirroring app.integration.test.ts's
// cross-pod pattern) — proves the presence events these handlers publish
// actually reach a real subscriber, not just that publish() was called.
async function collectPresenceEvents(sessionId: string, count: number): Promise<Record<string, unknown>[]> {
  const subscriberNats = await connect({ servers: NATS_URL })
  const sub = subscriberNats.subscribe(presenceSubject(sessionId))
  const events: Record<string, unknown>[] = []
  for await (const msg of sub) {
    events.push(JSON.parse(msg.string()) as Record<string, unknown>)
    if (events.length >= count) break
  }
  await subscriberNats.close()
  return events
}

async function seedSession(members: { turnOrder: number }[]): Promise<{ sessionId: string; userIds: string[] }> {
  const users = await Promise.all(members.map(() => db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()))
  const session = await db
    .insertInto('sessions')
    .values({ status: 'active', current_turn_user_id: users[0]?.id ?? null })
    .returningAll()
    .executeTakeFirstOrThrow()
  if (users.length > 0) {
    await db
      .insertInto('session_users')
      .values(users.map((u, i) => ({ session_id: session.id, user_id: u.id, turn_order: i })))
      .execute()
  }
  return { sessionId: session.id, userIds: users.map((u) => u.id) }
}

describe('internal RPCs — require the internal secret', () => {
  test('rejects with 403 when the secret header is missing', async () => {
    const { sessionId } = await seedSession([{ turnOrder: 0 }])
    const res = await fetch(`${baseUrl}/mincirklen.internal.v1.InternalService/GetTurnState`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    expect(res.status).toBe(403)
  })
})

describe('getTurnState', () => {
  test('seeds from Postgres on first touch and returns the turn state, with nobody online yet', async () => {
    const { sessionId, userIds } = await seedSession([{ turnOrder: 0 }, { turnOrder: 1 }])

    const res = await client.getTurnState({ sessionId })
    expect(res.currentTurnUserId).toBe(userIds[0] as string)
    expect(res.roster.map((r) => ({ userId: r.userId, turnOrder: r.turnOrder }))).toEqual([
      { userId: userIds[0], turnOrder: 0 },
      { userId: userIds[1], turnOrder: 1 },
    ])
    expect(res.onlineUserIds).toEqual([])
  })

  test('rejects with NotFound for a session that does not exist anywhere', async () => {
    await expectCode(client.getTurnState({ sessionId: crypto.randomUUID() }), Code.NotFound)
  })

  test('includes a member as online once their presence has been marked in Redis', async () => {
    const { sessionId, userIds } = await seedSession([{ turnOrder: 0 }, { turnOrder: 1 }])
    await redis.zadd(`session:${sessionId}:online`, Date.now(), userIds[0] as string)

    const res = await client.getTurnState({ sessionId })
    expect(res.onlineUserIds).toEqual([userIds[0] as string])
  })
})

describe('joinRoster', () => {
  test('adds a new member to an already-seeded session without disturbing the turn cursor', async () => {
    const { sessionId, userIds } = await seedSession([{ turnOrder: 0 }])
    await client.getTurnState({ sessionId }) // force the initial seed

    const newUser = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    await db.insertInto('session_users').values({ session_id: sessionId, user_id: newUser.id, turn_order: 1 }).execute()

    await client.joinRoster({ sessionId, userId: newUser.id, turnOrder: 1 })

    const state = await client.getTurnState({ sessionId })
    expect(state.currentTurnUserId).toBe(userIds[0] as string)
    expect(state.roster.map((r) => r.userId)).toEqual([userIds[0] as string, newUser.id])
  })

  test('rejects a malformed body with 400', async () => {
    const { sessionId } = await seedSession([{ turnOrder: 0 }])
    const res = await fetch(`${baseUrl}/mincirklen.internal.v1.InternalService/JoinRoster`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_SERVICE_SECRET },
      body: JSON.stringify({ sessionId, userId: 123, turnOrder: 0 }),
    })
    expect(res.status).toBe(400)
  })

  test('rejects with NotFound for a session that does not exist in Postgres either', async () => {
    await expectCode(client.joinRoster({ sessionId: crypto.randomUUID(), userId: crypto.randomUUID(), turnOrder: 0 }), Code.NotFound)
  })

  test('publishes participant-joined and roster-update presence events reachable by a real subscriber', async () => {
    const { sessionId, userIds } = await seedSession([{ turnOrder: 0 }])
    await client.getTurnState({ sessionId }) // force the initial seed

    const newUser = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    await db.insertInto('session_users').values({ session_id: sessionId, user_id: newUser.id, turn_order: 1 }).execute()

    const events = collectPresenceEvents(sessionId, 2)
    await new Promise((r) => setTimeout(r, 100)) // let the subscription actually land before publishing
    await client.joinRoster({ sessionId, userId: newUser.id, turnOrder: 1 })

    const [joined, rosterUpdate] = await events
    expect(joined).toEqual({ type: 'participant-joined', sessionId, userId: newUser.id, turnOrder: 1 })
    expect(rosterUpdate).toEqual({
      type: 'roster-update',
      sessionId,
      currentTurnUserId: userIds[0],
      roster: [
        { userId: userIds[0], turnOrder: 0 },
        { userId: newUser.id, turnOrder: 1 },
      ],
    })
  })
})

describe('notifyProfileUpdated', () => {
  test('publishes a member-profile-updated presence event with the given display name, reachable by a real subscriber', async () => {
    const { sessionId, userIds } = await seedSession([{ turnOrder: 0 }])

    const events = collectPresenceEvents(sessionId, 1)
    await new Promise((r) => setTimeout(r, 100)) // let the subscription actually land before publishing
    await client.notifyProfileUpdated({ sessionId, userId: userIds[0] as string, displayName: 'Ada' })

    const [updated] = await events
    expect(updated).toEqual({ type: 'member-profile-updated', sessionId, userId: userIds[0], displayName: 'Ada' })
  })

  test('accepts an unset display name (re-anonymized) and relays it as null', async () => {
    const { sessionId, userIds } = await seedSession([{ turnOrder: 0 }])

    const events = collectPresenceEvents(sessionId, 1)
    await new Promise((r) => setTimeout(r, 100))
    await client.notifyProfileUpdated({ sessionId, userId: userIds[0] as string })

    const [updated] = await events
    expect(updated).toEqual({ type: 'member-profile-updated', sessionId, userId: userIds[0], displayName: null })
  })
})

describe('claimTurn', () => {
  test('rejects a malformed body with 400', async () => {
    const { sessionId } = await seedSession([{ turnOrder: 0 }])
    const res = await fetch(`${baseUrl}/mincirklen.internal.v1.InternalService/ClaimTurn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_SERVICE_SECRET },
      body: JSON.stringify({ sessionId, userId: 123 }),
    })
    expect(res.status).toBe(400)
  })

  test('succeeds for the current turn holder and mirrors the claim back to Postgres', async () => {
    const { sessionId, userIds } = await seedSession([{ turnOrder: 0 }])
    await client.getTurnState({ sessionId })

    await client.claimTurn({ sessionId, userId: userIds[0] as string })

    await new Promise((r) => setTimeout(r, 100)) // fire-and-forget write-back
    const row = await db.selectFrom('sessions').select('turn_claimed_at').where('id', '=', sessionId).executeTakeFirstOrThrow()
    expect(row.turn_claimed_at).not.toBeNull()
  })

  test('rejects with PermissionDenied for anyone who does not hold the turn', async () => {
    const { sessionId, userIds } = await seedSession([{ turnOrder: 0 }, { turnOrder: 1 }])
    await client.getTurnState({ sessionId })

    await expectCode(client.claimTurn({ sessionId, userId: userIds[1] as string }), Code.PermissionDenied)
  })

  test('rejects with AlreadyExists for a second claim while one is already outstanding', async () => {
    const { sessionId, userIds } = await seedSession([{ turnOrder: 0 }])
    await client.getTurnState({ sessionId })

    await client.claimTurn({ sessionId, userId: userIds[0] as string })
    await expectCode(client.claimTurn({ sessionId, userId: userIds[0] as string }), Code.AlreadyExists)
  })

  test('rejects with NotFound for a session with no seeded turn state at all', async () => {
    await expectCode(client.claimTurn({ sessionId: crypto.randomUUID(), userId: crypto.randomUUID() }), Code.NotFound)
  })

  test('still succeeds even when the fire-and-forget Postgres write-back fails', async () => {
    const { sessionId, userIds } = await seedSession([{ turnOrder: 0 }])
    await client.getTurnState({ sessionId })

    await expect(brokenDbClient.claimTurn({ sessionId, userId: userIds[0] as string })).resolves.toBeTruthy()
  })
})

describe('releaseTurnClaim', () => {
  test('succeeds and lets a subsequent claim succeed immediately', async () => {
    const { sessionId, userIds } = await seedSession([{ turnOrder: 0 }])
    await client.getTurnState({ sessionId })
    await client.claimTurn({ sessionId, userId: userIds[0] as string })

    await client.releaseTurnClaim({ sessionId })
    await expect(client.claimTurn({ sessionId, userId: userIds[0] as string })).resolves.toBeTruthy()
  })
})

describe('advanceTurn', () => {
  test('moves to the next member and mirrors it back to Postgres', async () => {
    const { sessionId, userIds } = await seedSession([{ turnOrder: 0 }, { turnOrder: 1 }])
    await client.getTurnState({ sessionId })

    const res = await client.advanceTurn({ sessionId })
    expect(res.nextTurnUserId).toBe(userIds[1] as string)

    await new Promise((r) => setTimeout(r, 100)) // fire-and-forget write-back
    const row = await db.selectFrom('sessions').select('current_turn_user_id').where('id', '=', sessionId).executeTakeFirstOrThrow()
    expect(row.current_turn_user_id).toBe(userIds[1] as string)
  })

  test('still succeeds even when the fire-and-forget Postgres write-back fails', async () => {
    const { sessionId, userIds } = await seedSession([{ turnOrder: 0 }, { turnOrder: 1 }])
    await client.getTurnState({ sessionId })

    const res = await brokenDbClient.advanceTurn({ sessionId })
    expect(res.nextTurnUserId).toBe(userIds[1] as string)
  })

  test('publishes a roster-update presence event reachable by a real subscriber', async () => {
    const { sessionId, userIds } = await seedSession([{ turnOrder: 0 }, { turnOrder: 1 }])
    await client.getTurnState({ sessionId })

    const events = collectPresenceEvents(sessionId, 1)
    await new Promise((r) => setTimeout(r, 100))
    await client.advanceTurn({ sessionId })

    const [rosterUpdate] = await events
    expect(rosterUpdate).toEqual({
      type: 'roster-update',
      sessionId,
      currentTurnUserId: userIds[1],
      roster: [
        { userId: userIds[0], turnOrder: 0 },
        { userId: userIds[1], turnOrder: 1 },
      ],
    })
  })
})
