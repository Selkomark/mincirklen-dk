import { fastify, type FastifyInstance } from 'fastify'
import * as Sentry from '@sentry/bun'
import { fastifyConnectPlugin } from '@connectrpc/connect-fastify'
import { Code, ConnectError, type ConnectRouter, type Interceptor } from '@connectrpc/connect'
import { InternalService } from '@mincirklen/proto'
import { PRESENCE_STALE_AFTER_SECONDS, TURN_CLAIM_STALE_AFTER_SECONDS } from '@mincirklen/shared'
import type { AppEnv } from './context'
import { publishMessage, publishPresenceEvent } from './adapters/natsAdapter'
import { getOnlineUserIds } from './adapters/redisPresenceAdapter'
import {
  advanceTurn as advanceTurnRedis,
  appendToRoster,
  claimTurn as claimTurnRedis,
  getTurnState as getRedisTurnState,
  releaseTurnClaim as releaseTurnClaimRedis,
  seedTurnState,
} from './adapters/redisTurnStateAdapter'
import { getPostgresTurnState, writeBackAdvancedTurn, writeBackClaimedTurn } from './repositories/sessionStateRepository'
import { publishToRoom } from './services/roomRelayService'
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
} from './services/turnService'

const INTERNAL_SECRET_HEADER = 'x-internal-secret'

function turnServiceDeps(env: AppEnv): TurnServiceDeps {
  return {
    getRedisTurnState: (sessionId) => getRedisTurnState(env.redis, sessionId),
    seedTurnState: (sessionId, initial) => seedTurnState(env.redis, sessionId, initial),
    appendToRoster: (sessionId, userId, turnOrder) => appendToRoster(env.redis, sessionId, userId, turnOrder),
    claimTurnRedis: (sessionId, userId) =>
      claimTurnRedis(env.redis, sessionId, userId, TURN_CLAIM_STALE_AFTER_SECONDS * 1000),
    releaseTurnClaimRedis: (sessionId) => releaseTurnClaimRedis(env.redis, sessionId),
    advanceTurnRedis: (sessionId) => advanceTurnRedis(env.redis, sessionId, PRESENCE_STALE_AFTER_SECONDS * 1000),
    getPostgresTurnState: (sessionId) => getPostgresTurnState(env.db, sessionId),
  }
}

// Same three failure cases internalController.ts's mapTurnErrorToResponse
// used to map to 404/403/409 — Connect's Code enum carries the same
// meaning across the wire (confirmed in the migration spike: NotFound ->
// 404, PermissionDenied -> 403, AlreadyExists -> 409), so
// websocketServiceAdapter.ts on the trpc-api side can reconstruct its own
// identically-named error classes straight from `err.code`, no HTTP
// status sniffing needed.
function toConnectError(err: unknown): ConnectError {
  if (err instanceof SessionNotFoundError) return new ConnectError(err.message, Code.NotFound)
  if (err instanceof NotYourTurnError) return new ConnectError(err.message, Code.PermissionDenied)
  if (err instanceof TurnAlreadyClaimedError) return new ConnectError(err.message, Code.AlreadyExists)
  throw err
}

// fastifyConnectPlugin catches every handler's thrown error itself, to
// format the Connect-protocol wire response — it never lets one escape
// as a Fastify-level exception, so Sentry.setupFastifyErrorHandler below
// never sees these (same reason trpc-api's app.ts needs its own onError
// hook instead of relying on the generic Hono middleware). An
// interceptor runs *inside* that boundary, before the error is
// swallowed. Only reports the unexpected case: the three ConnectErrors
// toConnectError deliberately produces are handled business outcomes
// (session gone, not your turn, already claimed), not crashes — same
// "expected vs. actually broke" distinction sessionRouter.ts's own
// toTRPCError draws on the trpc-api side of this exact call.
const EXPECTED_CODES: Code[] = [Code.NotFound, Code.PermissionDenied, Code.AlreadyExists]

const sentryInterceptor: Interceptor = (next) => async (req) => {
  try {
    return await next(req)
  } catch (err) {
    const isExpected = err instanceof ConnectError && EXPECTED_CODES.includes(err.code)
    if (!isExpected) Sentry.captureException(err)
    throw err
  }
}

