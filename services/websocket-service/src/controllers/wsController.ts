import { upgradeWebSocket } from 'hono/bun'
import type { Context as HonoContext, MiddlewareHandler } from 'hono'
import type { WSContext } from 'hono/ws'
import { PRESENCE_STALE_AFTER_SECONDS } from '@mincirklen/shared'
import { isAllowedOrigin, resolveUserId, type AppEnv } from '../context'
import { publishPresenceEvent, subscribeToPresence, subscribeToRoom } from '../adapters/natsAdapter'
import { getOnlineUserIds, markOffline, markOnline } from '../adapters/redisPresenceAdapter'
import { clearTurnState, getTurnState as getRedisTurnState, healStuckTurn } from '../adapters/redisTurnStateAdapter'
import { isSessionMember } from '../repositories/sessionMembershipRepository'
import { writeBackAdvancedTurn } from '../repositories/sessionStateRepository'
import { isAuthorizedToJoinRoom, relayMessages } from '../services/roomRelayService'
import { joinPresence, leavePresence, type PresenceServiceDeps } from '../services/presenceService'
import { isLiveCountFrame, parseClientFrame } from '../services/wsProtocol'
import { decodeFrame, encodeFrame, reencodeForClient } from '../services/wireFormat'

// Runs before the upgrade completes. Only identity is checked here now —
// unlike the one-connection-per-session model this replaced, a single
// connection now persists across every protected page a user visits (see
// web-app's SessionSocketProvider), so which sessions it's authorized to
// see is no longer knowable at handshake time. Per-session authorization
// moves to subscribe-time instead — see subscribeSession below.
export function createWsGuard(env: AppEnv): MiddlewareHandler {
  return async (c, next) => {
    if (!isAllowedOrigin(c.req.header('origin') ?? null, env.allowedOrigins)) {
      return c.text('forbidden origin', 403)
    }
    if (!resolveUserId(c, env.authSecret)) {
      return c.text('unauthorized', 401)
    }
    return next()
  }
}

function readOnlineUserIds(env: AppEnv, sessionId: string): Promise<string[]> {
  return getOnlineUserIds(env.redis, sessionId, Date.now() - PRESENCE_STALE_AFTER_SECONDS * 1000)
}

function presenceServiceDeps(env: AppEnv): PresenceServiceDeps {
  return {
    markOnline: (sessionId, userId) => markOnline(env.redis, sessionId, userId, Date.now()),
    markOffline: (sessionId, userId) => markOffline(env.redis, sessionId, userId),
    getOnlineUserIds: (sessionId) => readOnlineUserIds(env, sessionId),
    publishLiveCount: (sessionId, count) => publishPresenceEvent(env.nats, sessionId, { type: 'live-count-changed', sessionId, count }),
    // Never relayed to browse-scope viewers — see subscribeBrowse's own
    // comment and wsProtocol.ts's isLiveCountFrame filter, which this
    // event type deliberately does not match.
    publishOnlineUsers: (sessionId, userIds) =>
      publishPresenceEvent(env.nats, sessionId, { type: 'online-users-changed', sessionId, userIds }),
    clearTurnState: (sessionId) => clearTurnState(env.redis, sessionId),
  }
}

// A round can get stuck holding the turn for someone who's offline —
// advanceTurn only ever skips an offline member while actively handing
// the turn on, it never rescues a round that already landed on one
// (nobody else can claim/advance a turn that isn't theirs). Called
// fire-and-forget after every presence change (subscribe, unsubscribe,
// and the recurring heartbeat), so a stuck round self-heals within one
// heartbeat interval of anyone else being in the room, with no action
// needed from the offline holder. A genuine no-op when the current
// holder is actually online — see healStuckTurn's own doc comment.
async function healStuckTurnAndNotify(env: AppEnv, sessionId: string): Promise<void> {
  const nextTurnUserId = await healStuckTurn(env.redis, sessionId, PRESENCE_STALE_AFTER_SECONDS * 1000)
  if (!nextTurnUserId) return

  void writeBackAdvancedTurn(env.db, sessionId, nextTurnUserId).catch((err) => {
    console.error('[TURN] failed to write back a healed turn to Postgres', err)
  })

  const state = await getRedisTurnState(env.redis, sessionId)
  if (state) {
    publishPresenceEvent(env.nats, sessionId, { type: 'roster-update', sessionId, ...state })
  }
}

