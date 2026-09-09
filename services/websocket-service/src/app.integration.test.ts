import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, createSessionToken, presenceSubject, runMigrations } from '@mincirklen/shared'
import { connect, type NatsConnection } from 'nats'
import { Redis } from 'ioredis'
import { pack, unpack } from 'msgpackr'
import { createClient, type Client, type Interceptor } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-node'
import { InternalService } from '@mincirklen/proto'
import type { FastifyInstance } from 'fastify'
import { createApp } from './app'
import { createRpcServer } from './rpcServer'
import { seedTurnState } from './adapters/redisTurnStateAdapter'

const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:4222'
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
const AUTH_SECRET = 'fanout-integration-test-secret'
const INTERNAL_SERVICE_SECRET = 'fanout-integration-test-internal-secret'

const pool = createPgPool(
  process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL,
  'test',
)
const db = createDb(pool)

// Two fully independent app instances, each with its own NATS/Redis
// connection — this is the point of the test: nothing is shared between
// them except the database and the NATS/Redis servers, exactly like two
// real websocket-service pods. trpc-api's publish is stood in for via a
// real RPC call to pod A's own rpcServer.ts (see below), not a direct
// NATS publish — that's the actual thing Stage 1 changed.
let natsA: NatsConnection
let natsB: NatsConnection
let redisA: Redis
let redisB: Redis
let serverA: ReturnType<typeof Bun.serve>
let serverB: ReturnType<typeof Bun.serve>
let rpcServerA: FastifyInstance
let rpcBaseUrlA: string
let rpcClientA: Client<typeof InternalService>

const secretInterceptor: Interceptor = (next) => (req) => {
  req.header.set('x-internal-secret', INTERNAL_SERVICE_SECRET)
  return next(req)
}

beforeAll(async () => {
  await runMigrations(db, 'test')
  ;[natsA, natsB] = await Promise.all([connect({ servers: NATS_URL }), connect({ servers: NATS_URL })])
  redisA = new Redis(REDIS_URL)
  redisB = new Redis(REDIS_URL)

  const appA = createApp({ db, nats: natsA, redis: redisA, authSecret: AUTH_SECRET, allowedOrigins: [], internalServiceSecret: INTERNAL_SERVICE_SECRET, wireFormat: 'json' })
  const appB = createApp({ db, nats: natsB, redis: redisB, authSecret: AUTH_SECRET, allowedOrigins: [], internalServiceSecret: INTERNAL_SERVICE_SECRET, wireFormat: 'json' })

  const { websocket } = await import('hono/bun')
  serverA = Bun.serve({ port: 0, fetch: appA.fetch, websocket })
  serverB = Bun.serve({ port: 0, fetch: appB.fetch, websocket })

  // Pod A's own RPC listener — a NATS publish through this reaches any
  // subscriber on natsA/natsB alike (NATS doesn't care which "pod" made
  // the call), so this single client stands in for trpc-api's publish
  // call for every publish in this file, same as before.
  rpcServerA = createRpcServer({ db, nats: natsA, redis: redisA, authSecret: AUTH_SECRET, allowedOrigins: [], internalServiceSecret: INTERNAL_SERVICE_SECRET, wireFormat: 'json' })
  rpcBaseUrlA = await rpcServerA.listen({ port: 0, host: '127.0.0.1' })
  rpcClientA = createClient(InternalService, createConnectTransport({ httpVersion: '1.1', baseUrl: rpcBaseUrlA, interceptors: [secretInterceptor] }))
})

afterAll(async () => {
  serverA.stop(true)
  serverB.stop(true)
  await rpcServerA.close()
  redisA.disconnect()
  redisB.disconnect()
  await Promise.all([natsA.close(), natsB.close()])
  await db.destroy()
})

function fakeMessage(sessionId: string, body: string) {
  return {
    sessionId,
    messageId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    body,
    type: 'user',
    createdAt: new Date().toISOString(),
  }
}

