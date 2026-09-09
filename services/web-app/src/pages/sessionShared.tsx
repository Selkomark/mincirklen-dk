import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionSocket } from '../SessionSocketProvider'
import type {
  MemberProfileUpdatedFrame,
  MessageFrame,
  OnlineUsersFrame,
  ParticipantJoinedFrame,
  RosterUpdateFrame,
  SessionFrame,
} from '../sessionSocketTypes'

export interface Topic {
  id: string
  slug: string
  label: string
}

export type SessionStatus = 'forming' | 'active' | 'completed' | 'cancelled'

export interface SessionSummary {
  id: string
  status: SessionStatus
  name: string | null
  scheduledAt: string | null
  durationMinutes: number | null
  capacity: number | null
  joinedCount: number
  topic: Topic | null
}

export interface RecentVisit {
  id: string
  status: SessionStatus
  name: string | null
  scheduledAt: string | null
  durationMinutes: number | null
  topic: Topic | null
  lastVisitedAt: string
}

// Same fallback as pages/start/shared.tsx's displayName — kept as its own
// copy (not imported) because RecentVisit's topic is nullable (the
// ad-hoc turn-based flow's sessions can show up in visit history, unlike
// /start/join's browse list, which only ever lists topic-having circles).
export function visitDisplayName(visit: { name: string | null; topic: Topic | null }): string {
  return visit.name ?? (visit.topic ? `${visit.topic.label} circle` : 'Session')
}

async function postTrpc<T>(path: string, input: unknown): Promise<T> {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    // 400 alongside 404: a malformed sessionId (e.g. a hand-edited or
    // truncated URL) fails the router's z.string().uuid() input check
    // before the resolver ever runs, distinctly from a well-formed but
    // nonexistent id (404) — but to the user both are just "not a real
    // session", so both read as not_found rather than a scary 500.
    const message = res.status === 404 || res.status === 400 ? 'not_found' : res.status === 409 ? 'full' : 'error'
    throw new Error(message)
  }
  const body = (await res.json()) as { result: { data: T } }
  return body.result.data
}

async function getTrpc<T>(path: string, input: unknown): Promise<T> {
  const search = new URLSearchParams({ input: JSON.stringify(input) })
  const res = await fetch(`/api/trpc/${path}?${search.toString()}`)
  if (!res.ok) throw new Error('error')
  const body = (await res.json()) as { result: { data: T } }
  return body.result.data
}

// Read-only existence check, called first (before the guidelines gate) —
// session.getSummary is a query (GET), not a mutation, so this goes
// through the same query path as getTrpc rather than postTrpc, but with
// postTrpc's 404 -> 'not_found' error mapping so callers can branch on
// it the same way. No join, no visit recorded — a dead link never makes
// it as far as asking the user to click through community guidelines.
export async function getSessionSummary(sessionId: string): Promise<SessionSummary> {
  const search = new URLSearchParams({ input: JSON.stringify({ sessionId }) })
  const res = await fetch(`/api/trpc/session.getSummary?${search.toString()}`)
  if (!res.ok) {
    // 400 alongside 404 — see postTrpc's matching comment above.
    throw new Error(res.status === 404 || res.status === 400 ? 'not_found' : 'error')
  }
  const body = (await res.json()) as { result: { data: SessionSummary } }
  return body.result.data
}

export function visitSession(sessionId: string): Promise<SessionSummary> {
  return postTrpc('session.visit', { sessionId })
}

// Called only after visitSession above has joined the user — the
// community-guidelines agreement lives on this session's own
// session_users row now (not a user-level flag), so that row has to
// exist first. `agreedKeys` is every required key this user has already
// agreed to anywhere (this session or another), auto-synced onto this
// session's row — CommunityGuidelinesModal pre-checks exactly these, so
// a returning user is never asked to re-agree to something they've
// covered, even if a newly-added key means `agreed` still comes back
// false.
export function checkGuidelines(sessionId: string): Promise<{ agreed: boolean; agreedKeys: string[] }> {
  return postTrpc('session.checkGuidelines', { sessionId })
}

