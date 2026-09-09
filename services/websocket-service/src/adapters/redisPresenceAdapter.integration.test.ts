import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { Redis } from 'ioredis'
import { getOnlineUserIds, markOffline, markOnline } from './redisPresenceAdapter'

let redis: Redis

beforeAll(() => {
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
})

afterAll(async () => {
  redis.disconnect()
})

let usedKeys: string[] = []
afterEach(async () => {
  if (usedKeys.length > 0) await redis.del(...usedKeys)
  usedKeys = []
})

function freshSessionId(): string {
  const id = crypto.randomUUID()
  usedKeys.push(`session:${id}:online`)
  return id
}

describe('markOnline / getOnlineUserIds', () => {
  test('a fresh session with nobody online returns an empty list', async () => {
    const sessionId = freshSessionId()
    expect(await getOnlineUserIds(redis, sessionId, 0)).toEqual([])
  })

  test('lists distinct users marked online', async () => {
    const sessionId = freshSessionId()
    const now = Date.now()
    await markOnline(redis, sessionId, 'user-1', now)
    await markOnline(redis, sessionId, 'user-2', now)

    expect((await getOnlineUserIds(redis, sessionId, 0)).sort()).toEqual(['user-1', 'user-2'])
  })

  test('marking the same user online twice does not duplicate it', async () => {
    const sessionId = freshSessionId()
    await markOnline(redis, sessionId, 'user-1', Date.now())
    await markOnline(redis, sessionId, 'user-1', Date.now())

    expect(await getOnlineUserIds(redis, sessionId, 0)).toEqual(['user-1'])
  })

  test('a heartbeat refresh moves an entry\'s score forward past a staleness floor', async () => {
    const sessionId = freshSessionId()
    await markOnline(redis, sessionId, 'user-1', 1000)
    expect(await getOnlineUserIds(redis, sessionId, 2000)).toEqual([])

    await markOnline(redis, sessionId, 'user-1', 3000)
    expect(await getOnlineUserIds(redis, sessionId, 2000)).toEqual(['user-1'])
  })

  test('an entry older than the staleness floor is excluded', async () => {
    const sessionId = freshSessionId()
    await markOnline(redis, sessionId, 'user-1', 1000)

    expect(await getOnlineUserIds(redis, sessionId, 5000)).toEqual([])
  })
})

describe('markOffline', () => {
  test('removes exactly the given user, leaving others listed', async () => {
    const sessionId = freshSessionId()
    const now = Date.now()
    await markOnline(redis, sessionId, 'user-1', now)
    await markOnline(redis, sessionId, 'user-2', now)

    await markOffline(redis, sessionId, 'user-1')

    expect(await getOnlineUserIds(redis, sessionId, 0)).toEqual(['user-2'])
  })

  test('is a no-op for a user who was never online', async () => {
    const sessionId = freshSessionId()
    await markOffline(redis, sessionId, 'user-1')

    expect(await getOnlineUserIds(redis, sessionId, 0)).toEqual([])
  })
})

// Backstop for a connection that vanishes without a clean close (crash,
// killed dev server) and so never calls markOffline — without this, its
// entry would sit in Redis forever even though every reader already
// treats a stale-scored entry as offline.
describe('markOnline TTL safety net', () => {
  test('sets a finite TTL on the online key, not -1 (no expiry)', async () => {
    const sessionId = freshSessionId()
    await markOnline(redis, sessionId, 'user-1', Date.now())

    expect(await redis.ttl(`session:${sessionId}:online`)).toBeGreaterThan(0)
  })
})
