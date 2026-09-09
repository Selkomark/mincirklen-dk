import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { Redis } from 'ioredis'
import {
  advanceTurn,
  appendToRoster,
  claimTurn,
  clearTurnState,
  getTurnState,
  healStuckTurn,
  releaseTurnClaim,
  seedTurnState,
} from './redisTurnStateAdapter'

// Runs the real Lua scripts against a real Redis (docker-compose's redis
// service, or REDIS_URL if pointed elsewhere) — the compare-and-swap
// semantics these scripts provide are exactly the thing worth verifying
// against the genuine article, not a JS reimplementation of the same
// logic that would just test itself.
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
  usedKeys.push(`session:${id}:turn`, `session:${id}:roster`, `session:${id}:online`)
  return id
}

// Long enough that a test's own timing never accidentally goes stale.
const PRESENCE_STALE_AFTER_MS = 45000

function markOnline(sessionId: string, userId: string): Promise<number> {
  return redis.zadd(`session:${sessionId}:online`, Date.now(), userId)
}

describe('seedTurnState', () => {
  test('seeds the turn cursor and roster when nothing exists yet, and returns true', async () => {
    const sessionId = freshSessionId()
    const seeded = await seedTurnState(redis, sessionId, {
      currentTurnUserId: 'alice',
      roster: [
        { userId: 'alice', turnOrder: 0 },
        { userId: 'bob', turnOrder: 1 },
      ],
    })
    expect(seeded).toBe(true)

    const state = await getTurnState(redis, sessionId)
    expect(state).toEqual({
      currentTurnUserId: 'alice',
      roster: [
        { userId: 'alice', turnOrder: 0 },
        { userId: 'bob', turnOrder: 1 },
      ],
    })
  })

  test('is a no-op and returns false when turn state already exists', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, { currentTurnUserId: 'alice', roster: [{ userId: 'alice', turnOrder: 0 }] })

    const seeded = await seedTurnState(redis, sessionId, { currentTurnUserId: 'someone-else', roster: [] })
    expect(seeded).toBe(false)

    const state = await getTurnState(redis, sessionId)
    expect(state?.currentTurnUserId).toBe('alice')
  })

  test('seeds a null current turn as null, not the string "null"', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, { currentTurnUserId: null, roster: [] })
    const state = await getTurnState(redis, sessionId)
    expect(state?.currentTurnUserId).toBeNull()
    expect(state?.roster).toEqual([])
  })

  test('two concurrent seeds for the same session race safely — exactly one wins', async () => {
    const sessionId = freshSessionId()
    const [a, b] = await Promise.all([
      seedTurnState(redis, sessionId, { currentTurnUserId: 'alice', roster: [{ userId: 'alice', turnOrder: 0 }] }),
      seedTurnState(redis, sessionId, { currentTurnUserId: 'bob', roster: [{ userId: 'bob', turnOrder: 0 }] }),
    ])
    expect([a, b].filter(Boolean)).toHaveLength(1)
  })
})

describe('getTurnState', () => {
  test('returns null when nothing has ever been seeded for this session', async () => {
    expect(await getTurnState(redis, crypto.randomUUID())).toBeNull()
  })
})

describe('appendToRoster', () => {
  test('adds a new member without disturbing the existing turn cursor', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, { currentTurnUserId: 'alice', roster: [{ userId: 'alice', turnOrder: 0 }] })

    await appendToRoster(redis, sessionId, 'bob', 1)

    const state = await getTurnState(redis, sessionId)
    expect(state).toEqual({
      currentTurnUserId: 'alice',
      roster: [
        { userId: 'alice', turnOrder: 0 },
        { userId: 'bob', turnOrder: 1 },
      ],
    })
  })
})

