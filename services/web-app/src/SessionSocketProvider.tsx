import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { pack, unpack } from 'msgpackr'
import type { SessionFrame } from './sessionSocketTypes'

// One persistent connection for every protected page a verified user
// visits (mounted once in App.tsx's Shell, gated on authStatus.kind ===
// 'verified') — replaces the old one-WebSocket-per-session-page model.
// Pages declare what they currently care about via subscribeSession /
// subscribeLiveCount; this provider owns turning that into the
// server's subscribe/unsubscribe protocol (see websocket-service's
// services/wsProtocol.ts for the frame shapes) and keeping the socket
// itself alive across whichever pages mount and unmount.
interface SessionSocketContextValue {
  // Returns an unsubscribe function. Multiple callers can subscribe to
  // the same sessionId concurrently (e.g. a fast double-render) — only
  // the first live listener triggers a `subscribe` frame, only the last
  // one leaving triggers `unsubscribe`.
  subscribeSession(sessionId: string, onFrame: (frame: SessionFrame) => void): () => void
  subscribeLiveCount(sessionId: string, onCount: (count: number) => void): () => void
  // Fires after every reconnect (never after the initial connect — a
  // caller's own mount-time fetch already covers that). NATS here is
  // core pub/sub with no replay, so a client that was disconnected can
  // have missed events entirely; resubscribing alone would leave it
  // silently stale. A subscriber should treat this as "go re-fetch a
  // fresh snapshot", not just "the socket is back."
  subscribeReconnect(onReconnect: () => void): () => void
}

const SessionSocketContext = createContext<SessionSocketContextValue | null>(null)

export function useSessionSocket(): SessionSocketContextValue {
  const ctx = useContext(SessionSocketContext)
  if (!ctx) throw new Error('useSessionSocket must be used within a SessionSocketProvider')
  return ctx
}

const RECONNECT_DELAY_MS = 2000
// Well under half of websocket-service's PRESENCE_STALE_AFTER_SECONDS
// (45s) — see packages/shared/src/constants/session.ts — so a couple of
// missed beats (a slow tab, a brief network blip) don't drop an
// otherwise-still-open connection's presence.
const HEARTBEAT_INTERVAL_MS = 20000

// websocket-service is a sibling subdomain (socket.<host>), not a path
// under this app's own origin — see local-infra/caddy/Caddyfile and
// docs/tech_spec.md's Load Balancer routing. mc_session reaches it
// automatically on the WS handshake because it's issued with a Domain
// attribute scoped to the shared parent host
// (services/trpc-api/src/context.ts).
function socketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//socket.${window.location.hostname}/ws`
}