export function agreeToGuidelines(sessionId: string): Promise<{ agreed: true }> {
  return postTrpc('session.agreeToGuidelines', { sessionId })
}

// ReportSessionModal's submit — postTrpc's generic error mapping is fine
// here (unlike skipTurn's SkipTurnNotYourTurnError case above), since a
// 403 can't happen through the modal's normal flow: aboutUserIds only
// ever comes from the caller's own already-fetched roster.
export function submitSessionReport(sessionId: string, aboutUserIds: string[], body: string): Promise<{ status: 'submitted' }> {
  return postTrpc('session.report', { sessionId, aboutUserIds, body })
}

// The report-icon button next to the sender's own flag/crisis message
// (SessionPage.tsx's MessageRow). Only ever touches the caller's own
// message — the server-side guard (messageRepository.ts's
// reportFalsePositive) is what actually enforces that, this is just the
// client call.
export function reportFalsePositive(sessionId: string, messageId: string): Promise<{ status: 'reported' }> {
  return postTrpc('session.reportFalsePositive', { sessionId, messageId })
}

// Thrown specifically for a 403 — the turn isn't (or is no longer) the
// caller's to skip. Distinguished from a generic failure so
// SessionPage.tsx's autoSkipTurn can tell "someone/something else
// already handled this exact turn" (e.g. the same account open in two
// tabs, both racing their own local countdown — one wins, the other
// correctly 403s) apart from a real failure worth alarming the user
// about.
export class SkipTurnNotYourTurnError extends Error {
  constructor() {
    super('not your turn to skip')
  }
}

// session.sendMessage's own equivalent of the race SkipTurnNotYourTurnError
// covers above: the same account open in more than one tab/window each
// runs its own local auto-send countdown, and if two race to claim/send
// the same turn, the loser gets this back — sessionRouter.ts's
// toTRPCError only ever maps a sendMessage failure to CONFLICT for
// TurnAlreadyClaimedError (SessionFullError's CONFLICT is join-only, an
// unreachable cause here), so a 409 from this specific call always means
// "someone/something else already handled this exact turn", never a
// real failure. Distinguished so SessionPage.tsx's sendNow can treat
// it the same quiet way autoSkipTurn already treats its own case.
export class SendMessageConflictError extends Error {
  constructor() {
    super('turn already claimed by another request')
  }
}