describe('claimTurn', () => {
  test('returns "ok" and records the claim when the caller holds the turn', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, { currentTurnUserId: 'alice', roster: [{ userId: 'alice', turnOrder: 0 }] })

    expect(await claimTurn(redis, sessionId, 'alice', 15000)).toBe('ok')
  })

  test('returns "not_your_turn" for anyone else', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, { currentTurnUserId: 'alice', roster: [{ userId: 'alice', turnOrder: 0 }] })

    expect(await claimTurn(redis, sessionId, 'bob', 15000)).toBe('not_your_turn')
  })

  test('returns "already_claimed" for a fresh claim, then "ok" again once it goes stale', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, { currentTurnUserId: 'alice', roster: [{ userId: 'alice', turnOrder: 0 }] })

    expect(await claimTurn(redis, sessionId, 'alice', 15000)).toBe('ok')
    expect(await claimTurn(redis, sessionId, 'alice', 15000)).toBe('already_claimed')
    // A 0ms stale window means "immediately stale" — proves the aging
    // check itself works, without a real sleep in the test.
    expect(await claimTurn(redis, sessionId, 'alice', 0)).toBe('ok')
  })

  test('returns "not_found" for a session with no seeded turn state', async () => {
    expect(await claimTurn(redis, crypto.randomUUID(), 'alice', 15000)).toBe('not_found')
  })

  test('two concurrent claims for the same held turn — exactly one succeeds', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, { currentTurnUserId: 'alice', roster: [{ userId: 'alice', turnOrder: 0 }] })

    const results = await Promise.all([
      claimTurn(redis, sessionId, 'alice', 15000),
      claimTurn(redis, sessionId, 'alice', 15000),
    ])
    expect(results.filter((r) => r === 'ok')).toHaveLength(1)
    expect(results.filter((r) => r === 'already_claimed')).toHaveLength(1)
  })
})

describe('releaseTurnClaim', () => {
  test('clears the claim so a subsequent claimTurn succeeds again immediately', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, { currentTurnUserId: 'alice', roster: [{ userId: 'alice', turnOrder: 0 }] })
    await claimTurn(redis, sessionId, 'alice', 15000)

    await releaseTurnClaim(redis, sessionId)

    expect(await claimTurn(redis, sessionId, 'alice', 15000)).toBe('ok')
  })
})

describe('advanceTurn', () => {
  test('moves to the next member in turn order, wrapping around', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, {
      currentTurnUserId: 'alice',
      roster: [
        { userId: 'alice', turnOrder: 0 },
        { userId: 'bob', turnOrder: 1 },
      ],
    })

    expect(await advanceTurn(redis, sessionId, PRESENCE_STALE_AFTER_MS)).toBe('bob')
    expect(await advanceTurn(redis, sessionId, PRESENCE_STALE_AFTER_MS)).toBe('alice')
  })

  test('clears any outstanding claim on the new turn holder', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, {
      currentTurnUserId: 'alice',
      roster: [
        { userId: 'alice', turnOrder: 0 },
        { userId: 'bob', turnOrder: 1 },
      ],
    })
    await claimTurn(redis, sessionId, 'alice', 15000)

    await advanceTurn(redis, sessionId, PRESENCE_STALE_AFTER_MS)

    expect(await claimTurn(redis, sessionId, 'bob', 15000)).toBe('ok')
  })

  test('returns null for an empty roster', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, { currentTurnUserId: null, roster: [] })
    expect(await advanceTurn(redis, sessionId, PRESENCE_STALE_AFTER_MS)).toBeNull()
  })

  test('starts at the first roster member when nobody currently holds the turn', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, {
      currentTurnUserId: null,
      roster: [
        { userId: 'alice', turnOrder: 0 },
        { userId: 'bob', turnOrder: 1 },
      ],
    })
    expect(await advanceTurn(redis, sessionId, PRESENCE_STALE_AFTER_MS)).toBe('alice')
  })

  test('when nobody has ever been online, still advances plainly to the next in line', async () => {
    // Matches every test above: no markOnline call anywhere, so the
    // online set is empty — proves the "fall back to plain next-in-line"
    // branch keeps today's pre-presence behavior intact by default.
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, {
      currentTurnUserId: 'alice',
      roster: [
        { userId: 'alice', turnOrder: 0 },
        { userId: 'bob', turnOrder: 1 },
        { userId: 'carol', turnOrder: 2 },
      ],
    })
    expect(await advanceTurn(redis, sessionId, PRESENCE_STALE_AFTER_MS)).toBe('bob')
  })

  test('skips an offline member and lands on the next online one', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, {
      currentTurnUserId: 'alice',
      roster: [
        { userId: 'alice', turnOrder: 0 },
        { userId: 'bob', turnOrder: 1 },
        { userId: 'carol', turnOrder: 2 },
      ],
    })
    // bob is offline; alice and carol are online — advancing from alice
    // must skip straight past bob to carol, not stall on bob.
    await markOnline(sessionId, 'alice')
    await markOnline(sessionId, 'carol')

    expect(await advanceTurn(redis, sessionId, PRESENCE_STALE_AFTER_MS)).toBe('carol')
  })

  test('skips multiple consecutive offline members', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, {
      currentTurnUserId: 'alice',
      roster: [
        { userId: 'alice', turnOrder: 0 },
        { userId: 'bob', turnOrder: 1 },
        { userId: 'carol', turnOrder: 2 },
        { userId: 'dave', turnOrder: 3 },
      ],
    })
    // bob and carol are both offline — only dave (and alice, wrapping) are online.
    await markOnline(sessionId, 'alice')
    await markOnline(sessionId, 'dave')

    expect(await advanceTurn(redis, sessionId, PRESENCE_STALE_AFTER_MS)).toBe('dave')
    expect(await advanceTurn(redis, sessionId, PRESENCE_STALE_AFTER_MS)).toBe('alice')
  })

  test('falls back to the plain next-in-line when every member is offline', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, {
      currentTurnUserId: 'alice',
      roster: [
        { userId: 'alice', turnOrder: 0 },
        { userId: 'bob', turnOrder: 1 },
      ],
    })
    // Nobody marked online at all — the round shouldn't lock up entirely
    // just because everyone's currently disconnected.
    expect(await advanceTurn(redis, sessionId, PRESENCE_STALE_AFTER_MS)).toBe('bob')
  })

  test('a stale (past the presence window) online entry counts as offline', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, {
      currentTurnUserId: 'alice',
      roster: [
        { userId: 'alice', turnOrder: 0 },
        { userId: 'bob', turnOrder: 1 },
        { userId: 'carol', turnOrder: 2 },
      ],
    })
    await redis.zadd(`session:${sessionId}:online`, Date.now() - 100000, 'bob') // long past any reasonable staleness window
    await markOnline(sessionId, 'carol')

    expect(await advanceTurn(redis, sessionId, PRESENCE_STALE_AFTER_MS)).toBe('carol')
  })
})