export function SessionSocketProvider({ children }: { children: ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null)
  const cancelledRef = useRef(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const sessionListenersRef = useRef<Map<string, Set<(frame: SessionFrame) => void>>>(new Map())
  const liveCountListenersRef = useRef<Map<string, Set<(count: number) => void>>>(new Map())
  const reconnectListenersRef = useRef<Set<() => void>>(new Set())
  const hasConnectedOnceRef = useRef(false)

  // Negotiated per-connection from the server's `hello` frame (see
  // websocket-service's wireFormat.ts/wsController.ts) — this client
  // never has its own env-var setting for this; the server is the only
  // source of truth. Defaults to 'json' purely as the pre-hello initial
  // value; it's never actually used to encode anything until hello sets
  // it for real (see the queue below).
  const wireFormatRef = useRef<'json' | 'binary'>('json')
  const helloReceivedRef = useRef(false)
  // Frames sent after the socket opens but before hello has told us which
  // format to use — queued rather than dropped, and flushed the instant
  // hello arrives (a sub-millisecond window in practice, since hello is a
  // single synchronous send from the server's own onOpen).
  const pendingSendsRef = useRef<unknown[]>([])

  const send = useCallback((frame: unknown) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    if (!helloReceivedRef.current) {
      pendingSendsRef.current.push(frame)
      return
    }
    ws.send(wireFormatRef.current === 'json' ? JSON.stringify(frame) : pack(frame))
  }, [])

  // Re-sent on every (re)connect — a reconnect after a dropped
  // connection would otherwise leave the server blind to subscriptions
  // this client already believes are active until the next explicit
  // subscribe call (e.g. a page navigation).
  const resendSubscriptions = useCallback(() => {
    for (const sessionId of sessionListenersRef.current.keys()) {
      send({ type: 'subscribe', scope: 'session', sessionId })
    }
    const browseIds = [...liveCountListenersRef.current.keys()]
    if (browseIds.length > 0) send({ type: 'subscribe', scope: 'browse', sessionIds: browseIds })
  }, [send])

  useEffect(() => {
    cancelledRef.current = false

    // The socket isn't "live" for real traffic until hello tells us the
    // format — flushes whatever queued in send() while waiting, then runs
    // what onopen used to do directly (resend + reconnect listeners).
    function handleHello(format: 'json' | 'binary') {
      wireFormatRef.current = format
      helloReceivedRef.current = true
      const queued = pendingSendsRef.current
      pendingSendsRef.current = []
      for (const frame of queued) send(frame)

      resendSubscriptions()
      if (hasConnectedOnceRef.current) {
        reconnectListenersRef.current.forEach((cb) => cb())
      }
      hasConnectedOnceRef.current = true
    }

    function handleFrame(raw: unknown) {
      let frame: SessionFrame
      try {
        if (typeof raw === 'string') {
          const parsed = JSON.parse(raw) as { type: string; format?: 'json' | 'binary' }
          if (parsed.type === 'hello' && (parsed.format === 'json' || parsed.format === 'binary')) {
            handleHello(parsed.format)
            return
          }
          frame = parsed as SessionFrame
        } else {
          frame = unpack(new Uint8Array(raw as ArrayBuffer)) as SessionFrame
        }
      } catch {
        return
      }

      if (frame.type === 'live-count-changed') {
        const { sessionId, count } = frame as { sessionId: string; count: number }
        liveCountListenersRef.current.get(sessionId)?.forEach((cb) => cb(count))
        return
      }

      // Every other frame type carries sessionId at the top level,
      // except 'message' — see sessionSocketTypes.ts's MessageFrame doc
      // comment for why that one nests it under payload instead.
      const sessionId =
        frame.type === 'message'
          ? (frame as { payload?: { sessionId?: string } }).payload?.sessionId
          : (frame as { sessionId?: string }).sessionId
      if (typeof sessionId === 'string') {
        sessionListenersRef.current.get(sessionId)?.forEach((cb) => cb(frame))
      }
    }

    function connect() {
      if (cancelledRef.current) return
      const ws = new WebSocket(socketUrl())
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws
      helloReceivedRef.current = false
      pendingSendsRef.current = []
      // Deliberately no onopen handler beyond what the WebSocket API
      // itself needs — the socket isn't ready for real traffic until
      // handleFrame sees the hello frame (see handleHello above), not
      // merely once the transport-level connection is open.
      ws.onmessage = (event) => handleFrame(event.data as string | ArrayBuffer)
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null
        if (cancelledRef.current) return
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS)
      }
    }
    connect()

    heartbeatIntervalRef.current = setInterval(() => send({ type: 'ping' }), HEARTBEAT_INTERVAL_MS)

    return () => {
      cancelledRef.current = true
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [resendSubscriptions, send])

  const subscribeSession = useCallback(
    (sessionId: string, onFrame: (frame: SessionFrame) => void) => {
      let listeners = sessionListenersRef.current.get(sessionId)
      const isNew = !listeners
      if (!listeners) {
        listeners = new Set()
        sessionListenersRef.current.set(sessionId, listeners)
      }
      listeners.add(onFrame)
      if (isNew) send({ type: 'subscribe', scope: 'session', sessionId })

      return () => {
        const current = sessionListenersRef.current.get(sessionId)
        if (!current) return
        current.delete(onFrame)
        if (current.size === 0) {
          sessionListenersRef.current.delete(sessionId)
          send({ type: 'unsubscribe', scope: 'session', sessionId })
        }
      }
    },
    [send],
  )

  const subscribeLiveCount = useCallback(
    (sessionId: string, onCount: (count: number) => void) => {
      let listeners = liveCountListenersRef.current.get(sessionId)
      const isNew = !listeners
      if (!listeners) {
        listeners = new Set()
        liveCountListenersRef.current.set(sessionId, listeners)
      }
      listeners.add(onCount)
      if (isNew) send({ type: 'subscribe', scope: 'browse', sessionIds: [...liveCountListenersRef.current.keys()] })

      return () => {
        const current = liveCountListenersRef.current.get(sessionId)
        if (!current) return
        current.delete(onCount)
        if (current.size === 0) {
          liveCountListenersRef.current.delete(sessionId)
          // The client always sends its entire desired window (see
          // websocket-service's wsProtocol.ts) — a shrink is just
          // resending the smaller set, not a separate frame type.
          send({ type: 'subscribe', scope: 'browse', sessionIds: [...liveCountListenersRef.current.keys()] })
        }
      }
    },
    [send],
  )

  const subscribeReconnect = useCallback((onReconnect: () => void) => {
    reconnectListenersRef.current.add(onReconnect)
    return () => {
      reconnectListenersRef.current.delete(onReconnect)
    }
  }, [])

  const value = useMemo(
    () => ({ subscribeSession, subscribeLiveCount, subscribeReconnect }),
    [subscribeSession, subscribeLiveCount, subscribeReconnect],
  )

  return <SessionSocketContext.Provider value={value}>{children}</SessionSocketContext.Provider>
}