function expectedMessageFrame(msg: ReturnType<typeof fakeMessage>): string {
  return JSON.stringify({
    type: 'message',
    payload: { id: msg.messageId, sessionId: msg.sessionId, userId: msg.userId, body: msg.body, type: msg.type, createdAt: msg.createdAt },
  })
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', (event) => reject(event), { once: true })
  })
}

// Collects frames until one satisfies `predicate` — a plain "next
// message" wait isn't enough now that a single connection can receive
// interleaved frame types on the same socket (e.g. a session-scope
// subscribe's own live-count-changed alongside the chat message a test
// is actually waiting for).
function waitForFrame(ws: WebSocket, predicate: (frame: { type: string; [key: string]: unknown }) => boolean, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage)
      reject(new Error('timed out waiting for a matching frame'))
    }, timeoutMs)

    function onMessage(event: MessageEvent) {
      const raw = event.data as string
      let frame: { type: string; [key: string]: unknown }
      try {
        frame = JSON.parse(raw) as { type: string; [key: string]: unknown }
      } catch {
        return
      }
      if (predicate(frame)) {
        clearTimeout(timer)
        ws.removeEventListener('message', onMessage)
        resolve(raw)
      }
    }
    ws.addEventListener('message', onMessage)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function createMemberAndToken(sessionId: string, turnOrder = 0): Promise<string> {
  const user = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
  await db.insertInto('session_users').values({ session_id: sessionId, user_id: user.id, turn_order: turnOrder }).execute()
  return createSessionToken(user.id, AUTH_SECRET)
}

function connectSocket(port: number | undefined, token: string): WebSocket {
  return new WebSocket(`ws://localhost:${port}/ws`, { headers: { Cookie: `mc_session=${token}` } })
}

describe('publishMessage RPC', () => {
  test('a message published once (via the RPC, standing in for trpc-api) reaches clients connected to two different pods', async () => {
    const session = await db.insertInto('sessions').defaultValues().returningAll().executeTakeFirstOrThrow()
    const tokenX = await createMemberAndToken(session.id, 0)
    const tokenY = await createMemberAndToken(session.id, 1)

    // X connects to pod A, Y connects to pod B — two independent
    // Bun.serve instances, standing in for two independent websocket-service
    // replicas. Neither is authorized for anything until it explicitly
    // subscribes (see wsController.ts's createWsGuard doc comment).
    const wsX = connectSocket(serverA.port, tokenX)
    const wsY = connectSocket(serverB.port, tokenY)

    try {
      await Promise.all([waitForOpen(wsX), waitForOpen(wsY)])
      wsX.send(JSON.stringify({ type: 'subscribe', scope: 'session', sessionId: session.id }))
      wsY.send(JSON.stringify({ type: 'subscribe', scope: 'session', sessionId: session.id }))

      const receivedX = waitForFrame(wsX, (f) => f.type === 'message')
      const receivedY = waitForFrame(wsY, (f) => f.type === 'message')

      // Give each pod's async subscribe handler time to complete its
      // NATS SUBSCRIBE round trip before publishing.
      await sleep(300)

      // Hits pod A's RPC surface, standing in for trpc-api's own call —
      // this is the actual thing under test, not a direct NATS publish.
      const msg = fakeMessage(session.id, 'hello from the pipeline')
      await rpcClientA.publishMessage(msg)

      const [messageX, messageY] = await Promise.all([receivedX, receivedY])

      // Both pods relayed the single publish to their own locally
      // connected client — this is the actual horizontal-scaling proof.
      const expectedFrame = expectedMessageFrame(msg)
      expect(messageX).toBe(expectedFrame)
      expect(messageY).toBe(expectedFrame)
    } finally {
      wsX.close()
      wsY.close()
    }
  })

  test('rejects a publish with a missing or wrong internal secret', async () => {
    const session = await db.insertInto('sessions').defaultValues().returningAll().executeTakeFirstOrThrow()
    const msg = fakeMessage(session.id, 'x')
    const url = `${rpcBaseUrlA}/mincirklen.internal.v1.InternalService/PublishMessage`

    const missing = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(msg),
    })
    expect(missing.status).toBe(403)

    const wrongSecret = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': 'not-the-secret' },
      body: JSON.stringify(msg),
    })
    expect(wrongSecret.status).toBe(403)
  })

  test('rejects a body that is not valid JSON', async () => {
    const url = `${rpcBaseUrlA}/mincirklen.internal.v1.InternalService/PublishMessage`

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_SERVICE_SECRET },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})

