import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { BadgeVariant } from '../../components/Badge'
import { useSessionSocket } from '../../SessionSocketProvider'

export interface Topic {
  id: string
  slug: string
  label: string
}

export interface OpenSession {
  id: string
  status: 'forming' | 'active' | 'completed' | 'cancelled'
  // Null for circles created before circle naming existed — fall back to
  // a topic-derived label rather than assuming every row has one.
  name: string | null
  scheduledAt: string
  durationMinutes: number | null
  capacity: number
  joinedCount: number
  topic: Topic
}

// `label`/`hint` are deliberately not data here — they're translated at
// the render sites (StartNewPage.tsx, StartJoinPage.tsx) via
// `t('sizes.upTo', { count: sz.capacity })` and `durationLabel(id, t)`
// below, both of which already hold a `t` from useTranslation('start').
export const SIZES = [
  { id: 'small', capacity: 6 },
  { id: 'medium', capacity: 8 },
  { id: 'large', capacity: 12 },
]

export const DURATIONS = [
  { id: '30', minutes: 30 },
  { id: '45', minutes: 45 },
  { id: '60', minutes: 60 },
  { id: '90', minutes: 90 },
  { id: 'open', minutes: null as number | null },
]

export function durationLabel(id: string, t: TFunction<'start'>) {
  const duration = DURATIONS.find((d) => d.id === id)
  if (!duration) return ''
  return duration.minutes === null ? t('durations.openEnded') : t('shared.minutesShort', { count: duration.minutes })
}

// Safety net only — every circle created through the current /start/new
// flow always has a name (session.create requires it). This only kicks
// in for circles created before that requirement existed, so the browse
// list and confirm screen never show a blank title.
export function displayName(session: OpenSession) {
  return session.name ?? `${session.topic.label} circle`
}

