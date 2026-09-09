import { Code, ConnectError, createClient, type Client, type Interceptor } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-node'
import { InternalService } from '@mincirklen/proto'
import type { MessageRow } from '../repositories/messageRepository'
import { NotYourTurnError, SessionNotFoundError, TurnAlreadyClaimedError, type RosterEntry } from '../repositories/sessionRepository'

export async function checkWebsocketServiceHealth(baseUrl: string): Promise<void> {
  const res = await fetch(`${baseUrl}/healthz`)
  if (!res.ok) {
    throw new Error(`status ${res.status}`)
  }
}

// Explicit constructor: see the same note in repositories/sessionRepository.ts.
export class WebsocketServiceError extends Error {
  constructor(message: string) {
    super(message)
  }
}

// One Connect client per distinct baseUrl, built lazily and reused across
// calls — avoids reconstructing a transport (and its underlying
// connection pool) on every single call, while every exported function
// below still takes `baseUrl` as a plain argument like before (no change
// needed anywhere these are called from — see sessionRouter.ts).
const clients = new Map<string, Client<typeof InternalService>>()

function clientFor(baseUrl: string, internalServiceSecret: string): Client<typeof InternalService> {
  const existing = clients.get(baseUrl)
  if (existing) return existing

  // Same secret header websocket-service's rpcServer.ts guard expects —
  // this service is publicly routable (unlike moderation-service), so
  // that surface needs its own auth rather than relying on network
  // isolation. Attached via an interceptor rather than baked into the
  // client at construction time so a caller could in principle pass a
  // different secret per call, matching the old per-call parameter.
  const authInterceptor: Interceptor = (next) => (req) => {
    req.header.set('x-internal-secret', internalServiceSecret)
    return next(req)
  }

  const client = createClient(
    InternalService,
    createConnectTransport({ httpVersion: '1.1', baseUrl, interceptors: [authInterceptor] }),
  )
  clients.set(baseUrl, client)
  return client
}

// websocket-service's rpcServer.ts maps these same three failure cases to
// Code.NotFound/PermissionDenied/AlreadyExists (see its toConnectError) —
// reconstructed here as the exact same error classes trpc-api's own
// toTRPCError (sessionRouter.ts) already maps to the right tRPC codes, so
// callers on this side don't need to know the boundary crossed a process.
function throwForTurnError(err: unknown, sessionId: string): never {
  if (err instanceof ConnectError) {
    if (err.code === Code.NotFound) throw new SessionNotFoundError(`session ${sessionId} not found`)
    if (err.code === Code.PermissionDenied) throw new NotYourTurnError(`user does not hold the turn for session ${sessionId}`)
    if (err.code === Code.AlreadyExists) throw new TurnAlreadyClaimedError(`turn for session ${sessionId} is already claimed`)
  }
  throw new WebsocketServiceError(err instanceof Error ? err.message : String(err))
}

// Relays an already-persisted, already-approved chat message to
// websocket-service for live delivery — sessionRouter.ts calls this
// fire-and-forget (never awaited into the send-message response) so a
// relay failure can never fail or delay sendMessage: the message is
// durably in Postgres by the time this runs, and a participant who missed
// the live push still sees it on their next resync (see
// sessionShared.tsx's useSessionChat).
export async function publishMessage(
  baseUrl: string,
  internalServiceSecret: string,
  sessionId: string,
  payload: MessageRow,
): Promise<void> {
  try {
    await clientFor(baseUrl, internalServiceSecret).publishMessage({
      sessionId,
      messageId: payload.id,
      userId: payload.userId,
      body: payload.body,
      type: payload.type,
      createdAt: payload.createdAt.toISOString(),
    })
  } catch (err) {
    throw new WebsocketServiceError(err instanceof Error ? err.message : String(err))
  }
}

// Redis (via websocket-service) is now the live authority for
// currentTurnUserId/roster — see sessionService.ts's getSessionState,
// which composes this with a Postgres read for session lifecycle status
// (the one piece that's still Postgres's own concern).
export async function getTurnState(
  baseUrl: string,
  internalServiceSecret: string,
  sessionId: string,
): Promise<{ currentTurnUserId: string | null; roster: RosterEntry[]; onlineUserIds: string[] }> {
  try {
    const res = await clientFor(baseUrl, internalServiceSecret).getTurnState({ sessionId })
    return {
      currentTurnUserId: res.currentTurnUserId === '' ? null : res.currentTurnUserId,
      roster: res.roster.map((entry) => ({ userId: entry.userId, turnOrder: entry.turnOrder })),
      onlineUserIds: res.onlineUserIds,
    }
  } catch (err) {
    return throwForTurnError(err, sessionId)
  }
}

// Called after trpc-api's own Postgres join has already committed (both
// `join` and `visit` in sessionRouter.ts) — fire-and-forget, same
// rationale as publishMessage: if this doesn't land, the next getState
// read-through seeds Redis fresh from Postgres anyway (which already has
// this member by the time this call is even made), so a missed/failed
// notify only means a very slightly later live update, never a
// correctness gap.
export async function notifyJoined(
  baseUrl: string,
  internalServiceSecret: string,
  sessionId: string,
  userId: string,
  turnOrder: number,
): Promise<void> {
  try {
    await clientFor(baseUrl, internalServiceSecret).joinRoster({ sessionId, userId, turnOrder })
  } catch (err) {
    throwForTurnError(err, sessionId)
  }
}

// Fire-and-forget, same rationale as notifyJoined above — a missed or
// failed relay just means other viewers see the updated name a little
// later (their next getState poll re-resolves it fresh regardless, see
// userProfileRepository.ts's findDisplayNames), never a correctness gap.
// displayName is already the final, resolved value (null means "show as
// anonymous") — this call is a pure relay, not a lookup.
export async function notifyProfileUpdated(
  baseUrl: string,
  internalServiceSecret: string,
  sessionId: string,
  userId: string,
  displayName: string | null,
): Promise<void> {
  try {
    await clientFor(baseUrl, internalServiceSecret).notifyProfileUpdated({
      sessionId,
      userId,
      displayName: displayName ?? undefined,
    })
  } catch (err) {
    throw new WebsocketServiceError(err instanceof Error ? err.message : String(err))
  }
}

export async function claimTurn(baseUrl: string, internalServiceSecret: string, sessionId: string, userId: string): Promise<void> {
  try {
    await clientFor(baseUrl, internalServiceSecret).claimTurn({ sessionId, userId })
  } catch (err) {
    throwForTurnError(err, sessionId)
  }
}

export async function releaseTurnClaim(baseUrl: string, internalServiceSecret: string, sessionId: string): Promise<void> {
  try {
    await clientFor(baseUrl, internalServiceSecret).releaseTurnClaim({ sessionId })
  } catch (err) {
    throwForTurnError(err, sessionId)
  }
}

export async function advanceTurn(baseUrl: string, internalServiceSecret: string, sessionId: string): Promise<void> {
  try {
    await clientFor(baseUrl, internalServiceSecret).advanceTurn({ sessionId })
  } catch (err) {
    throwForTurnError(err, sessionId)
  }
}
