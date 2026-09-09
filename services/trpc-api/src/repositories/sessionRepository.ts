import { MAX_USERS_PER_SESSION, isSessionMember, type Database, type Topic } from '@mincirklen/shared'
import { sql, type Kysely } from 'kysely'

export { isSessionMember }

// Explicit constructors here (rather than relying on the implicit default)
// so Bun's coverage instrumentation actually tracks these as invoked —
// an empty `class X extends Error {}` body otherwise counts as a
// permanently-uncovered function regardless of how many times `new X()`
// runs.
export class SessionNotFoundError extends Error {
  constructor(message: string) {
    super(message)
  }
}
export class SessionFullError extends Error {
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

export interface RosterEntry {
  userId: string
  turnOrder: number
}

// The roster shape actually returned by getState — RosterEntry plus a
// display name resolved fresh from the current profile state (see
// userProfileRepository.ts's findDisplayNames and
// sessionService.ts's getSessionState). null means "show as anonymous"
// (Member N) — either the member never turned off stay_anonymous, or
// they don't have a completed profile at all.
export interface RosterMember extends RosterEntry {
  displayName: string | null
}

export interface SessionState {
  id: string
  status: 'forming' | 'active' | 'completed' | 'cancelled'
  currentTurnUserId: string | null
  roster: RosterMember[]
  // Anonymized userIds currently holding a live WebSocket subscription
  // to this session — see websocket-service's redisPresenceAdapter.ts.
  // Distinct from `roster` (who has ever joined, durable): this is who's
  // actually connected right now, self-healing via presence staleness
  // rather than any explicit "leave" action.
  onlineUserIds: string[]
}

export interface CreateSessionParams {
  topicId: string
  name: string
  scheduledAt: Date | string
  durationMinutes: number | null
  capacity: number
}

// `params` is optional so the pre-existing ad-hoc turn-based flow (every
// call site before the scheduled /start/new flow existed) keeps working
// unchanged — see migrations/0001_init.ts and
// migrations/0001_init.ts.
export async function createSession(db: Kysely<Database>, params?: CreateSessionParams): Promise<{ id: string }> {
  const row = params
    ? await db
        .insertInto('sessions')
        .values({
          status: 'forming',
          topic_id: params.topicId,
          name: params.name,
          scheduled_at: params.scheduledAt,
          duration_minutes: params.durationMinutes,
          capacity: params.capacity,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    : await db.insertInto('sessions').defaultValues().returningAll().executeTakeFirstOrThrow()
  return { id: row.id }
}

export interface OpenSession {
  id: string
  status: 'forming' | 'active' | 'completed' | 'cancelled'
  // Nullable despite session.create now requiring it for every new
  // scheduled circle: a row created between migration 0007 (topic_id)
  // and 0008 (name) legitimately has a topic but no name. Callers must
  // handle null rather than assume the input-schema requirement was
  // always in force.
  name: string | null
  scheduledAt: Date
  durationMinutes: number | null
  capacity: number
  joinedCount: number
  topic: Topic
}

export interface ListOpenSessionsFilters {
  search?: string
  topicId?: string
  capacity?: number
  // undefined = any duration, null = open-ended circles only, a number =
  // that exact duration.
  durationMinutes?: number | null
  date?: string // 'YYYY-MM-DD'
  cursor?: string
  // Which side of `cursor` to fetch. Ignored (treated as 'after') when
  // there's no cursor — the very first fetch has no "before" side.
  direction?: 'after' | 'before'
  limit: number
}

export interface ListOpenSessionsResult {
  sessions: OpenSession[]
  nextCursor: string | null
  prevCursor: string | null
}

// Display name used for both search matching and the "no name yet"
// fallback — kept identical to shared.tsx's displayName() so a search
// term matches exactly what the user sees rendered.
const DISPLAY_NAME_SQL = sql<string>`coalesce(s.name, t.label || ' circle')`

function parseCursor(cursor: string): { mode: 'schedule' | 'relevance'; value: string; id: string } {
  const [mode, value, id] = cursor.split('|')
  if ((mode !== 'schedule' && mode !== 'relevance') || value === undefined || !id) {
    throw new Error(`invalid cursor: ${cursor}`)
  }
  return { mode, value, id }
}

// Circles browsable on /start/join: scheduled (has a topic), still
// forming or active, and not yet full. Ad-hoc turn-based sessions (no
// topic) never appear here.
//
// Two-level query: the inner query aggregates membership counts (and, if
// searching, a trigram relevance score) per session; the outer query
// filters out full circles via `whereRef` (a plain column-to-column
// comparison on the now-materialized `joined_count`/`capacity` columns,
// rather than a `HAVING` on the raw aggregate) and applies keyset-cursor
// pagination. Filtering/pagination all happen in SQL — this must never
// go back to fetching everything and filtering in JS, which breaks
// pagination (a page could come back short, or with the wrong rows,
// once full circles are excluded afterward) and doesn't scale.
//
// Bidirectional: `direction: 'before'` fetches the page immediately
// preceding the cursor instead of following it — this backs the windowed
// browse list on /start/join (pages/start/shared.tsx), which evicts
// whichever end the user has scrolled away from and re-fetches from here
// (not from a client cache) if they scroll back. The row order returned
// is always the same canonical order regardless of direction — a
// `before` fetch queries in the *reverse* of that order (so `LIMIT`
// grabs the rows closest to the cursor, not the ones closest to the true
// end of the whole list) and reverses the JS result back afterward.
// Callers never need to reason about which direction produced a page.
//
// Schedule mode's canonical order is descending by scheduled_at — newest/
// soonest-starting circle first, oldest last. This makes the browse list
// read like a normal feed: 'after' (the bottom sentinel, "load more")
// moves further into the past, 'before' (the top sentinel) moves toward
// the future. The frontend's very first fetch synthesizes a schedule
// cursor for "now" (see fetchOpenSessionsPage in shared.tsx) rather than
// passing no cursor at all, so the initial view is anchored at the
// present instead of at the single furthest-future circle in the whole
// dataset. Relevance mode (search active) is unaffected — best-match
// first stays the ordering there, since "recency" isn't a meaningful
// concept once you're searching by name.
export async function listOpenSessions(db: Kysely<Database>, filters: ListOpenSessionsFilters): Promise<ListOpenSessionsResult> {
  const searchTerm = filters.search?.trim()
  const relevanceMode = !!searchTerm
  // No cursor means "the very first page" — direction is meaningless
  // there (nothing precedes the start of the list).
  const isBefore = !!filters.cursor && filters.direction === 'before'

  // Selected in the same array as everything else (rather than via a
  // separate later `.select()` call) with the same declared type in both
  // branches (`number | null`) — Kysely infers the derived table's
  // column set from this one call, so branching on which columns get
  // selected (rather than only on which raw SQL expression fills this
  // one) would make `inner`'s type unstable across the two code paths.
  const relevanceExpr = relevanceMode
    ? sql<number | null>`public.similarity(${DISPLAY_NAME_SQL}, ${searchTerm})`
    : sql<number | null>`null`

  let inner = db
    .selectFrom('sessions as s')
    .innerJoin('topics as t', 't.id', 's.topic_id')
    .leftJoin('session_users as su', 'su.session_id', 's.id')
    .select(({ fn }) => [
      's.id as id',
      's.status as status',
      's.name as name',
      's.scheduled_at as scheduled_at',
      's.duration_minutes as duration_minutes',
      's.capacity as capacity',
      't.id as topic_id',
      't.slug as topic_slug',
      't.label as topic_label',
      fn.count<string>('su.user_id').as('joined_count'),
      relevanceExpr.as('relevance'),
      // A second, raw-text form of the same column, used only for the
      // cursor. `scheduled_at` comes back from `pg` as a JS `Date`, which
      // only has millisecond resolution — Postgres's timestamptz has
      // microsecond resolution. Round-tripping the cursor through
      // `Date#toISOString()` truncates that, so a boundary row's precise
      // value (e.g. .123456) no longer equals the truncated cursor
      // (.123000), the row satisfies `> cursor` again on the next page,
      // and gets returned twice. Postgres's own text representation
      // round-trips through `::timestamptz` exactly, with no such loss.
      sql<string>`s.scheduled_at::text`.as('scheduled_at_cursor'),
    ])
    .where('s.status', 'in', ['forming', 'active'])

  if (filters.topicId) {
    inner = inner.where('s.topic_id', '=', filters.topicId)
  }
  if (filters.capacity !== undefined) {
    inner = inner.where('s.capacity', '=', filters.capacity)
  }
  if (filters.durationMinutes !== undefined) {
    inner =
      filters.durationMinutes === null
        ? inner.where('s.duration_minutes', 'is', null)
        : inner.where('s.duration_minutes', '=', filters.durationMinutes)
  }
  if (filters.date) {
    inner = inner.where(sql<boolean>`date_trunc('day', s.scheduled_at)::date = ${filters.date}::date`)
  }

  if (relevanceMode) {
    inner = inner.where(
      sql<boolean>`(${DISPLAY_NAME_SQL} ilike ${'%' + searchTerm + '%'} or public.similarity(${DISPLAY_NAME_SQL}, ${searchTerm}) > 0.3)`,
    )
  }

  const aggregated = inner.groupBy(['s.id', 't.id']).as('agg')

  let outer = db.selectFrom(aggregated).selectAll().whereRef('agg.joined_count', '<', 'agg.capacity')

  if (filters.cursor) {
    const decoded = parseCursor(filters.cursor)
    if (relevanceMode && decoded.mode === 'relevance') {
      const score = Number(decoded.value)
      outer = isBefore
        ? outer.where((eb) =>
            eb.or([eb('agg.relevance', '>', score), eb.and([eb('agg.relevance', '=', score), eb('agg.id', '<', decoded.id)])]),
          )
        : outer.where((eb) =>
            eb.or([eb('agg.relevance', '<', score), eb.and([eb('agg.relevance', '=', score), eb('agg.id', '>', decoded.id)])]),
          )
    } else if (!relevanceMode && decoded.mode === 'schedule') {
      // Compared as text cast back to timestamptz, not as a JS Date — see
      // the comment on `scheduled_at_cursor` above for why.
      //
      // Schedule mode's canonical order is descending (newest/soonest
      // first, oldest last) — see the function doc comment — so
      // 'after' (continuing down, toward the past) means *smaller*
      // values here, and 'before' (continuing up, toward the future)
      // means *larger* ones. This is the inverse of relevance mode's
      // comparisons just above, which stay ascending-canonical.
      outer = isBefore
        ? outer.where(
            sql<boolean>`(agg.scheduled_at > ${decoded.value}::timestamptz) or (agg.scheduled_at = ${decoded.value}::timestamptz and agg.id > ${decoded.id})`,
          )
        : outer.where(
            sql<boolean>`(agg.scheduled_at < ${decoded.value}::timestamptz) or (agg.scheduled_at = ${decoded.value}::timestamptz and agg.id < ${decoded.id})`,
          )
    }
    // A cursor from the "other" mode means search/filters changed
    // between pages — the frontend always resets the cursor when that
    // happens, so this branch only matters defensively.
  }

  if (relevanceMode) {
    outer = isBefore
      ? outer.orderBy('agg.relevance', 'asc').orderBy('agg.id', 'desc')
      : outer.orderBy('agg.relevance', 'desc').orderBy('agg.id', 'asc')
  } else {
    // Newest/soonest-scheduled first, descending — see the function doc
    // comment for why the browse list reads this way (top = "now",
    // scrolling down goes further into the past).
    outer = isBefore
      ? outer.orderBy('agg.scheduled_at', 'asc').orderBy('agg.id', 'asc')
      : outer.orderBy('agg.scheduled_at', 'desc').orderBy('agg.id', 'desc')
  }

  const rows = await outer.limit(filters.limit + 1).execute()
  const hasExtra = rows.length > filters.limit
  const trimmed = rows.slice(0, filters.limit)
  // A `before` fetch queried in reverse (closest-to-cursor first) so
  // `LIMIT` would grab the right rows — flip back to canonical ascending
  // order before this page is used for anything else.
  const page = isBefore ? trimmed.reverse() : trimmed

  const first = page[0]
  const last = page[page.length - 1]
  const encode = (row: NonNullable<typeof first>) =>
    relevanceMode ? `relevance|${row.relevance}|${row.id}` : `schedule|${row.scheduled_at_cursor}|${row.id}`

  // No cursor (first page ever): nothing precedes it, "more after" iff
  // the over-fetch found an extra row.
  // Forward from a cursor: there's always something before (the pages
  // already seen); "more after" iff the over-fetch found an extra row.
  // Backward from a cursor: there's always something after (the point we
  // paged back from); "more before" iff the (reversed) over-fetch found
  // an extra row further back.
  const hasPrevious = !filters.cursor ? false : isBefore ? hasExtra : true
  const hasNext = !filters.cursor ? hasExtra : isBefore ? true : hasExtra

  return {
    sessions: page.map((row) => ({
      id: row.id,
      status: row.status,
      name: row.name,
      scheduledAt: row.scheduled_at as Date,
      durationMinutes: row.duration_minutes,
      capacity: row.capacity as number,
      joinedCount: Number(row.joined_count),
      topic: { id: row.topic_id, slug: row.topic_slug, label: row.topic_label },
    })),
    nextCursor: hasNext && last ? encode(last) : null,
    prevCursor: hasPrevious && first ? encode(first) : null,
  }
}

export async function getRoster(db: Kysely<Database>, sessionId: string): Promise<RosterEntry[]> {
  const rows = await db
    .selectFrom('session_users')
    .select(['user_id', 'turn_order'])
    .where('session_id', '=', sessionId)
    .orderBy('turn_order', 'asc')
    .execute()

  return rows
    .filter((row) => row.turn_order !== null)
    .map((row) => ({ userId: row.user_id, turnOrder: row.turn_order as number }))
}

// Session lifecycle status only — current_turn_user_id/roster are no
// longer read from Postgres here (Redis is the live authority for those,
// via websocket-service; see adapters/websocketServiceAdapter.ts's
// getTurnState). sessionService.getSessionState composes this with a
// websocketServiceAdapter.getTurnState call to assemble the full
// SessionState shape the frontend expects.
export async function getSessionStatus(
  db: Kysely<Database>,
  sessionId: string,
): Promise<{ id: string; status: SessionState['status'] } | null> {
  const session = await db
    .selectFrom('sessions')
    .select(['id', 'status'])
    .where('id', '=', sessionId)
    .executeTakeFirst()

  return session ?? null
}

export interface JoinSessionResult {
  entry: RosterEntry
  // False for a revisit (already a member — see the `existing` branch
  // below). sessionRouter.ts's `join`/`visit` use this to decide whether
  // to fan out a live participant-joined presence event: without it,
  // every returning visit to a session you're already in would
  // re-announce you as freshly joined to everyone currently viewing it.
  isNewJoin: boolean
}

export async function joinSession(db: Kysely<Database>, sessionId: string, userId: string): Promise<JoinSessionResult> {
  return db.transaction().execute(async (trx) => {
    const session = await trx
      .selectFrom('sessions')
      .select(['id', 'capacity'])
      .where('id', '=', sessionId)
      .forUpdate()
      .executeTakeFirst()

    if (!session) {
      throw new SessionNotFoundError(`session ${sessionId} not found`)
    }

    const roster = await getRoster(trx, sessionId)
    const existing = roster.find((entry) => entry.userId === userId)
    if (existing) {
      // Revisiting an already-joined session — no new membership row, just
      // bump recency so the sidebar's "recent sessions" list reflects it.
      await trx
        .updateTable('session_users')
        .set({ last_visited_at: sql`now()` })
        .where('session_id', '=', sessionId)
        .where('user_id', '=', userId)
        .execute()
      return { entry: existing, isNewJoin: false }
    }

    const capacity = session.capacity ?? MAX_USERS_PER_SESSION
    if (roster.length >= capacity) {
      throw new SessionFullError(`session ${sessionId} is full`)
    }

    const turnOrder = roster.length

    await trx
      .insertInto('session_users')
      .values({ session_id: sessionId, user_id: userId, turn_order: turnOrder })
      .execute()

    if (turnOrder === 0) {
      await trx
        .updateTable('sessions')
        .set({ status: 'active', current_turn_user_id: userId })
        .where('id', '=', sessionId)
        .execute()
    }

    return { entry: { userId, turnOrder }, isNewJoin: true }
  })
}

// Public-safe session info — no roster/user IDs, unlike SessionState —
// for anyone verified to look up, regardless of membership. Backs
// SessionPage.tsx's existence check (via session.visit) and header.
// Unlike OpenSession, `topic` is nullable: this looks up *any* session by
// id, including the ad-hoc turn-based flow's topicless ones, not just
// scheduled circles.
export interface SessionSummary {
  id: string
  status: 'forming' | 'active' | 'completed' | 'cancelled'
  name: string | null
  scheduledAt: Date | null
  durationMinutes: number | null
  capacity: number | null
  joinedCount: number
  topic: Topic | null
}

export async function getSessionSummary(db: Kysely<Database>, sessionId: string): Promise<SessionSummary | null> {
  const row = await db
    .selectFrom('sessions as s')
    .leftJoin('topics as t', 't.id', 's.topic_id')
    .leftJoin('session_users as su', 'su.session_id', 's.id')
    .select(({ fn }) => [
      's.id as id',
      's.status as status',
      's.name as name',
      's.scheduled_at as scheduled_at',
      's.duration_minutes as duration_minutes',
      's.capacity as capacity',
      't.id as topic_id',
      't.slug as topic_slug',
      't.label as topic_label',
      fn.count<string>('su.user_id').as('joined_count'),
    ])
    .where('s.id', '=', sessionId)
    .groupBy(['s.id', 't.id'])
    .executeTakeFirst()

  if (!row) return null

  return {
    id: row.id,
    status: row.status,
    name: row.name,
    scheduledAt: row.scheduled_at,
    durationMinutes: row.duration_minutes,
    capacity: row.capacity,
    joinedCount: Number(row.joined_count),
    topic: row.topic_id ? { id: row.topic_id, slug: row.topic_slug!, label: row.topic_label! } : null,
  }
}

// One row per session this user has ever visited (= joined — see
// joinSession), for the dashboard sidebar's "recent sessions" list.
export interface RecentVisit {
  id: string
  status: 'forming' | 'active' | 'completed' | 'cancelled'
  name: string | null
  scheduledAt: Date | null
  durationMinutes: number | null
  topic: Topic | null
  lastVisitedAt: Date
}

export interface ListRecentVisitsFilters {
  userId: string
  search?: string
  // Forward-only, "load more" pagination — not the bidirectional windowed
  // scroll listOpenSessions uses for /start/join's browse list. Each page
  // is strictly older (by last_visited_at) than the one before it.
  cursor?: string
  limit: number
}

export interface ListRecentVisitsResult {
  visits: RecentVisit[]
  nextCursor: string | null
}

function parseVisitCursor(cursor: string): { value: string; id: string } {
  const [value, id] = cursor.split('|')
  if (value === undefined || !id) {
    throw new Error(`invalid cursor: ${cursor}`)
  }
  return { value, id }
}

// Same search semantics as listOpenSessions above (ilike + pg_trgm
// similarity against the same display-name expression) — "recent
// sessions" search should feel identical to /start/join's search, just
// scoped to this user's own visited sessions instead of all open circles.
export async function listRecentSessionVisits(
  db: Kysely<Database>,
  filters: ListRecentVisitsFilters,
): Promise<ListRecentVisitsResult> {
  const searchTerm = filters.search?.trim()

  let query = db
    .selectFrom('session_users as su')
    .innerJoin('sessions as s', 's.id', 'su.session_id')
    .leftJoin('topics as t', 't.id', 's.topic_id')
    .select([
      's.id as id',
      's.status as status',
      's.name as name',
      's.scheduled_at as scheduled_at',
      's.duration_minutes as duration_minutes',
      't.id as topic_id',
      't.slug as topic_slug',
      't.label as topic_label',
      'su.last_visited_at as last_visited_at',
      // Text form for the cursor — see listOpenSessions' scheduled_at_cursor
      // comment above for why (Date round-tripping loses timestamptz's
      // microsecond precision, this doesn't).
      sql<string>`su.last_visited_at::text`.as('last_visited_at_cursor'),
    ])
    .where('su.user_id', '=', filters.userId)

  if (searchTerm) {
    query = query.where(
      sql<boolean>`(${DISPLAY_NAME_SQL} ilike ${'%' + searchTerm + '%'} or public.similarity(${DISPLAY_NAME_SQL}, ${searchTerm}) > 0.3)`,
    )
  }

  if (filters.cursor) {
    const decoded = parseVisitCursor(filters.cursor)
    query = query.where(
      sql<boolean>`(su.last_visited_at < ${decoded.value}::timestamptz) or (su.last_visited_at = ${decoded.value}::timestamptz and s.id < ${decoded.id})`,
    )
  }

  const rows = await query
    .orderBy('su.last_visited_at', 'desc')
    .orderBy('s.id', 'desc')
    .limit(filters.limit + 1)
    .execute()

  const hasMore = rows.length > filters.limit
  const page = rows.slice(0, filters.limit)
  const last = page[page.length - 1]

  return {
    visits: page.map((row) => ({
      id: row.id,
      status: row.status,
      name: row.name,
      scheduledAt: row.scheduled_at,
      durationMinutes: row.duration_minutes,
      topic: row.topic_id ? { id: row.topic_id, slug: row.topic_slug!, label: row.topic_label! } : null,
      lastVisitedAt: row.last_visited_at,
    })),
    nextCursor: hasMore && last ? `${last.last_visited_at_cursor}|${last.id}` : null,
  }
}

// Every document/acknowledgment SessionPage.tsx's CommunityGuidelinesModal
// covers (community guidelines + privacy policy together, an anonymity
// acknowledgment, and terms of service + circle liability) — recorded as
// separate keys, not one combined flag, so each is individually
// timestamped/auditable. This is the single gate for joining any circle
// (direct visit, /start/join, "New session" all funnel through
// session.visit -> checkGuidelines). Adding a future new checkbox is
// just a new key here — the storage (session_users.agreements, a jsonb
// map) needs no migration to support it.
export const CIRCLE_GUIDELINE_AGREEMENT_KEYS = [
  'community_guidelines',
  'privacy_policy',
  'anonymity_acknowledgement',
  'terms_of_service',
] as const

// Idempotent via a jsonb merge where the *existing* value wins on a key
// that's already present (`new || existing`, not `existing || new`) — a
// retried/duplicate call (or re-submitting a key that was actually
// agreed to on a *different* session, in checkAndSyncGuidelines below)
// can't overwrite a real legal-record timestamp with a later one; only a
// genuinely new key's timestamp actually takes effect. A WHERE that
// matches nothing (caller runs this before the user has actually joined
// *this* session) is a silent no-op, same as any other 0-row UPDATE.
async function mergeAgreements(
  db: Kysely<Database>,
  sessionId: string,
  userId: string,
  entries: Record<string, string>,
): Promise<void> {
  await db
    .updateTable('session_users')
    .set({ agreements: sql`${JSON.stringify(entries)}::jsonb || agreements` })
    .where('session_id', '=', sessionId)
    .where('user_id', '=', userId)
    .execute()
}

export interface GuidelinesCheckResult {
  // False the moment a *new* required key exists that this user has
  // never agreed to anywhere — e.g. a checkbox added to
  // CIRCLE_GUIDELINE_AGREEMENT_KEYS after they'd already agreed to the
  // old set. Never false again for keys they've already cleared.
  agreed: boolean
  // Which required keys this user has already agreed to (on this
  // session or any other) — CommunityGuidelinesModal pre-checks exactly
  // these and leaves the rest (a newly-added key, most commonly) for the
  // user to actually check before they can proceed.
  agreedKeys: (typeof CIRCLE_GUIDELINE_AGREEMENT_KEYS)[number][]
}

// The single guidelines check — checks *and* keeps this session's row in
// sync, in one call. Looks across every session_users row this user has
// (not just this one, and not just "did some other session have the
// complete set" — a user who agreed to the old keys before a new
// checkbox was added has no session with the *complete* current set,
// but should still see the old ones pre-checked, not blank). Per key,
// the earliest timestamp found anywhere wins if it somehow appears more
// than once — the true original consent moment, never bumped by a later
// revisit. Whatever's already agreed gets synced onto *this* session's
// row too (a harmless no-op via the merge in mergeAgreements for keys it
// already has), so this row's own record stays a complete, accurate
// snapshot regardless of where each key was originally agreed.
export async function checkAndSyncGuidelines(
  db: Kysely<Database>,
  sessionId: string,
  userId: string,
): Promise<GuidelinesCheckResult> {
  const rows = await db.selectFrom('session_users').select('agreements').where('user_id', '=', userId).execute()

  const earliest: Record<string, string> = {}
  for (const row of rows) {
    for (const [key, timestamp] of Object.entries(row.agreements)) {
      const existing = earliest[key]
      if (!existing || timestamp < existing) {
        earliest[key] = timestamp
      }
    }
  }

  const agreedKeys = CIRCLE_GUIDELINE_AGREEMENT_KEYS.filter((key) => key in earliest)
  const missing = CIRCLE_GUIDELINE_AGREEMENT_KEYS.filter((key) => !(key in earliest))

  if (agreedKeys.length > 0) {
    const toSync: Record<string, string> = {}
    for (const key of agreedKeys) toSync[key] = earliest[key] as string
    await mergeAgreements(db, sessionId, userId, toSync)
  }

  return { agreed: missing.length === 0, agreedKeys }
}

export async function recordGuidelinesAgreement(db: Kysely<Database>, sessionId: string, userId: string): Promise<void> {
  const now = new Date().toISOString()
  const entries: Record<string, string> = {}
  for (const key of CIRCLE_GUIDELINE_AGREEMENT_KEYS) entries[key] = now

  await mergeAgreements(db, sessionId, userId, entries)
}

// Scoped to 'active' only — authRouter.ts's completeProfile calls this to
// fan a live display-name update out to every session the saving user
// currently belongs to (see websocketServiceAdapter.ts's
// notifyProfileUpdated). A 'forming'/'completed'/'cancelled' session has
// no live chat view to update, so there's no point paying for the
// websocket-service round trip for those — publishing to a room with no
// connected listeners is a harmless no-op regardless, but this avoids
// fanning out to a user's entire multi-year session history on every
// profile save.
export async function listActiveSessionIdsForUser(db: Kysely<Database>, userId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('session_users')
    .innerJoin('sessions', 'sessions.id', 'session_users.session_id')
    .select('session_users.session_id')
    .where('session_users.user_id', '=', userId)
    .where('sessions.status', '=', 'active')
    .execute()
  return rows.map((r) => r.session_id)
}