function healStuckTurnFireAndForget(env: AppEnv, sessionId: string): void {
  void healStuckTurnAndNotify(env, sessionId).catch((err) => {
    console.error('[TURN] failed to heal a possibly-stuck turn', err)
  })
}

export function createWsHandler(env: AppEnv) {
  return upgradeWebSocket((c: HonoContext) => {
    // The guard above already validated this.
    const userId = resolveUserId(c, env.authSecret) as string

    const sessionSubs = new Map<string, { unsubscribeRoom: () => void; unsubscribePresence: () => void }>()
    const browseSubs = new Map<string, () => void>()

    async function subscribeSession(ws: WSContext, sessionId: string): Promise<void> {
      // Already subscribed (a duplicate subscribe from a client resync,
      // say) — a no-op rather than double-subscribing to NATS or double-
      // counting this connection's presence.
      if (sessionSubs.has(sessionId)) return

      const authorized = await isAuthorizedToJoinRoom({
        isSessionMember: () => isSessionMember(env.db, sessionId, userId),
      })
      if (!authorized) {
        ws.send(encodeFrame(env.wireFormat, { type: 'error', message: `not a member of session ${sessionId}` }))
        return
      }

      // Two independent NATS subscriptions relayed onto the same socket
      // — chat messages (roomSubject) and roster/turn/join/live-count
      // events (presenceSubject). Both are already typed frames by the
      // time they reach here, so the client demuxes by `type`. NATS
      // carries canonical JSON regardless of this connection's own wire
      // format (see wireFormat.ts) — reencodeForClient transcodes at this
      // one per-connection edge.
      const room = subscribeToRoom(env.nats, sessionId)
      void relayMessages(room.messages, (data) => ws.send(reencodeForClient(env.wireFormat, data)))
      const presence = subscribeToPresence(env.nats, sessionId)
      void relayMessages(presence.messages, (data) => ws.send(reencodeForClient(env.wireFormat, data)))
      sessionSubs.set(sessionId, { unsubscribeRoom: room.unsubscribe, unsubscribePresence: presence.unsubscribe })

      await joinPresence(presenceServiceDeps(env), sessionId, userId)
      // Catches the exact case from a stale page load: the round was
      // already stuck on an offline holder before this viewer ever
      // showed up.
      healStuckTurnFireAndForget(env, sessionId)
    }

    function unsubscribeSession(sessionId: string): void {
      const sub = sessionSubs.get(sessionId)
      if (!sub) return
      sub.unsubscribeRoom()
      sub.unsubscribePresence()
      sessionSubs.delete(sessionId)

      // Fire-and-forget — must never block the unsubscribe/close from
      // completing on a Redis/NATS hiccup. Presence is self-healing via
      // PRESENCE_STALE_AFTER_SECONDS if this genuinely fails. Sequenced
      // (not two independent fire-and-forgets) so the heal check always
      // runs after this connection's own markOffline has actually
      // landed — otherwise it could still see this connection's user as
      // online and skip a handoff that should have happened immediately
      // if they were the turn holder.
      void leavePresence(presenceServiceDeps(env), sessionId, userId)
        .catch((err) => {
          console.error('[PRESENCE] failed to mark a session offline', err)
        })
        .then(() => healStuckTurnFireAndForget(env, sessionId))
    }

    async function subscribeBrowse(ws: WSContext, sessionId: string): Promise<void> {
      if (browseSubs.has(sessionId)) return
      const presence = subscribeToPresence(env.nats, sessionId)
      void relayMessages(presence.messages, (data) => {
        // A browse-scope viewer hasn't joined this session — never relay
        // roster/turn/join detail to them, only the aggregate count. This
        // filter still peeks the raw NATS JSON string (isLiveCountFrame is
        // unaffected by any connection's own wire format, since NATS
        // itself stays JSON-only — see wireFormat.ts).
        if (isLiveCountFrame(data)) ws.send(reencodeForClient(env.wireFormat, data))
      })
      browseSubs.set(sessionId, presence.unsubscribe)

      // Without this, a fresh browse subscriber only ever hears about a
      // count *change* — nobody joining or leaving while they're
      // watching means they'd be stuck on the stale first-paint DB
      // joinedCount indefinitely, never actually catching up to live
      // truth. Sent directly to this connection (not published), since
      // it's a snapshot for this one new watcher, not a state change.
      const userIds = await readOnlineUserIds(env, sessionId)
      ws.send(encodeFrame(env.wireFormat, { type: 'live-count-changed', sessionId, count: userIds.length }))
    }

    // The client sends its entire desired browse window on every change
    // (see wsProtocol.ts's ClientFrame doc comment) — diff against what
    // this connection already has subscribed rather than requiring a
    // separate incremental unsubscribe frame.
    function setBrowseWindow(ws: WSContext, sessionIds: string[]): void {
      const next = new Set(sessionIds)
      for (const sessionId of [...browseSubs.keys()]) {
        if (!next.has(sessionId)) {
          browseSubs.get(sessionId)?.()
          browseSubs.delete(sessionId)
        }
      }
      for (const sessionId of next) {
        void subscribeBrowse(ws, sessionId)
      }
    }

    // Refreshes presence for every session this connection currently
    // holds a live subscription to — keeps an idling-but-still-open tab
    // counted, without needing the client to resend individual subscribe
    // frames just to stay "online".
    function heartbeat(): void {
      for (const sessionId of sessionSubs.keys()) {
        void joinPresence(presenceServiceDeps(env), sessionId, userId)
          .catch((err) => {
            console.error('[PRESENCE] failed to refresh a heartbeat', err)
          })
          // The recurring ~20s tick every viewer's connection sends —
          // this is what guarantees a round stuck on an offline holder
          // self-heals even when nobody takes any explicit action, not
          // just at subscribe/unsubscribe moments.
          .then(() => healStuckTurnFireAndForget(env, sessionId))
      }
    }

    return {
      // Always plain JSON text, regardless of env.wireFormat — this is
      // the one frame every connection can decode before it's learned
      // which format the rest of the socket uses. See wireFormat.ts's
      // doc comment and SessionSocketProvider.tsx's matching client-side
      // handling (queues outbound sends until this arrives).
      onOpen(_evt, ws) {
        ws.send(JSON.stringify({ type: 'hello', format: env.wireFormat }))
      },
      onMessage(evt, ws) {
        const decoded = decodeFrame(env.wireFormat, evt.data as string | ArrayBufferLike)
        const frame = parseClientFrame(decoded)
        if (!frame) {
          ws.send(encodeFrame(env.wireFormat, { type: 'error', message: 'unrecognized frame' }))
          return
        }

        if (frame.type === 'subscribe' && frame.scope === 'session') {
          void subscribeSession(ws, frame.sessionId)
        } else if (frame.type === 'unsubscribe' && frame.scope === 'session') {
          unsubscribeSession(frame.sessionId)
        } else if (frame.type === 'subscribe' && frame.scope === 'browse') {
          setBrowseWindow(ws, frame.sessionIds)
        } else if (frame.type === 'ping') {
          heartbeat()
        }
      },
      onClose() {
        for (const sessionId of [...sessionSubs.keys()]) {
          unsubscribeSession(sessionId)
        }
        for (const unsubscribe of browseSubs.values()) {
          unsubscribe()
        }
      },
    }
  })
}
