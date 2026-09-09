import type { Database, MessageModerationStatus } from '@mincirklen/shared'
import { sql, type Kysely } from 'kysely'
import { insertModerationEvent } from './moderationEventRepository'

export interface MessageRow {
  id: string
  sessionId: string
  userId: string
  body: string
  type: 'user' | 'system'
  moderationStatus: MessageModerationStatus
  falsePositiveReportedAt: Date | null
  createdAt: Date
}

function toMessageRow(row: {
  id: string
  session_id: string
  user_id: string
  body: string
  type: 'user' | 'system'
  moderation_status: MessageModerationStatus
  false_positive_reported_at: Date | null
  created_at: Date
}): MessageRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    body: row.body,
    type: row.type,
    moderationStatus: row.moderation_status,
    falsePositiveReportedAt: row.false_positive_reported_at,
    createdAt: row.created_at,
  }
}

// `type` defaults to 'user' — only sessionRouter.ts's join/visit call
// sites ever pass 'system', for the "X joined the circle" marker (see
// migrations/0001_init.ts). `body` is still NOT NULL for a
// system row; the frontend derives its own display text from `type` +
// `userId` and ignores body entirely for those. `moderationStatus`
// defaults to 'pass' — a system row is never classified, and this is
// also the default a caller gets if it omits the param entirely (only
// recordFlaggedMessage/recordCrisisMessage below ever pass something
// else).
export async function insertMessage(
  db: Kysely<Database>,
  params: { sessionId: string; userId: string; body: string; type?: 'user' | 'system'; moderationStatus?: MessageModerationStatus },
): Promise<MessageRow> {
  const row = await db
    .insertInto('messages')
    .values({
      session_id: params.sessionId,
      user_id: params.userId,
      body: params.body,
      type: params.type ?? 'user',
      moderation_status: params.moderationStatus ?? 'pass',
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return toMessageRow(row)
}

export interface ListMessagesParams {
  sessionId: string
  // Omitted means "give me the latest page" — see the function doc
  // comment below for why that's the same query as any other page, not
  // a special case.
  cursor?: string
  limit: number
  // Whose eyes this page is for — every flag/crisis/reviewed_pass row is
  // withheld from everyone except its own author (see the WHERE clause
  // below). A 'pass' row is unaffected — visible to the whole session as
  // always.
  requestingUserId: string
}

export interface ListMessagesResult {
  messages: MessageRow[]
  // Cursor to fetch the page of messages immediately OLDER than this
  // page's oldest row. Null means this page already reaches the start of
  // the session's history — nothing older exists.
  nextCursor: string | null
}

function parseMessageCursor(cursor: string): { value: string; id: string } {
  const [value, id] = cursor.split('|')
  if (value === undefined || !id) throw new Error(`invalid cursor: ${cursor}`)
  return { value, id }
}

// Unidirectional (see listMessagesInputSchema's doc comment) — unlike
// sessionRepository.ts's listOpenSessions, there's no `direction`. Every
// call is "the page immediately before this cursor," always queried
// newest-first (so LIMIT grabs the rows closest to the cursor) and
// reversed back to ascending/oldest-first — the natural chat reading
// order — before returning. Omitting the cursor is exactly the same
// query with no WHERE-cursor filter, which is also exactly "the latest
// page" — no synthetic anchor cursor needed the way listOpenSessions
// needs one to anchor its first fetch near "now".
export async function listMessages(db: Kysely<Database>, params: ListMessagesParams): Promise<ListMessagesResult> {
  let query = db
    .selectFrom('messages')
    .select([
      'id',
      'session_id',
      'user_id',
      'body',
      'type',
      'moderation_status',
      'false_positive_reported_at',
      'created_at',
      // Text form for the cursor, same precision rationale as
      // sessionRepository.ts's scheduled_at_cursor: created_at is
      // timestamptz (microsecond precision), while a JS Date round-trip
      // through toISOString() only has millisecond precision — that can
      // duplicate or skip a boundary row across pages. Postgres's own
      // text cast round-trips through ::timestamptz exactly.
      sql<string>`created_at::text`.as('created_at_cursor'),
    ])
    .where('session_id', '=', params.sessionId)
    // The actual privacy boundary: a flag/crisis/reviewed_pass row is
    // never returned to anyone but its own author, regardless of who
    // else is a session member. 'pass' rows are unaffected. This must
    // stay a WHERE-clause filter, not a post-fetch client-side hide —
    // the row must never leave Postgres for another participant's
    // request in the first place.
    .where((eb) => eb.or([eb('moderation_status', '=', 'pass'), eb('user_id', '=', params.requestingUserId)]))

  if (params.cursor) {
    const decoded = parseMessageCursor(params.cursor)
    query = query.where(
      sql<boolean>`(created_at < ${decoded.value}::timestamptz) or (created_at = ${decoded.value}::timestamptz and id < ${decoded.id})`,
    )
  }

  const rows = await query.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(params.limit + 1).execute()
  const hasMore = rows.length > params.limit
  const page = rows.slice(0, params.limit).reverse()
  const oldest = page[0]

  return {
    messages: page.map(toMessageRow),
    nextCursor: hasMore && oldest ? `${oldest.created_at_cursor}|${oldest.id}` : null,
  }
}

// Atomic: persist the message and log the passing classification — one
// transaction, so a failure partway through can't leave a moderation
// event without its message or vice versa. Turn advancement is no longer
// part of this transaction: that's now owned by websocket-service (Redis
// is the live authority — see adapters/redisTurnStateAdapter.ts on that
// side), and messageService.ts's sendMessage calls it explicitly via
// SendMessageDeps.advanceTurn after this resolves.
export async function recordPassedMessage(
  db: Kysely<Database>,
  params: { sessionId: string; userId: string; body: string },
): Promise<MessageRow> {
  return db.transaction().execute(async (trx) => {
    const message = await insertMessage(trx, params)
    await insertModerationEvent(trx, {
      sessionId: params.sessionId,
      userId: params.userId,
      messageId: message.id,
      classification: 'pass',
    })
    return message
  })
}

// Persists the message (moderation_status: 'flag') and logs the
// classification, atomically — same shape as recordPassedMessage above,
// just a different status and never published to the group (see
// messageService.ts's sendMessage — deps.publish is only ever called for
// 'pass'). The row exists so the sender's own next listMessages refresh
// shows it back to them (see listMessages's WHERE clause above); no
// other participant's query can ever return it. Turn advancement (a
// non-crisis flag still advances the turn, so it doesn't stall the room)
// is owned by websocket-service, same as recordPassedMessage.
export async function recordFlaggedMessage(
  db: Kysely<Database>,
  params: { sessionId: string; userId: string; body: string },
): Promise<MessageRow> {
  return db.transaction().execute(async (trx) => {
    const message = await insertMessage(trx, { ...params, moderationStatus: 'flag' })
    await insertModerationEvent(trx, {
      sessionId: params.sessionId,
      userId: params.userId,
      messageId: message.id,
      classification: 'flag',
    })
    return message
  })
}

// Same shape as recordFlaggedMessage, moderation_status 'crisis' instead
// — called from crisisEscalationService.ts's escalate() as the
// `recordCrisisMessage` dependency. Deliberately returns void, not the
// MessageRow: escalate()'s own contract (a resource card that "cannot
// fail") doesn't need it, and the sender picks the message back up the
// same way as a flag — via their own next listMessages refresh.
export async function recordCrisisMessage(
  db: Kysely<Database>,
  params: { sessionId: string; userId: string; body: string },
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const message = await insertMessage(trx, { ...params, moderationStatus: 'crisis' })
    await insertModerationEvent(trx, {
      sessionId: params.sessionId,
      userId: params.userId,
      messageId: message.id,
      classification: 'crisis',
    })
  })
}