// The turn-inactivity countdown's auto-skip outcome (see
// useTurnCountdown below) — forfeits an unresponsive turn to the next
// (online) member. No body, unlike sendMessage: nothing is persisted.
// Not routed through postTrpc: that helper's error mapping doesn't
// distinguish a 403 from any other failure, and this call specifically
// needs to (see SkipTurnNotYourTurnError above).
export async function skipTurn(sessionId: string): Promise<{ status: 'skipped' }> {
  const res = await fetch('/api/trpc/session.skipTurn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })
  if (!res.ok) {
    if (res.status === 403) throw new SkipTurnNotYourTurnError()
    throw new Error('error')
  }
  const body = (await res.json()) as { result: { data: { status: 'skipped' } } }
  return body.result.data
}

export function useWhoAmI(): { userId: string | null; loading: boolean } {
  const [state, setState] = useState<{ userId: string | null; loading: boolean }>({ userId: null, loading: true })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { userId } = await getTrpc<{ userId: string }>('auth.whoAmI', undefined)
        if (!cancelled) setState({ userId, loading: false })
      } catch {
        if (!cancelled) setState({ userId: null, loading: false })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

// Same 1s debounce + backend search semantics as pages/start/shared.tsx's
// useOpenSessions — but forward-only "load more" pagination (a plain
// growing list plus a button) instead of the bidirectional windowed
// infinite-scroll that page uses, since this is a personal history list,
// not an open-ended browse surface.
const SEARCH_DEBOUNCE_MS = 1000

// `refreshKey` (SessionPage.tsx bumps a nonce via SessionCenterPanel's
// onVisited, once a visit is actually recorded server-side — not on
// every sessionId change, which would race ahead of the visit call and
// refetch a stale sort order) triggers a silent background refetch when
// it changes, separately from the search effect below — so visiting a
// session updates this list's ordering/membership (e.g. a brand-new
// session shows up) without ever flashing the loading skeleton over the
// sidebar the user is still looking at. A search edit is the only thing
// that should visibly reload the list.
export function useRecentVisits(search: string, refreshKey: string) {
  const { t } = useTranslation('session')
  const [visits, setVisits] = useState<RecentVisit[]>([])
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  const cursorRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const loadingMoreRef = useRef(false)

  useEffect(() => {
    abortRef.current?.abort()
    setLoadingInitial(true)
    setError(null)

    const timer = setTimeout(() => {
      const controller = new AbortController()
      abortRef.current = controller

      void (async () => {
        try {
          const res = await fetch(
            `/api/trpc/session.listRecentVisits?${new URLSearchParams({ input: JSON.stringify({ search: search || undefined, limit: 20 }) })}`,
            { signal: controller.signal },
          )
          if (!res.ok) throw new Error(t('errors.recentSessionsLoadFailed'))
          const body = (await res.json()) as { result: { data: { visits: RecentVisit[]; nextCursor: string | null } } }
          cursorRef.current = body.result.data.nextCursor
          setNextCursor(body.result.data.nextCursor)
          setVisits(body.result.data.visits)
          setLoadingInitial(false)
        } catch (err) {
          if (controller.signal.aborted) return
          setVisits([])
          setLoadingInitial(false)
          setError(err instanceof Error ? err.message : t('errors.recentSessionsLoadFailed'))
        }
      })()
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      abortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey intentionally excluded; the effect below handles it without disturbing loadingInitial/the visible list
  }, [search])

  // Skips its first run — the effect above already covers the initial
  // load, so this only fires on an actual session switch.
  const isFirstRefreshRef = useRef(true)
  useEffect(() => {
    if (isFirstRefreshRef.current) {
      isFirstRefreshRef.current = false
      return
    }
    const controller = new AbortController()
    void (async () => {
      try {
        const res = await fetch(
          `/api/trpc/session.listRecentVisits?${new URLSearchParams({ input: JSON.stringify({ search: search || undefined, limit: 20 }) })}`,
          { signal: controller.signal },
        )
        if (!res.ok) return
        const body = (await res.json()) as { result: { data: { visits: RecentVisit[]; nextCursor: string | null } } }
        cursorRef.current = body.result.data.nextCursor
        setNextCursor(body.result.data.nextCursor)
        setVisits(body.result.data.visits)
      } catch {
        // Background refresh — a transient failure just leaves the
        // previous list on screen instead of surfacing an error.
      }
    })()
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only refreshKey should retrigger this; `search` is read live, not tracked as a dep (that's the effect above's job)
  }, [refreshKey])

  const loadMore = useCallback(() => {
    if (!cursorRef.current || loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)

    void (async () => {
      try {
        const body = await getTrpc<{ visits: RecentVisit[]; nextCursor: string | null }>('session.listRecentVisits', {
          search: search || undefined,
          cursor: cursorRef.current,
          limit: 20,
        })
        cursorRef.current = body.nextCursor
        setNextCursor(body.nextCursor)
        setVisits((v) => [...v, ...body.visits])
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errors.moreRecentSessionsLoadFailed'))
      } finally {
        loadingMoreRef.current = false
        setLoadingMore(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads cursorRef/search live, doesn't need `search` as a dep beyond the closure it's already captured in per-render
  }, [search])

  return { visits, loadingInitial, loadingMore, error, hasMore: nextCursor !== null, loadMore }
}

export interface RosterEntry {
  userId: string
  turnOrder: number
  // First name, resolved fresh from this member's current profile on
  // every session.getState call — null means "show as anonymous" (either
  // they have stay_anonymous on, or no completed profile). See trpc-api's
  // userProfileRepository.ts's findDisplayNames. The live roster-update
  // WS frame (below) never carries this — only getState does — so the
  // handler for that frame merges by userId instead of replacing the
  // roster outright, to avoid clobbering it back to null between polls.
  displayName: string | null
}

export interface SessionState {
  id: string
  status: SessionStatus
  currentTurnUserId: string | null
  roster: RosterEntry[]
  // Anonymized userIds currently holding a live WebSocket subscription
  // to this session — distinct from `roster` (who has ever joined,
  // durable). Lets the UI show who's actually here right now, not just
  // who's a permanent participant. See websocket-service's
  // redisPresenceAdapter.ts.
  onlineUserIds: string[]
}

export interface ChatMessage {
  id: string
  sessionId: string
  userId: string
  body: string
  // 'system' rows are synthetic events (e.g. a join notice) — rendered as
  // an inline system-message line rather than a real chat bubble. See
  // trpc-api's messageRepository.ts and migrations/0001_init.ts.
  type: 'user' | 'system'
  // Anything other than 'pass' is only ever present in a message this
  // client's own user authored — trpc-api's listMessages withholds any
  // other classification's row from every other participant. 'reviewed_pass'
  // means a human reviewed a flag/crisis and cleared it — distinct from
  // 'pass' (the classifier's own original verdict), never conflate the two
  // in the UI. See SessionPage.tsx's MessageRow for where this drives
  // rendering.
  moderationStatus: 'pass' | 'flag' | 'crisis' | 'reviewed_pass'
  falsePositiveReportedAt: string | null
  createdAt: string
}

export interface CrisisResource {
  type: 'crisis_resource'
  message: string
  resources: { name: string; phone: string; url?: string }[]
}

export type SendOutcome = { status: 'sent' } | { status: 'held' } | { status: 'crisis'; resource: CrisisResource }

// Safety-net polling only now — live updates come from the persistent
// WebSocket connection held by SessionSocketProvider (websocket-service
// relays chat messages and roster/turn/join events onto that same
// socket; see redisTurnStateAdapter.ts / rpcServer.ts on that side). This
// just self-heals from a missed event during a connection
// gap (a full reconnect-with-resync pass is a later piece of work), so
// it can be far less frequent than the old poll-only design's 3s.
const FALLBACK_POLL_INTERVAL_MS = 20000

const MESSAGES_PAGE_SIZE = 30

interface MessagesPage {
  messages: ChatMessage[]
  nextCursor: string | null
}

// Bespoke (not routed through getTrpc), mirroring pages/start/shared.tsx's
// fetchOpenSessionsPage style — `cache: 'no-store'`, since a stale message
// page here means missing or duplicated history, not just a slightly-stale
// list.
async function fetchMessagesPage(sessionId: string, cursor: string | null): Promise<MessagesPage> {
  const input: Record<string, unknown> = { sessionId, limit: MESSAGES_PAGE_SIZE }
  if (cursor) input.cursor = cursor
  const res = await fetch(`/api/trpc/session.listMessages?input=${encodeURIComponent(JSON.stringify(input))}`, {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error('error')
  const body = (await res.json()) as { result: { data: MessagesPage } }
  return body.result.data
}

// Merges any messages missing from `prev` (by id) into it, sorted back
// into chronological order — used by refresh()'s self-heal reconcile
// (never a wholesale replace, so it can't clobber older pages the user
// has scrolled up into) and returns `prev` unchanged (same reference) when
// there's nothing new, so callers relying on referential equality (e.g.
// the scroll-tracking effect's [messages] dependency) don't see a
// spurious change.
function mergeLatestMessages(prev: ChatMessage[], fetched: ChatMessage[]): ChatMessage[] {
  const known = new Set(prev.map((m) => m.id))
  const additions = fetched.filter((m) => !known.has(m.id))
  if (additions.length === 0) return prev
  return [...prev, ...additions].sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)))
}

// `enabled` gates the actual fetch/connect — getState/listMessages/the WS
// upgrade are all membership-gated, so calling them before the caller has
// actually joined (still mid guidelines-check) would just 403 repeatedly.
// Pass `enabled: false` until the session is confirmed joined and gated.
export function useSessionChat(sessionId: string, enabled: boolean) {
  const { t } = useTranslation('session')
  const { subscribeSession, subscribeReconnect } = useSessionSocket()
  const [state, setState] = useState<SessionState | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // The most recent participant-joined event, for a caller (SessionPage)
  // to surface as a toast — a new object identity every time so the same
  // userId joining twice in a row still triggers a fresh effect run.
  // Carries turnOrder directly (not just userId) so a caller can label
  // the joiner without depending on `state.roster` already reflecting
  // them — the roster-update frame is a separate WS message that can
  // arrive before or after this one.
  const [lastJoinedEvent, setLastJoinedEvent] = useState<{ userId: string; turnOrder: number } | null>(null)

  // Cursor pagination for scroll-up-for-older-messages — see
  // fetchMessagesPage/mergeLatestMessages above. `messages` itself stays
  // one flat, ever-growing array (no windowing/eviction): there's no
  // "next page" beyond the newest (new messages arrive live over the
  // WebSocket, appended in handleFrame below) and the live/newest end
  // must never be evicted, so the only thing that needs bounding is the
  // fetch page size, not what's kept in memory.
  const [oldestCursor, setOldestCursor] = useState<string | null>(null)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const loadingOlderRef = useRef(false)
  // Bumped only when loadOlderMessages prepends a page — never for a live
  // WS append or a fallback-poll merge (both only ever affect the bottom
  // of the list, which never needs scroll compensation). Consumed by
  // SessionPage.tsx's useScrollShiftCompensation.
  const [messagesTopShiftVersion, setMessagesTopShiftVersion] = useState(0)
  // false = the next refresh() for this session is its first load (full
  // replace); true = every later tick is a merge-only reconcile. Reset on
  // every session switch — see the mount/interval effect below.
  const sessionLoadedRef = useRef(false)
  // True for the duration of this hook's own in-flight send() call — see
  // handleFrame's 'message' case below. Without this, the WS echo of a
  // message this tab just sent can arrive (and get rendered) before
  // send()'s own promise resolves, so the UI shows the message while the
  // composer still reads as "sending" (SessionPage.tsx's isSending).
  // Sends are turn-gated (only the current holder can send), so there's
  // never a genuine *other* message that could be wrongly suppressed by
  // this — the only message that can possibly arrive while this is true
  // is the one this same call is waiting on, which refresh() below
  // already picks up once it lands.
  const sendingRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const isInitial = !sessionLoadedRef.current
      const [nextState, page] = await Promise.all([
        getTrpc<SessionState>('session.getState', { sessionId }),
        fetchMessagesPage(sessionId, null),
      ])
      setState(nextState)
      if (isInitial) {
        setMessages(page.messages)
        setOldestCursor(page.nextCursor)
        setHasOlderMessages(page.nextCursor !== null)
        sessionLoadedRef.current = true
      } else {
        // Self-heal only, from here on: merge any messages missing from
        // the current array (a missed WS event during a connection gap),
        // never replace it — a wholesale replace would clobber history
        // the user has scrolled up into. oldestCursor/hasOlderMessages
        // are deliberately left untouched.
        setMessages((prev) => mergeLatestMessages(prev, page.messages))
      }
      setError(null)
    } catch {
      setError(t('errors.sessionLoadFailed'))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  const loadOlderMessages = useCallback(async () => {
    if (!hasOlderMessages || !oldestCursor || loadingOlderRef.current) return
    loadingOlderRef.current = true
    setLoadingOlderMessages(true)
    try {
      const page = await fetchMessagesPage(sessionId, oldestCursor)
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id))
        return [...page.messages.filter((m) => !known.has(m.id)), ...prev]
      })
      setOldestCursor(page.nextCursor)
      setHasOlderMessages(page.nextCursor !== null)
      setMessagesTopShiftVersion((v) => v + 1)
    } catch {
      setError(t('errors.earlierMessagesLoadFailed'))
    } finally {
      loadingOlderRef.current = false
      setLoadingOlderMessages(false)
    }
  }, [sessionId, hasOlderMessages, oldestCursor])

  useEffect(() => {
    if (!enabled) return
    sessionLoadedRef.current = false
    setLoading(true)
    void refresh()
    const interval = setInterval(() => void refresh(), FALLBACK_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [refresh, enabled])

  useEffect(() => {
    if (!enabled) return

    function handleFrame(frame: SessionFrame) {
      if (frame.type === 'message') {
        // Suppressed while our own send() is in flight — see sendingRef's
        // doc comment above. refresh() inside send() picks this same
        // message up once the send is confirmed.
        if (sendingRef.current) return
        const payload = (frame as MessageFrame).payload
        // Live-published messages are always 'pass' — see MessageFrame's
        // own comment for why the wire payload doesn't carry
        // moderationStatus at all.
        const message: ChatMessage = { ...payload, moderationStatus: 'pass', falsePositiveReportedAt: null }
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]))
      } else if (frame.type === 'roster-update') {
        // The WS frame only ever carries { userId, turnOrder } — it comes
        // from websocket-service/Redis, which has no idea about profile
        // data (see RosterEntry's doc comment above). Merging by userId
        // instead of replacing the array outright preserves each
        // existing member's displayName (last resolved by session.getState)
        // until the next poll/refetch catches up; a brand-new member from
        // this same frame just starts out anonymous (null) until then.
        const { currentTurnUserId, roster: incoming } = frame as RosterUpdateFrame
        setState((prev) => {
          if (!prev) return prev
          const prevByUserId = new Map(prev.roster.map((r) => [r.userId, r]))
          const roster = incoming.map((r) => ({ ...r, displayName: prevByUserId.get(r.userId)?.displayName ?? null }))
          return { ...prev, currentTurnUserId, roster }
        })
      } else if (frame.type === 'participant-joined') {
        const { userId, turnOrder } = frame as ParticipantJoinedFrame
        setLastJoinedEvent({ userId, turnOrder })
      } else if (frame.type === 'online-users-changed') {
        const { userIds } = frame as OnlineUsersFrame
        setState((prev) => (prev ? { ...prev, onlineUserIds: userIds } : prev))
      } else if (frame.type === 'member-profile-updated') {
        // Patches just this one roster entry in place — see
        // MemberProfileUpdatedFrame's doc comment (sessionSocketTypes.ts)
        // for why this is what makes a profile save (including turning
        // "stay anonymous" back on) show up for other viewers immediately
        // instead of on their next ~20s poll.
        const { userId, displayName } = frame as MemberProfileUpdatedFrame
        setState((prev) =>
          prev ? { ...prev, roster: prev.roster.map((r) => (r.userId === userId ? { ...r, displayName } : r)) } : prev,
        )
      }
    }

    return subscribeSession(sessionId, handleFrame)
  }, [sessionId, enabled, subscribeSession])

  // NATS here is core pub/sub with no replay — a connection that drops
  // and reconnects can have missed roster/message events entirely while
  // it was down. Resubscribing alone (handled inside
  // SessionSocketProvider) isn't enough; re-fetch a fresh snapshot so
  // this view resyncs from truth rather than silently staying stale
  // until the next 20s fallback poll.
  useEffect(() => {
    if (!enabled) return
    return subscribeReconnect(() => void refresh())
  }, [enabled, subscribeReconnect, refresh])

  const send = useCallback(
    async (body: string): Promise<SendOutcome> => {
      sendingRef.current = true
      try {
        let result: { status: 'sent' | 'held' | 'crisis'; message?: ChatMessage; resource?: CrisisResource }
        try {
          result = await postTrpc('session.sendMessage', { sessionId, body })
        } catch (err) {
          // postTrpc collapses every 409 into the same 'full' message
          // (its capacity-check meaning, for session.join) — see
          // SendMessageConflictError's own comment for why that's safe to
          // re-narrow specifically here.
          if (err instanceof Error && err.message === 'full') throw new SendMessageConflictError()
          throw err
        }
        await refresh()
        if (result.status === 'crisis') return { status: 'crisis', resource: result.resource! }
        if (result.status === 'held') return { status: 'held' }
        return { status: 'sent' }
      } finally {
        sendingRef.current = false
      }
    },
    [sessionId, refresh],
  )

  return {
    state,
    messages,
    loading,
    error,
    send,
    lastJoinedEvent,
    loadOlderMessages,
    hasOlderMessages,
    loadingOlderMessages,
    messagesTopShiftVersion,
  }
}

// How long a turn holder can go quiet before the countdown appears —
// resets on every keystroke, not just once per turn, so someone still
// actively composing never sees it, only someone who's stopped.
const TURN_INACTIVITY_DELAY_MS = 3000
// The countdown itself, once it appears.
const TURN_COUNTDOWN_SECONDS = 10

// Drives SessionPage.tsx's turn-inactivity countdown: pauses (hides)
// while the holder is actively typing, starts a fresh
// TURN_COUNTDOWN_SECONDS-second countdown after
// TURN_INACTIVITY_DELAY_MS of silence, and calls `onExpire` if it ever
// reaches zero — the caller decides what that means (auto-send a
// draft, or auto-skip an empty one) by reading its own live `draft`
// state, not anything this hook tracks itself; this hook only owns
// *timing*, never message content.
//
// Deliberately restarts the whole cycle on every `draft` change,
// including a programmatic clear right after an auto-send/auto-skip —
// there's no "already fired once" guard here. That's intentional: a
// turn can advance right back to the same holder (a session with only
// one or two members), and the mechanic's whole point is to keep
// prompting whoever currently holds the turn, repeatedly, for as long
// as it stays theirs — not to fire once and then go permanently silent
// for that person. TURN_INACTIVITY_DELAY_MS is comfortably longer than
// any realistic round-trip to the server, so a genuine turn-advance
// (enabled flipping false) always has time to cancel this before a
// same-turn restart could ever double-fire.
//
// `enabled` should be `isYourTurn && <input is actually usable>` — the
// same guard the composer's own disabled state already uses, not just
// isYourTurn alone (see SessionPage.tsx).
export function useTurnCountdown(enabled: boolean, draft: string, onExpire: () => void): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // The interval tick's own source of truth for "how many seconds are
  // left" — read and written imperatively, never through a setState
  // functional updater. React 18 StrictMode deliberately double-invokes
  // a functional updater (the `(s) => ...` form) as a purity check; this
  // one used to call onExpire and bump `cycle` from inside it, which
  // meant a single real expiry fired onExpire — and so sendNow/skipTurn
  // — twice, racing itself for the same turn claim (one side always
  // losing with a 409). Keeping the countdown logic in a plain ref and
  // only ever calling setSecondsLeft with a literal value (never a
  // function) sidesteps that: a literal-value setState is idempotent, so
  // even a duplicate invocation of *that* is harmless.
  const remainingRef = useRef<number | null>(null)
  const onExpireRef = useRef(onExpire)
  onExpireRef.current = onExpire
  // Bumped every time the countdown actually expires, purely to force
  // the effect below to tear down and restart. `draft` alone isn't a
  // reliable "start over" signal: an auto-skip fires precisely when
  // draft is already empty, so it stays '' -> '' with nothing to detect
  // — this exists specifically to still restart the cycle in that case.
  const [cycle, setCycle] = useState(0)

  useEffect(() => {
    function clearTimers() {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current)
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
      inactivityTimerRef.current = null
      countdownIntervalRef.current = null
    }

    clearTimers()
    remainingRef.current = null
    setSecondsLeft(null)
    if (!enabled) return

    inactivityTimerRef.current = setTimeout(() => {
      remainingRef.current = TURN_COUNTDOWN_SECONDS
      setSecondsLeft(TURN_COUNTDOWN_SECONDS)
      countdownIntervalRef.current = setInterval(() => {
        const next = (remainingRef.current ?? 1) - 1
        if (next <= 0) {
          clearTimers()
          remainingRef.current = null
          setSecondsLeft(null)
          onExpireRef.current()
          setCycle((c) => c + 1)
          return
        }
        remainingRef.current = next
        setSecondsLeft(next)
      }, 1000)
    }, TURN_INACTIVITY_DELAY_MS)

    return clearTimers
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately re-arms on every `draft` change (the "pauses while typing" behavior), on `enabled` flipping, and on `cycle` (see its own comment); onExpire is read live via onExpireRef, not tracked here
  }, [enabled, draft, cycle])

  return secondsLeft
}