// Small pill-style choice control (topic / length / group size) — deliberately not a radio
// button per product direction. Reuses the safe accent tokens for the selected state.
export function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        cursor: 'pointer',
        border: `1px solid ${active ? 'var(--accent-safe)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-full)',
        padding: '7px 16px',
        background: active ? 'var(--accent-safe-surface)' : 'var(--surface-app)',
        color: active ? 'var(--accent-safe)' : 'var(--text-primary)',
        fontSize: 'var(--font-size-sm)',
        fontWeight: active ? 'var(--font-weight-bold)' : 'var(--font-weight-regular)',
      }}
    >
      {label}
    </div>
  )
}

export function StepBar({ step, total }: { step: number; total: number }) {
  const { t } = useTranslation('start')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
          <div
            key={n}
            style={{
              height: 3,
              flex: 1,
              borderRadius: 'var(--radius-full)',
              background: n <= step ? 'var(--accent-safe)' : 'var(--border-subtle)',
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
        {t('shared.stepOf', { step, total })}
      </span>
    </div>
  )
}

export function useTopics() {
  const { t } = useTranslation('start')
  const [state, setState] = useState<{ topics: Topic[]; loading: boolean; error: string | null }>({
    topics: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const res = await fetch('/api/trpc/topics.list')
        if (!res.ok) throw new Error(t('errors.topicsLoadFailed'))
        const body = (await res.json()) as { result: { data: Topic[] } }
        if (!cancelled) setState({ topics: body.result.data, loading: false, error: null })
      } catch (err) {
        if (!cancelled) {
          setState({ topics: [], loading: false, error: err instanceof Error ? err.message : t('errors.topicsLoadFailed') })
        }
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t() intentionally excluded: this fetch runs once per mount, not once per language
  }, [])

  return state
}

export interface OpenSessionsQuery {
  search?: string
  topicId?: string
  capacity?: number
  // undefined = any duration, null = open-ended only, a number = exact.
  durationMinutes?: number | null
  date?: string // 'YYYY-MM-DD'
}

const OPEN_SESSIONS_PAGE_SIZE = 20
// Only matters for `search` (typed per keystroke) — the other filters
// are discrete picks, so debouncing them too costs nothing (a picker
// change is already a single event) but keeps this to one code path
// instead of special-casing which field changed. 1s gives a fast typist
// room to finish a word before anything is sent.
const SEARCH_DEBOUNCE_MS = 1000

// Instagram-feed-style windowing: at most this many pages stay loaded at
// once (a page's worth of buffer on each side of wherever the user is
// reading), so browsing arbitrarily deep into a huge result set doesn't
// grow memory/DOM without bound. Scrolling past the edge of the window
// evicts the far page and re-fetches from the backend when the user
// scrolls back to it — see loadNext/loadPrevious below.
const MAX_WINDOW_PAGES = 3

// The all-zeros UUID sorts below every real id, so it never wins a tie —
// this synthetic cursor only ever needs its timestamp half to do real
// work. Millisecond precision (a plain JS Date, not Postgres's own
// microsecond-precision text form used for real row cursors — see
// sessionRepository.ts) is fine here specifically because "now" isn't
// any actual row's value; there's nothing for a truncated cursor to
// collide with.
const NIL_UUID = '00000000-0000-0000-0000-000000000000'

// A one-hour lookahead, not "now" itself — opening exactly on the
// present tends to open on a circle that's already mid-scheduling-window,
// which reads as stale. Anchoring an hour out means the first thing a
// user sees is what's genuinely still ahead of them today; scrolling
// down reaches "now" and then the past, scrolling up reaches further
// into the future.
const INITIAL_ANCHOR_LOOKAHEAD_MS = 60 * 60 * 1000

// Anchors the very first fetch near the present instead of at whichever
// circle happens to be scheduled furthest in the future — schedule mode
// is now newest-first/descending (see sessionRepository.ts's
// listOpenSessions doc comment), so an unanchored first page would open
// on the single most-future circle in the whole dataset rather than
// near "now". Skipped for an active search (relevance mode ignores
// schedule cursors entirely) and for an explicit date filter (the user
// picked a specific day; showing all of it, not just its remainder from
// the anchor onward, is the more useful default).
function initialCursor(query: OpenSessionsQuery): string | null {
  if (query.search || query.date) return null
  return `schedule|${new Date(Date.now() + INITIAL_ANCHOR_LOOKAHEAD_MS).toISOString()}|${NIL_UUID}`
}

interface LoadedPage {
  sessions: OpenSession[]
  prevCursor: string | null
  nextCursor: string | null
}

interface ListOpenResponse {
  sessions: OpenSession[]
  nextCursor: string | null
  prevCursor: string | null
}

async function fetchOpenSessionsPage(
  query: OpenSessionsQuery,
  cursor: string | null,
  direction: 'after' | 'before',
  signal: AbortSignal,
): Promise<ListOpenResponse> {
  const input: Record<string, unknown> = { limit: OPEN_SESSIONS_PAGE_SIZE }
  if (query.search) input.search = query.search
  if (query.topicId) input.topicId = query.topicId
  if (query.capacity !== undefined) input.capacity = query.capacity
  if (query.durationMinutes !== undefined) input.durationMinutes = query.durationMinutes
  if (query.date) input.date = query.date
  if (cursor) {
    input.cursor = cursor
    input.direction = direction
  }

  // `cache: 'no-store'` — search/filter results must never come from the
  // browser's HTTP cache; a stale page here means the user sees circles
  // that already filled up or no longer match what they typed.
  const res = await fetch(`/api/trpc/session.listOpen?input=${encodeURIComponent(JSON.stringify(input))}`, {
    cache: 'no-store',
    signal,
  })
  if (!res.ok) throw new Error('Could not load open circles')
  const body = (await res.json()) as { result: { data: ListOpenResponse } }
  return body.result.data
}

export function useOpenSessions(query: OpenSessionsQuery) {
  const { t } = useTranslation('start')
  const { subscribeLiveCount } = useSessionSocket()
  const [pages, setPages] = useState<LoadedPage[]>([])
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [loadingNext, setLoadingNext] = useState(false)
  const [loadingPrevious, setLoadingPrevious] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Bumped only when a change affects content *above* wherever the user
  // is currently scrolled — a prepend from loadPrevious, or an eviction
  // from loadNext hitting the window cap — never for a plain bottom
  // append. StartJoinPage.tsx watches this to compensate scroll position
  // so the change doesn't visually jump the list.
  const [topShiftVersion, setTopShiftVersion] = useState(0)

  // Mirrors `pages` in a ref so loadNext/loadPrevious can read the
  // latest window without depending on `pages` (keeping their identity
  // stable — no dependency-array churn re-triggering the
  // IntersectionObserver effects in StartJoinPage.tsx on every load).
  const pagesRef = useRef<LoadedPage[]>([])
  const queryRef = useRef(query)
  queryRef.current = query
  const abortRef = useRef<AbortController | null>(null)
  const loadingNextRef = useRef(false)
  const loadingPreviousRef = useRef(false)

  useEffect(() => {
    abortRef.current?.abort()
    setLoadingInitial(true)
    setError(null)

    const timer = setTimeout(() => {
      const controller = new AbortController()
      abortRef.current = controller

      void (async () => {
        try {
          const result = await fetchOpenSessionsPage(query, initialCursor(query), 'after', controller.signal)
          pagesRef.current = [{ sessions: result.sessions, prevCursor: result.prevCursor, nextCursor: result.nextCursor }]
          setPages(pagesRef.current)
          setLoadingInitial(false)
        } catch (err) {
          if (controller.signal.aborted) return
          pagesRef.current = []
          setPages([])
          setLoadingInitial(false)
          setError(err instanceof Error ? err.message : t('errors.sessionsLoadFailed'))
        }
      })()
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      abortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires again on any filter/search value change; `query`'s object identity isn't the dependency, its fields are
  }, [query.search, query.topicId, query.capacity, query.durationMinutes, query.date])

  const loadNext = useCallback(() => {
    const last = pagesRef.current[pagesRef.current.length - 1]
    if (!last?.nextCursor || loadingNextRef.current) return
    loadingNextRef.current = true
    setLoadingNext(true)

    const controller = new AbortController()
    void (async () => {
      try {
        const result = await fetchOpenSessionsPage(queryRef.current, last.nextCursor, 'after', controller.signal)
        let next = [...pagesRef.current, { sessions: result.sessions, prevCursor: result.prevCursor, nextCursor: result.nextCursor }]
        if (next.length > MAX_WINDOW_PAGES) {
          next = next.slice(next.length - MAX_WINDOW_PAGES)
          setTopShiftVersion((v) => v + 1)
        }
        pagesRef.current = next
        setPages(next)
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : t('errors.moreSessionsLoadFailed'))
        }
      } finally {
        loadingNextRef.current = false
        setLoadingNext(false)
      }
    })()
  }, [])

  const loadPrevious = useCallback(() => {
    const first = pagesRef.current[0]
    if (!first?.prevCursor || loadingPreviousRef.current) return
    loadingPreviousRef.current = true
    setLoadingPrevious(true)

    const controller = new AbortController()
    void (async () => {
      try {
        const result = await fetchOpenSessionsPage(queryRef.current, first.prevCursor, 'before', controller.signal)
        let next = [{ sessions: result.sessions, prevCursor: result.prevCursor, nextCursor: result.nextCursor }, ...pagesRef.current]
        if (next.length > MAX_WINDOW_PAGES) {
          next = next.slice(0, MAX_WINDOW_PAGES)
        }
        pagesRef.current = next
        setPages(next)
        // A prepend always affects the top, whether or not it also
        // triggered eviction at the bottom.
        setTopShiftVersion((v) => v + 1)
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : t('errors.previousSessionsLoadFailed'))
        }
      } finally {
        loadingPreviousRef.current = false
        setLoadingPrevious(false)
      }
    })()
  }, [])

  const sessions = useMemo(() => pages.flatMap((p) => p.sessions), [pages])

  // Live participant counts, keyed by session id — overlays
  // joinedCount (the static DB join tally) once a live count actually
  // arrives, per StartJoinPage.tsx's own TODO on that field. Subscribed
  // to exactly the session ids currently in the loaded window, via
  // SessionSocketProvider's shared connection: a session entering the
  // window subscribes, one falling out (eviction, or a filter/search
  // change replacing the whole list) unsubscribes — sending live
  // updates for rows the user can no longer even see would be wasted
  // traffic.
  const [liveCounts, setLiveCounts] = useState<Map<string, number>>(new Map())
  const windowIds = useMemo(() => sessions.map((s) => s.id), [sessions])
  const windowKey = windowIds.join(',')

  useEffect(() => {
    const unsubscribes = windowIds.map((id) =>
      subscribeLiveCount(id, (count) => {
        setLiveCounts((prev) => {
          const next = new Map(prev)
          next.set(id, count)
          return next
        })
      }),
    )
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- windowIds is derived fresh every render; windowKey (its stable string form) is the real dependency
  }, [windowKey, subscribeLiveCount])

  const sessionsWithLiveCounts = useMemo(
    () => sessions.map((s) => (liveCounts.has(s.id) ? { ...s, joinedCount: liveCounts.get(s.id)! } : s)),
    [sessions, liveCounts],
  )

  return {
    sessions: sessionsWithLiveCounts,
    loadingInitial,
    loadingNext,
    loadingPrevious,
    error,
    hasNext: (pages[pages.length - 1]?.nextCursor ?? null) !== null,
    hasPrevious: (pages[0]?.prevCursor ?? null) !== null,
    loadNext,
    loadPrevious,
    topShiftVersion,
  }
}

// Pure client-side presentation: given the exact search string sent to
// the backend, highlights the first case-insensitive literal occurrence
// in `text`. A result that only matched via trigram fuzzy similarity
// (e.g. a typo) has no literal occurrence to find, so it renders
// unhighlighted — there's no substring to point at.
export function HighlightedText({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim()
  if (!trimmed) return <>{text}</>

  const index = text.toLowerCase().indexOf(trimmed.toLowerCase())
  if (index === -1) return <>{text}</>

  return (
    <>
      {text.slice(0, index)}
      <span style={{ background: 'var(--accent-safe-surface)', color: 'var(--accent-safe)', borderRadius: 3 }}>
        {text.slice(index, index + trimmed.length)}
      </span>
      {text.slice(index + trimmed.length)}
    </>
  )
}

// A future circle counts down ("Starts in X"); a past-or-current one just
// states when it was scheduled — no relative "ago"/"shortly" wording. The
// status pill (badgeText/badgeVariant, rendered separately on the right —
// see StartJoinPage.tsx) already carries the Live/Starting-soon/Open
// signal, so this text never repeats it.
function formatDuration(minutes: number, t: TFunction<'start'>): string {
  if (minutes < 60) return t('shared.minutesShort', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('shared.hours', { count: hours })
  const days = Math.round(minutes / (60 * 24))
  return t('shared.days', { count: days })
}

// Presentation only — the backend returns raw status/scheduledAt/counts,
// never these display strings, since they depend on the current time.
export function describeTiming(
  session: OpenSession,
  timeZone: string,
  t: TFunction<'start'>,
): { timing: string; badgeText: string; badgeVariant: BadgeVariant } {
  const minutesUntil = Math.round((new Date(session.scheduledAt).getTime() - Date.now()) / 60000)
  const timing =
    minutesUntil > 0
      ? t('shared.startsIn', { duration: formatDuration(minutesUntil, t) })
      : new Date(session.scheduledAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone })

  if (session.status === 'active') {
    return { timing, badgeText: t('shared.live'), badgeVariant: 'info' }
  }
  if (minutesUntil > -30 && minutesUntil <= 30) {
    return { timing, badgeText: t('shared.startingSoon'), badgeVariant: 'neutral' }
  }
  return { timing, badgeText: t('shared.open'), badgeVariant: 'neutral' }
}