// The message's own author disputing a flag/crisis classification —
// records a request for human review, nothing more. Guarded to the
// message's own author and to a still-disputable status, so this can
// never be used to probe for or touch someone else's message, and can
// never re-flag something a human has already cleared. Silently a no-op
// if the guard doesn't match (e.g. an already-'reviewed_pass' message,
// or a messageId that isn't this user's) — there's nothing meaningful to
// report back to the caller either way.
export async function reportFalsePositive(
  db: Kysely<Database>,
  params: { messageId: string; userId: string },
): Promise<void> {
  await db
    .updateTable('messages')
    .set({ false_positive_reported_at: sql`now()` })
    .where('id', '=', params.messageId)
    .where('user_id', '=', params.userId)
    .where('moderation_status', 'in', ['flag', 'crisis'])
    .execute()
}

// Applies a human reviewer's decision to a moderation event and, if the
// original flag/crisis call is deemed a false positive, updates the
// linked message's status to 'reviewed_pass' — deliberately NOT 'pass',
// so the record still shows this was a human override, not the
// classifier's own original verdict (see MessagesTable's comment in
// packages/shared/src/db/types.ts). Not wired to any router endpoint
// yet — there's no admin authentication/authorization model in this
// codebase to safely expose it through (same "plumbing exists, the real
// integration doesn't yet" posture as crisisEscalationService.ts's
// logEscalation being a console.error instead of real paging). Intended
// to be called from a future internal review tool.
export async function applyHumanReviewOutcome(
  db: Kysely<Database>,
  params: {
    moderationEventId: string
    outcome: 'true_positive' | 'false_positive' | 'true_negative' | 'false_negative'
    reviewedBy: string
  },
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const event = await trx
      .updateTable('moderation_events')
      .set({
        human_reviewed: true,
        human_review_outcome: params.outcome,
        reviewed_at: sql`now()`,
        reviewed_by: params.reviewedBy,
      })
      .where('id', '=', params.moderationEventId)
      .returning(['message_id'])
      .executeTakeFirstOrThrow()

    if (params.outcome === 'false_positive' && event.message_id) {
      await trx
        .updateTable('messages')
        .set({ moderation_status: 'reviewed_pass' })
        .where('id', '=', event.message_id)
        .execute()
    }
  })
}