describe('/ws connection handshake', () => {
  test('rejects a connection with no session cookie', async () => {
    const res = await fetch(`http://localhost:${serverA.port}/ws`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    })

    expect(res.status).toBe(401)
  })

  test('rejects a connection from a disallowed origin', async () => {
    const user = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const token = createSessionToken(user.id, AUTH_SECRET)

    const { websocket } = await import('hono/bun')
    const restrictedApp = createApp({
      db,
      nats: natsA,
      redis: redisA,
      authSecret: AUTH_SECRET,
      allowedOrigins: ['https://mincirklen.dk'],
      internalServiceSecret: INTERNAL_SERVICE_SECRET,
      wireFormat: 'json',
    })
    const restrictedServer = Bun.serve({ port: 0, fetch: restrictedApp.fetch, websocket })

    try {
      const res = await fetch(`http://localhost:${restrictedServer.port}/ws`, {
        headers: {
          Cookie: `mc_session=${token}`,
          Upgrade: 'websocket',
          Connection: 'Upgrade',
          Origin: 'https://evil.example',
        },
      })
      expect(res.status).toBe(403)
    } finally {
      restrictedServer.stop(true)
    }
  })

  // A connection no longer names a session up front (see
  // wsController.ts's createWsGuard doc comment) — any authenticated
  // user can open one, so this now proves the handshake succeeds and
  // authorization is enforced later, at subscribe time (see the
  // 'subscribe protocol' describe block below).
  test('an authenticated connection with no subscriptions yet opens successfully', async () => {
    const user = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const token = createSessionToken(user.id, AUTH_SECRET)
    const ws = connectSocket(serverA.port, token)
    try {
      await waitForOpen(ws)
    } finally {
      ws.close()
    }
  })
})

// End-to-end proof that a whole connection can run in binary mode — the
// unit tests in wireFormat.test.ts only prove encodeFrame/decodeFrame
// round-trip in isolation; this proves actual Bun ServerWebSocket binary
// framing over the wire, through the real subscribe → NATS → relay path.
describe('binary wire format', () => {
  test('the hello frame is always plain JSON, and every frame after it is real binary', async () => {
    const { websocket } = await import('hono/bun')
    const binaryApp = createApp({
      db,
      nats: natsA,
      redis: redisA,
      authSecret: AUTH_SECRET,
      allowedOrigins: [],
      internalServiceSecret: INTERNAL_SERVICE_SECRET,
      wireFormat: 'binary',
    })
    const binaryServer = Bun.serve({ port: 0, fetch: binaryApp.fetch, websocket })

    const session = await db.insertInto('sessions').defaultValues().returningAll().executeTakeFirstOrThrow()
    const token = await createMemberAndToken(session.id, 0)
    const ws = connectSocket(binaryServer.port, token)
    ws.binaryType = 'arraybuffer'

    try {
      await waitForOpen(ws)

      // The hello frame arrives first, unprompted, and is always text —
      // readable before this connection has committed to anything.
      const helloRaw = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for hello')), 3000)
        ws.addEventListener(
          'message',
          (event) => {
            clearTimeout(timer)
            resolve(event.data as string)
          },
          { once: true },
        )
      })
      expect(typeof helloRaw).toBe('string')
      expect(JSON.parse(helloRaw)).toEqual({ type: 'hello', format: 'binary' })

      // Every frame from here on is msgpack-encoded — including this
      // connection's own outbound subscribe.
      ws.send(pack({ type: 'subscribe', scope: 'session', sessionId: session.id }))

      const messagePromise = new Promise<ArrayBuffer>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for a binary message frame')), 3000)
        function onMessage(event: MessageEvent) {
          if (!(event.data instanceof ArrayBuffer)) return
          const frame = unpack(new Uint8Array(event.data)) as { type: string }
          if (frame.type !== 'message') return
          clearTimeout(timer)
          ws.removeEventListener('message', onMessage)
          resolve(event.data)
        }
        ws.addEventListener('message', onMessage)
      })

      await sleep(300)

      // Publishing through pod A's RPC listener still reaches this
      // connection: NATS pub/sub doesn't care which "pod" made the call,
      // only that both share natsA — see rpcServerA's setup comment above.
      const msg = fakeMessage(session.id, 'binary mode round trip')
      await rpcClientA.publishMessage(msg)

      const messageBuffer = await messagePromise
      expect(unpack(new Uint8Array(messageBuffer))).toEqual({
        type: 'message',
        payload: { id: msg.messageId, sessionId: msg.sessionId, userId: msg.userId, body: msg.body, type: msg.type, createdAt: msg.createdAt },
      })
    } finally {
      ws.close()
      binaryServer.stop(true)
    }
  })
})