describe('clearTurnState', () => {
  test('removes both the turn hash and the roster set', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, {
      currentTurnUserId: 'alice',
      roster: [{ userId: 'alice', turnOrder: 0 }],
    })

    await clearTurnState(redis, sessionId)

    expect(await getTurnState(redis, sessionId)).toBeNull()
    expect(await redis.exists(`session:${sessionId}:roster`)).toBe(0)
  })

  test('is a harmless no-op for a session with no turn state at all', async () => {
    const sessionId = freshSessionId()
    await clearTurnState(redis, sessionId)
    expect(await getTurnState(redis, sessionId)).toBeNull()
  })

  test('a rejoin after clearing reseeds cleanly rather than seeing stale data', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, {
      currentTurnUserId: 'alice',
      roster: [{ userId: 'alice', turnOrder: 0 }],
    })
    await clearTurnState(redis, sessionId)

    const seeded = await seedTurnState(redis, sessionId, {
      currentTurnUserId: 'bob',
      roster: [{ userId: 'bob', turnOrder: 0 }],
    })
    expect(seeded).toBe(true)
    expect(await getTurnState(redis, sessionId)).toEqual({ currentTurnUserId: 'bob', roster: [{ userId: 'bob', turnOrder: 0 }] })
  })
})

describe('healStuckTurn', () => {
  test('hands the turn to the next online member when the current holder is offline', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, {
      currentTurnUserId: 'alice',
      roster: [
        { userId: 'alice', turnOrder: 0 },
        { userId: 'bob', turnOrder: 1 },
      ],
    })
    // alice (the current holder) is offline; bob is online.
    await markOnline(sessionId, 'bob')

    expect(await healStuckTurn(redis, sessionId, PRESENCE_STALE_AFTER_MS)).toBe('bob')
    expect((await getTurnState(redis, sessionId))?.currentTurnUserId).toBe('bob')
  })

  test('is a no-op when the current holder is genuinely online', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, {
      currentTurnUserId: 'alice',
      roster: [
        { userId: 'alice', turnOrder: 0 },
        { userId: 'bob', turnOrder: 1 },
      ],
    })
    await markOnline(sessionId, 'alice')
    await markOnline(sessionId, 'bob')

    expect(await healStuckTurn(redis, sessionId, PRESENCE_STALE_AFTER_MS)).toBeNull()
    expect((await getTurnState(redis, sessionId))?.currentTurnUserId).toBe('alice')
  })

  test('is a no-op when nobody else is online to hand off to either', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, {
      currentTurnUserId: 'alice',
      roster: [
        { userId: 'alice', turnOrder: 0 },
        { userId: 'bob', turnOrder: 1 },
      ],
    })
    // Nobody marked online at all — nothing to heal into.

    expect(await healStuckTurn(redis, sessionId, PRESENCE_STALE_AFTER_MS)).toBeNull()
    expect((await getTurnState(redis, sessionId))?.currentTurnUserId).toBe('alice')
  })

  test('skips multiple consecutive offline members to find the next online one', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, {
      currentTurnUserId: 'alice',
      roster: [
        { userId: 'alice', turnOrder: 0 },
        { userId: 'bob', turnOrder: 1 },
        { userId: 'carol', turnOrder: 2 },
        { userId: 'dave', turnOrder: 3 },
      ],
    })
    // alice, bob, and carol are all offline; only dave is online.
    await markOnline(sessionId, 'dave')

    expect(await healStuckTurn(redis, sessionId, PRESENCE_STALE_AFTER_MS)).toBe('dave')
  })

  test('a stale (past the presence window) entry for the current holder still counts as offline', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, {
      currentTurnUserId: 'alice',
      roster: [
        { userId: 'alice', turnOrder: 0 },
        { userId: 'bob', turnOrder: 1 },
      ],
    })
    await redis.zadd(`session:${sessionId}:online`, Date.now() - 100000, 'alice') // long past any reasonable staleness window
    await markOnline(sessionId, 'bob')

    expect(await healStuckTurn(redis, sessionId, PRESENCE_STALE_AFTER_MS)).toBe('bob')
  })

  test('returns null for a session with no turn state at all', async () => {
    expect(await healStuckTurn(redis, crypto.randomUUID(), PRESENCE_STALE_AFTER_MS)).toBeNull()
  })
})

