import { describe, expect, test } from 'bun:test'
import type { TurnState } from '../adapters/redisTurnStateAdapter'
import {
  NotYourTurnError,
  SessionNotFoundError,
  TurnAlreadyClaimedError,
  advanceTurn,
  claimTurn,
  getTurnState,
  joinTurn,
  releaseTurnClaim,
  type TurnServiceDeps,
} from './turnService'

function makeDeps(overrides: Partial<TurnServiceDeps> = {}): TurnServiceDeps {
  return {
    getRedisTurnState: async () => null,
    seedTurnState: async () => true,
    appendToRoster: async () => {},
    claimTurnRedis: async () => 'ok',
    releaseTurnClaimRedis: async () => {},
    advanceTurnRedis: async () => null,
    getPostgresTurnState: async () => null,
    ...overrides,
  }
}

describe('getTurnState', () => {
  test('returns the Redis state directly when it already exists — no Postgres read', async () => {
    const redisState: TurnState = { currentTurnUserId: 'alice', roster: [{ userId: 'alice', turnOrder: 0 }] }
    let postgresCalled = false
    const deps = makeDeps({
      getRedisTurnState: async () => redisState,
      getPostgresTurnState: async () => {
        postgresCalled = true
        return null
      },
    })

    expect(await getTurnState(deps, 's1')).toEqual(redisState)
    expect(postgresCalled).toBe(false)
  })

  test('seeds from Postgres and returns it when Redis has nothing yet', async () => {
    const postgresState: TurnState = { currentTurnUserId: 'alice', roster: [{ userId: 'alice', turnOrder: 0 }] }
    let seededWith: TurnState | undefined
    const deps = makeDeps({
      getRedisTurnState: async () => null,
      getPostgresTurnState: async () => postgresState,
      seedTurnState: async (_id, initial) => {
        seededWith = initial
        return true
      },
    })

    expect(await getTurnState(deps, 's1')).toEqual(postgresState)
    expect(seededWith).toEqual(postgresState)
  })

  test('throws SessionNotFoundError when neither Redis nor Postgres has this session', async () => {
    const deps = makeDeps({ getRedisTurnState: async () => null, getPostgresTurnState: async () => null })
    await expect(getTurnState(deps, 's1')).rejects.toThrow(SessionNotFoundError)
  })
})

describe('joinTurn', () => {
  test('seeds from the current Postgres state, then appends the new member (idempotent either way)', async () => {
    const postgresState: TurnState = {
      currentTurnUserId: 'alice',
      roster: [
        { userId: 'alice', turnOrder: 0 },
        { userId: 'bob', turnOrder: 1 },
      ],
    }
    let seededWith: TurnState | undefined
    let appended: { userId: string; turnOrder: number } | undefined
    const deps = makeDeps({
      getPostgresTurnState: async () => postgresState,
      seedTurnState: async (_id, initial) => {
        seededWith = initial
        return true
      },
      appendToRoster: async (_id, userId, turnOrder) => {
        appended = { userId, turnOrder }
      },
    })

    await joinTurn(deps, 's1', 'bob', 1)

    expect(seededWith).toEqual(postgresState)
    expect(appended).toEqual({ userId: 'bob', turnOrder: 1 })
  })

  test('throws SessionNotFoundError when the session does not exist in Postgres either', async () => {
    const deps = makeDeps({ getPostgresTurnState: async () => null })
    await expect(joinTurn(deps, 's1', 'bob', 1)).rejects.toThrow(SessionNotFoundError)
  })
})

describe('claimTurn', () => {
  test('resolves when the caller holds the turn', async () => {
    const deps = makeDeps({ claimTurnRedis: async () => 'ok' })
    await expect(claimTurn(deps, 's1', 'alice')).resolves.toBeUndefined()
  })

  test('throws NotYourTurnError when someone else holds it', async () => {
    const deps = makeDeps({ claimTurnRedis: async () => 'not_your_turn' })
    await expect(claimTurn(deps, 's1', 'bob')).rejects.toThrow(NotYourTurnError)
  })

  test('throws TurnAlreadyClaimedError for a fresh outstanding claim', async () => {
    const deps = makeDeps({ claimTurnRedis: async () => 'already_claimed' })
    await expect(claimTurn(deps, 's1', 'alice')).rejects.toThrow(TurnAlreadyClaimedError)
  })

  test('throws SessionNotFoundError when Redis has no turn state for this session', async () => {
    const deps = makeDeps({ claimTurnRedis: async () => 'not_found' })
    await expect(claimTurn(deps, 's1', 'alice')).rejects.toThrow(SessionNotFoundError)
  })
})

describe('releaseTurnClaim', () => {
  test('delegates to the injected release call', async () => {
    let released: string | undefined
    const deps = makeDeps({
      releaseTurnClaimRedis: async (sessionId) => {
        released = sessionId
      },
    })
    await releaseTurnClaim(deps, 's1')
    expect(released).toBe('s1')
  })
})

describe('advanceTurn', () => {
  test('returns the new turn holder', async () => {
    const deps = makeDeps({ advanceTurnRedis: async () => 'bob' })
    expect(await advanceTurn(deps, 's1')).toBe('bob')
  })

  test('returns null for an empty roster', async () => {
    const deps = makeDeps({ advanceTurnRedis: async () => null })
    expect(await advanceTurn(deps, 's1')).toBeNull()
  })
})