describe('subscribe protocol', () => {
  test('replies with an error frame to a frame it cannot parse — delivery-only contract for anything else', async () => {
    const user = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const token = createSessionToken(user.id, AUTH_SECRET)
    const ws = connectSocket(serverA.port, token)

    try {
      await waitForOpen(ws)
      const reply = waitForFrame(ws, (f) => f.type === 'error')
      ws.send('hello from the client')
      await reply
    } finally {
      ws.close()
    }
  })

  test('rejects a session-scope subscribe for a session the user is not a member of, with an error frame — no connection drop', async () => {
    const outsider = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const session = await db.insertInto('sessions').defaultValues().returningAll().executeTakeFirstOrThrow()
    const token = createSessionToken(outsider.id, AUTH_SECRET)
    const ws = connectSocket(serverA.port, token)

    try {
      await waitForOpen(ws)
      const reply = waitForFrame(ws, (f) => f.type === 'error')
      ws.send(JSON.stringify({ type: 'subscribe', scope: 'session', sessionId: session.id }))
      const frame = JSON.parse(await reply) as { type: string; message: string }
      expect(frame.message).toContain('not a member')
    } finally {
      ws.close()
    }
  })

  test('also relays presence (roster/turn/join) events onto the same connection as chat messages', async () => {
    const session = await db.insertInto('sessions').defaultValues().returningAll().executeTakeFirstOrThrow()
    const token = await createMemberAndToken(session.id)
    const ws = connectSocket(serverA.port, token)

    try {
      await waitForOpen(ws)
      ws.send(JSON.stringify({ type: 'subscribe', scope: 'session', sessionId: session.id }))

      // Give the presence subscription time to land before publishing —
      // same rationale as the message-fanout test above.
      await sleep(300)

      const received = waitForFrame(ws, (f) => f.type === 'participant-joined')
      const presencePayload = JSON.stringify({ type: 'participant-joined', sessionId: session.id, userId: 'someone-else', turnOrder: 3 })
      natsA.publish(presenceSubject(session.id), presencePayload)

      expect(await received).toBe(presencePayload)
    } finally {
      ws.close()
    }
  })

  test('a ping frame refreshes presence for every subscribed session without disrupting the connection', async () => {
    const session = await db.insertInto('sessions').defaultValues().returningAll().executeTakeFirstOrThrow()
    const token = await createMemberAndToken(session.id)
    const ws = connectSocket(serverA.port, token)

    try {
      await waitForOpen(ws)
      ws.send(JSON.stringify({ type: 'subscribe', scope: 'session', sessionId: session.id }))
      await sleep(300)

      ws.send(JSON.stringify({ type: 'ping' }))
      await sleep(300)

      // Still relaying normally after the heartbeat — proves the ping
      // didn't disrupt the connection or its subscriptions.
      const received = waitForFrame(ws, (f) => f.type === 'message')
      await rpcClientA.publishMessage(fakeMessage(session.id, 'after ping'))
      await received
    } finally {
      ws.close()
    }
  })

  test('shrinking a browse window unsubscribes sessions that fell out of it', async () => {
    const sessionA = await db.insertInto('sessions').defaultValues().returningAll().executeTakeFirstOrThrow()
    const sessionB = await db.insertInto('sessions').defaultValues().returningAll().executeTakeFirstOrThrow()
    const browserToken = createSessionToken((await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()).id, AUTH_SECRET)
    const ws = connectSocket(serverA.port, browserToken)

    try {
      await waitForOpen(ws)
      ws.send(JSON.stringify({ type: 'subscribe', scope: 'browse', sessionIds: [sessionA.id, sessionB.id] }))
      await sleep(300)

      // Shrinks the window to just sessionB — sessionA should be
      // unsubscribed as a result.
      ws.send(JSON.stringify({ type: 'subscribe', scope: 'browse', sessionIds: [sessionB.id] }))
      await sleep(300)

      let sawA = false
      ws.addEventListener('message', (event) => {
        const frame = JSON.parse(event.data as string) as { type: string; sessionId?: string }
        if (frame.type === 'live-count-changed' && frame.sessionId === sessionA.id) sawA = true
      })
      natsA.publish(presenceSubject(sessionA.id), JSON.stringify({ type: 'live-count-changed', sessionId: sessionA.id, count: 5 }))
      await sleep(300)

      expect(sawA).toBe(false)
    } finally {
      ws.close()
    }
  })

  test('a session-scope unsubscribe stops further chat-message relay for that session', async () => {
    const session = await db.insertInto('sessions').defaultValues().returningAll().executeTakeFirstOrThrow()
    const token = await createMemberAndToken(session.id)
    const ws = connectSocket(serverA.port, token)

    try {
      await waitForOpen(ws)
      ws.send(JSON.stringify({ type: 'subscribe', scope: 'session', sessionId: session.id }))
      await sleep(300)

      ws.send(JSON.stringify({ type: 'unsubscribe', scope: 'session', sessionId: session.id }))
      await sleep(300)

      let sawMessage = false
      ws.addEventListener('message', (event) => {
        const frame = JSON.parse(event.data as string) as { type: string }
        if (frame.type === 'message') sawMessage = true
      })

      natsA.publish(`room.${session.id}.messages`, JSON.stringify({ type: 'message', payload: { body: 'should not arrive' } }))
      await sleep(300)

      expect(sawMessage).toBe(false)
    } finally {
      ws.close()
    }
  })
})