// A backstop against exactly the failure clearTurnState can't catch: a
// process that dies (crash, redeploy, killed dev server) never gets a
// chance to observe a clean "online count hit zero" and run it, so
// without a TTL these keys would sit in Redis forever. Every touch below
// should keep both keys' TTL positive and finite, not -1 (no expiry).
describe('TTL safety net', () => {
  test('seedTurnState sets a TTL on both the turn and roster keys', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, { currentTurnUserId: 'alice', roster: [{ userId: 'alice', turnOrder: 0 }] })

    expect(await redis.ttl(`session:${sessionId}:turn`)).toBeGreaterThan(0)
    expect(await redis.ttl(`session:${sessionId}:roster`)).toBeGreaterThan(0)
  })

  test('appendToRoster sets a TTL on the roster key', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, { currentTurnUserId: 'alice', roster: [{ userId: 'alice', turnOrder: 0 }] })
    await appendToRoster(redis, sessionId, 'bob', 1)

    expect(await redis.ttl(`session:${sessionId}:roster`)).toBeGreaterThan(0)
  })

  test('claimTurn refreshes the TTL on the turn key', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, { currentTurnUserId: 'alice', roster: [{ userId: 'alice', turnOrder: 0 }] })
    await claimTurn(redis, sessionId, 'alice', 15000)

    expect(await redis.ttl(`session:${sessionId}:turn`)).toBeGreaterThan(0)
  })

  test('advanceTurn refreshes the TTL on both the turn and roster keys', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, {
      currentTurnUserId: 'alice',
      roster: [
        { userId: 'alice', turnOrder: 0 },
        { userId: 'bob', turnOrder: 1 },
      ],
    })
    await advanceTurn(redis, sessionId, PRESENCE_STALE_AFTER_MS)

    expect(await redis.ttl(`session:${sessionId}:turn`)).toBeGreaterThan(0)
    expect(await redis.ttl(`session:${sessionId}:roster`)).toBeGreaterThan(0)
  })

  test('healStuckTurn refreshes the TTL on both the turn and roster keys', async () => {
    const sessionId = freshSessionId()
    await seedTurnState(redis, sessionId, {
      currentTurnUserId: 'alice',
      roster: [
        { userId: 'alice', turnOrder: 0 },
        { userId: 'bob', turnOrder: 1 },
      ],
    })
    await markOnline(sessionId, 'bob')
    await healStuckTurn(redis, sessionId, PRESENCE_STALE_AFTER_MS)

    expect(await redis.ttl(`session:${sessionId}:turn`)).toBeGreaterThan(0)
    expect(await redis.ttl(`session:${sessionId}:roster`)).toBeGreaterThan(0)
  })
})