function routes(env: AppEnv) {
  return (router: ConnectRouter) =>
    router.service(InternalService, {
      // trpc-api's only path to fan a chat message out, now that it no
      // longer talks to NATS directly (see sessionRouter.ts's sendMessage
      // and websocketServiceAdapter.ts on the trpc-api side).
      async publishMessage(req) {
        publishToRoom(
          { publish: (p) => publishMessage(env.nats, req.sessionId, { type: 'message', payload: p }) },
          {
            id: req.messageId,
            sessionId: req.sessionId,
            userId: req.userId,
            body: req.body,
            type: req.type,
            createdAt: req.createdAt,
          },
        )
        return {}
      },

      async getTurnState(req) {
        try {
          const state = await getTurnState(turnServiceDeps(env), req.sessionId)
          // First-paint presence — see wsController.ts's subscribeBrowse
          // for the identical "never block on this, but don't leave it
          // stale either" shape.
          const onlineUserIds = await getOnlineUserIds(env.redis, req.sessionId, Date.now() - PRESENCE_STALE_AFTER_SECONDS * 1000)
          return {
            currentTurnUserId: state.currentTurnUserId ?? '',
            roster: state.roster.map((entry) => ({ userId: entry.userId, turnOrder: entry.turnOrder })),
            onlineUserIds,
          }
        } catch (err) {
          throw toConnectError(err)
        }
      },

      async joinRoster(req) {
        try {
          await joinTurn(turnServiceDeps(env), req.sessionId, req.userId, req.turnOrder)
        } catch (err) {
          throw toConnectError(err)
        }

        // Cross-pod fanout — see natsAdapter.ts's publishPresenceEvent.
        // Carries turnOrder directly so a client can label the joiner
        // ("Member N") from this event alone; roster-update below is a
        // separate frame a client must never depend on having landed
        // first.
        publishPresenceEvent(env.nats, req.sessionId, {
          type: 'participant-joined',
          sessionId: req.sessionId,
          userId: req.userId,
          turnOrder: req.turnOrder,
        })
        const state = await getRedisTurnState(env.redis, req.sessionId)
        if (state) {
          publishPresenceEvent(env.nats, req.sessionId, { type: 'roster-update', sessionId: req.sessionId, ...state })
        }

        return {}
      },

      // trpc-api's only path to fan out a profile change live — pure
      // cross-pod relay, no Redis/Postgres write here (displayName is
      // already fully resolved on trpc-api's side).
      async notifyProfileUpdated(req) {
        publishPresenceEvent(env.nats, req.sessionId, {
          type: 'member-profile-updated',
          sessionId: req.sessionId,
          userId: req.userId,
          displayName: req.displayName ?? null,
        })
        return {}
      },

      async claimTurn(req) {
        try {
          await claimTurn(turnServiceDeps(env), req.sessionId, req.userId)
        } catch (err) {
          throw toConnectError(err)
        }

        // Fire-and-forget crash-recovery mirror — see
        // sessionStateRepository.ts's writeBackClaimedTurn comment. Must
        // never delay or fail this response: the claim already succeeded
        // in Redis, which is authoritative.
        void writeBackClaimedTurn(env.db, req.sessionId, new Date()).catch((err) => {
          console.error('[TURN] failed to write back a claimed turn to Postgres', err)
        })

        return {}
      },

      async releaseTurnClaim(req) {
        await releaseTurnClaim(turnServiceDeps(env), req.sessionId)
        return {}
      },

      async advanceTurn(req) {
        const nextTurnUserId = await advanceTurn(turnServiceDeps(env), req.sessionId)

        // Fire-and-forget — see claimTurn's identical rationale above.
        void writeBackAdvancedTurn(env.db, req.sessionId, nextTurnUserId).catch((err) => {
          console.error('[TURN] failed to write back an advanced turn to Postgres', err)
        })

        // See joinRoster's identical cross-pod fanout rationale above.
        const state = await getRedisTurnState(env.redis, req.sessionId)
        if (state) {
          publishPresenceEvent(env.nats, req.sessionId, { type: 'roster-update', sessionId: req.sessionId, ...state })
        }

        return { nextTurnUserId: nextTurnUserId ?? '' }
      },
    })
}

// This service is publicly routable (unlike moderation-service — see
// docker-compose.yml), but this RPC listener is a second, internal-only
// port never published to the host (mirrors moderation-service's own
// "never public" posture) — so a network-isolation argument doesn't
// apply here either, same reasoning as the REST guard this replaces
// (controllers/internalController.ts's createInternalGuard, now removed).
export function createRpcServer(env: AppEnv): FastifyInstance {
  const server = fastify()

  // Reuses the single process-wide Sentry client app.ts's sentry()
  // middleware already initialized (including fastifyIntegration) —
  // this just wires error capture onto this specific Fastify instance,
  // it doesn't re-init.
  Sentry.setupFastifyErrorHandler(server)

  server.addHook('onRequest', async (request, reply) => {
    if (request.headers[INTERNAL_SECRET_HEADER] !== env.internalServiceSecret) {
      await reply.code(403).send('forbidden')
    }
  })

  server.register(fastifyConnectPlugin, { routes: routes(env), interceptors: [sentryInterceptor] })

  return server
}