describe('live participant counts', () => {
  test('a browse-scope subscription receives live-count-changed but never roster-update/participant-joined for that session', async () => {
    const session = await db.insertInto('sessions').defaultValues().returningAll().executeTakeFirstOrThrow()
    const browserToken = createSessionToken((await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()).id, AUTH_SECRET)
    const ws = connectSocket(serverA.port, browserToken)

    try {
      await waitForOpen(ws)
      const seenTypes: string[] = []
      ws.addEventListener('message', (event) => {
        const frame = JSON.parse(event.data as string) as { type: string }
        seenTypes.push(frame.type)
      })

      ws.send(JSON.stringify({ type: 'subscribe', scope: 'browse', sessionIds: [session.id] }))
      await sleep(300)

      natsA.publish(
        presenceSubject(session.id),
        JSON.stringify({ type: 'participant-joined', sessionId: session.id, userId: 'someone', turnOrder: 0 }),
      )
      natsA.publish(presenceSubject(session.id), JSON.stringify({ type: 'live-count-changed', sessionId: session.id, count: 2 }))
      await sleep(300)

      expect(seenTypes).toContain('live-count-changed')
      expect(seenTypes).not.toContain('participant-joined')
      // A browse-scope viewer hasn't joined this session — only the
      // aggregate count is theirs to see, never who specifically is
      // online (that would de-anonymize an anonymous circle to someone
      // outside it).
      expect(seenTypes).not.toContain('online-users-changed')
    } finally {
      ws.close()
    }
  })

  test('a session-scope subscriber sees exactly who else is online, live', async () => {
    const session = await db.insertInto('sessions').defaultValues().returningAll().executeTakeFirstOrThrow()
    const tokenX = await createMemberAndToken(session.id, 0)
    const tokenY = await createMemberAndToken(session.id, 1)

    const wsX = connectSocket(serverA.port, tokenX)
    const wsY = connectSocket(serverB.port, tokenY)

    try {
      await Promise.all([waitForOpen(wsX), waitForOpen(wsY)])
      wsX.send(JSON.stringify({ type: 'subscribe', scope: 'session', sessionId: session.id }))
      await sleep(300)

      const sawYOnline = waitForFrame(
        wsX,
        (f) => f.type === 'online-users-changed' && Array.isArray(f.userIds) && (f.userIds as string[]).length === 2,
      )
      wsY.send(JSON.stringify({ type: 'subscribe', scope: 'session', sessionId: session.id }))
      const joinFrame = JSON.parse(await sawYOnline) as { userIds: string[] }
      expect(joinFrame.userIds.sort()).toEqual([tokenX.split('.')[0], tokenY.split('.')[0]].sort())

      const sawYOffline = waitForFrame(
        wsX,
        (f) => f.type === 'online-users-changed' && Array.isArray(f.userIds) && (f.userIds as string[]).length === 1,
      )
      wsY.send(JSON.stringify({ type: 'unsubscribe', scope: 'session', sessionId: session.id }))
      const leaveFrame = JSON.parse(await sawYOffline) as { userIds: string[] }
      expect(leaveFrame.userIds).toEqual([tokenX.split('.')[0]])
    } finally {
      wsX.close()
      wsY.close()
    }
  })

  test('subscribing at session scope increases the live count, and unsubscribing decreases it — visible to a browse-scope watcher', async () => {
    const session = await db.insertInto('sessions').defaultValues().returningAll().executeTakeFirstOrThrow()
    const memberToken = await createMemberAndToken(session.id)
    const browserToken = createSessionToken((await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()).id, AUTH_SECRET)

    const wsBrowser = connectSocket(serverA.port, browserToken)
    const wsMember = connectSocket(serverB.port, memberToken)

    try {
      await Promise.all([waitForOpen(wsBrowser), waitForOpen(wsMember)])
      wsBrowser.send(JSON.stringify({ type: 'subscribe', scope: 'browse', sessionIds: [session.id] }))
      await sleep(300)

      const sawJoinCount = waitForFrame(wsBrowser, (f) => f.type === 'live-count-changed' && f.count === 1)
      wsMember.send(JSON.stringify({ type: 'subscribe', scope: 'session', sessionId: session.id }))
      await sawJoinCount

      const sawLeaveCount = waitForFrame(wsBrowser, (f) => f.type === 'live-count-changed' && f.count === 0)
      wsMember.send(JSON.stringify({ type: 'unsubscribe', scope: 'session', sessionId: session.id }))
      await sawLeaveCount
    } finally {
      wsBrowser.close()
      wsMember.close()
    }
  })

  test('a closed connection is counted as offline', async () => {
    const session = await db.insertInto('sessions').defaultValues().returningAll().executeTakeFirstOrThrow()
    const memberToken = await createMemberAndToken(session.id)
    const browserToken = createSessionToken((await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()).id, AUTH_SECRET)

    const wsBrowser = connectSocket(serverA.port, browserToken)
    const wsMember = connectSocket(serverB.port, memberToken)

    await Promise.all([waitForOpen(wsBrowser), waitForOpen(wsMember)])
    wsBrowser.send(JSON.stringify({ type: 'subscribe', scope: 'browse', sessionIds: [session.id] }))
    await sleep(300)

    const sawJoinCount = waitForFrame(wsBrowser, (f) => f.type === 'live-count-changed' && f.count === 1)
    wsMember.send(JSON.stringify({ type: 'subscribe', scope: 'session', sessionId: session.id }))
    await sawJoinCount

    const sawLeaveCount = waitForFrame(wsBrowser, (f) => f.type === 'live-count-changed' && f.count === 0)
    wsMember.close()
    await sawLeaveCount

    wsBrowser.close()
  })
})

