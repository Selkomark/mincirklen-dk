import type { ClaimTurnResult, TurnState } from '../adapters/redisTurnStateAdapter'

// Local to this service — never crosses the process boundary as an
// object, only as a Connect error code (see rpcServer.ts's toConnectError).
// trpc-api's own sessionRepository.ts keeps its own identically-named
// classes for exactly the same errors on its side of that boundary; they
// don't need to be the same class, just the same meaning.
export class SessionNotFoundError extends Error {
  constructor(message: string) {
    super(message)
  }
}
export class NotYourTurnError extends Error {
  constructor(message: string) {
    super(message)
  }
}
export class TurnAlreadyClaimedError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export interface TurnServiceDeps {
  getRedisTurnState(sessionId: string): Promise<TurnState | null>
  seedTurnState(sessionId: string, initial: TurnState): Promise<boolean>
  appendToRoster(sessionId: string, userId: string, turnOrder: number): Promise<void>
  claimTurnRedis(sessionId: string, userId: string): Promise<ClaimTurnResult>
  releaseTurnClaimRedis(sessionId: string): Promise<void>
  advanceTurnRedis(sessionId: string): Promise<string | null>
  getPostgresTurnState(sessionId: string): Promise<TurnState | null>
}

// Read-through: Redis is authoritative once it has anything for this
// session; only touches Postgres (and seeds Redis from it) the first
// time this session's turn state is ever asked for.
export async function getTurnState(deps: TurnServiceDeps, sessionId: string): Promise<TurnState> {
  const existing = await deps.getRedisTurnState(sessionId)
  if (existing !== null) return existing

  const postgresState = await deps.getPostgresTurnState(sessionId)
  if (postgresState === null) {
    throw new SessionNotFoundError(`session ${sessionId} not found`)
  }

  await deps.seedTurnState(sessionId, postgresState)
  return postgresState
}

// Called after trpc-api's own Postgres join has already committed — seeds
// Redis from the now-current Postgres state (a no-op if already seeded,
// per seedTurnState's own guard) and appends this member (a no-op if the
// seed above already included them, since ZADD with the same score is
// idempotent) — always doing both is simpler and just as correct as
// branching on which one is actually needed.
export async function joinTurn(deps: TurnServiceDeps, sessionId: string, userId: string, turnOrder: number): Promise<void> {
  const postgresState = await deps.getPostgresTurnState(sessionId)
  if (postgresState === null) {
    throw new SessionNotFoundError(`session ${sessionId} not found`)
  }

  await deps.seedTurnState(sessionId, postgresState)
  await deps.appendToRoster(sessionId, userId, turnOrder)
}

export async function claimTurn(deps: TurnServiceDeps, sessionId: string, userId: string): Promise<void> {
  const result = await deps.claimTurnRedis(sessionId, userId)
  if (result === 'not_found') {
    throw new SessionNotFoundError(`session ${sessionId} not found`)
  }
  if (result === 'not_your_turn') {
    throw new NotYourTurnError(`user ${userId} does not hold the turn for session ${sessionId}`)
  }
  if (result === 'already_claimed') {
    throw new TurnAlreadyClaimedError(`turn for session ${sessionId} is already claimed`)
  }
}

export async function releaseTurnClaim(deps: TurnServiceDeps, sessionId: string): Promise<void> {
  await deps.releaseTurnClaimRedis(sessionId)
}

export async function advanceTurn(deps: TurnServiceDeps, sessionId: string): Promise<string | null> {
  return deps.advanceTurnRedis(sessionId)
}