describe('stuck turn self-healing', () => {
  test('subscribing while the current holder is offline immediately hands the turn to you', async () => {
    const session = await db.insertInto('sessions').defaultValues().returningAll().executeTakeFirstOrThrow()
    const aliceToken = await createMemberAndToken(session.id, 0)
    const bobToken = await createMemberAndToken(session.id, 1)
    const aliceUserId = aliceToken.split('.')[0] as string
    const bobUserId = bobToken.split('.')[0] as string

    // Turn state already exists (as if seeded earlier) with alice
    // holding it — alice never connects at all in this test, standing
    // in for a member who went offline and never came back.
    await seedTurnState(redisA, session.id, {
      currentTurnUserId: aliceUserId,
      roster: [
        { userId: aliceUserId, turnOrder: 0 },
        { userId: bobUserId, turnOrder: 1 },
      ],
    })

    const wsBob = connectSocket(serverB.port, bobToken)
    try {
      await waitForOpen(wsBob)
      const healed = waitForFrame(wsBob, (f) => f.type === 'roster-update' && f.currentTurnUserId === bobUserId)
      wsBob.send(JSON.stringify({ type: 'subscribe', scope: 'session', sessionId: session.id }))
      await healed // would time out if the round stayed stuck on alice
    } finally {
      wsBob.close()
    }
  })

  test('a subscribed member whose only other co-member disconnects gets healed onto them immediately', async () => {
    const session = await db.insertInto('sessions').defaultValues().returningAll().executeTakeFirstOrThrow()
    const aliceToken = await createMemberAndToken(session.id, 0)
    const bobToken = await createMemberAndToken(session.id, 1)
    const aliceUserId = aliceToken.split('.')[0] as string
    const bobUserId = bobToken.split('.')[0] as string

    await seedTurnState(redisA, session.id, {
      currentTurnUserId: aliceUserId,
      roster: [
        { userId: aliceUserId, turnOrder: 0 },
        { userId: bobUserId, turnOrder: 1 },
      ],
    })

    const wsAlice = connectSocket(serverA.port, aliceToken)
    const wsBob = connectSocket(serverB.port, bobToken)
    try {
      await Promise.all([waitForOpen(wsAlice), waitForOpen(wsBob)])
      wsAlice.send(JSON.stringify({ type: 'subscribe', scope: 'session', sessionId: session.id }))
      await sleep(300)
      wsBob.send(JSON.stringify({ type: 'subscribe', scope: 'session', sessionId: session.id }))
      await sleep(300)

      const healed = waitForFrame(wsBob, (f) => f.type === 'roster-update' && f.currentTurnUserId === bobUserId)
      wsAlice.close() // alice disconnects while still holding the turn
      await healed
    } finally {
      wsBob.close()
    }
  })
})

describe('/healthz', () => {
  test('reports ok', async () => {
    const res = await fetch(`http://localhost:${serverA.port}/healthz`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
  })
})
