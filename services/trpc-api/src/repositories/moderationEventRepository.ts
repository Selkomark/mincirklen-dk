import type { Classification, Database } from '@mincirklen/shared'
import { sql, type Kysely } from 'kysely'

export interface PendingReviewEvent {
  id: string
  sessionId: string
  userId: string
  classification: 'flag' | 'crisis'
  createdAt: Date
  message: { body: string; createdAt: Date } | null
}

export interface ListPendingReviewResult {
  events: PendingReviewEvent[]
  nextCursor: string | null
}

// Oldest-first (work the backlog in order, unlike messageRepository.ts's
// listMessages which is newest-first for a live chat view). Left-joins
// messages since message_id can be null (on delete set null) — a
// moderation_event whose message was later removed still needs to show up
// for review, just without body content. Never joins user_profiles/PII —
// a reviewer sees the raw user_id for correlating repeat patterns, not a
// decrypted identity (CHARTER.md §4).
export async function listPendingReview(
  db: Kysely<Database>,
  params: { cursor?: string; limit: number },
): Promise<ListPendingReviewResult> {
  let query = db
    .selectFrom('moderation_events')
    .leftJoin('messages', 'messages.id', 'moderation_events.message_id')
    .select([
      'moderation_events.id as id',
      'moderation_events.session_id as session_id',
      'moderation_events.user_id as user_id',
      'moderation_events.classification as classification',
      'moderation_events.created_at as created_at',
      sql<string>`moderation_events.created_at::text`.as('created_at_cursor'),
      'messages.body as message_body',
      'messages.created_at as message_created_at',
    ])
    .where('moderation_events.classification', 'in', ['flag', 'crisis'])
    .where('moderation_events.human_reviewed', '=', false)

  if (params.cursor) {
    const [cursorCreatedAt, cursorId] = params.cursor.split('|')
    query = query.where(
      sql<boolean>`(moderation_events.created_at > ${cursorCreatedAt}::timestamptz) or (moderation_events.created_at = ${cursorCreatedAt}::timestamptz and moderation_events.id > ${cursorId})`,
    )
  }

  const rows = await query
    .orderBy('moderation_events.created_at', 'asc')
    .orderBy('moderation_events.id', 'asc')
    .limit(params.limit + 1)
    .execute()

  const hasMore = rows.length > params.limit
  const page = rows.slice(0, params.limit)
  const last = page[page.length - 1]

  return {
    events: page.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      userId: row.user_id,
      classification: row.classification as 'flag' | 'crisis',
      createdAt: row.created_at,
      message: row.message_body !== null && row.message_created_at !== null
        ? { body: row.message_body, createdAt: row.message_created_at }
        : null,
    })),
    nextCursor: hasMore && last ? `${last.created_at_cursor}|${last.id}` : null,
  }
}

export interface ModerationOutcomeCounts {
  truePositive: number
  falsePositive: number
  trueNegative: number
  falseNegative: number
}

// Aggregate-only, no per-event detail — this is exactly what
// ModerationTransparencyPage.tsx needs and nothing more (publicProcedure,
// no auth, no PII).
export async function countHumanReviewOutcomes(db: Kysely<Database>): Promise<ModerationOutcomeCounts> {
  const rows = await db
    .selectFrom('moderation_events')
    .select(['human_review_outcome', db.fn.countAll().as('count')])
    .where('human_reviewed', '=', true)
    .groupBy('human_review_outcome')
    .execute()

  const counts: ModerationOutcomeCounts = { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 }
  for (const row of rows) {
    const n = Number(row.count)
    if (row.human_review_outcome === 'true_positive') counts.truePositive = n
    else if (row.human_review_outcome === 'false_positive') counts.falsePositive = n
    else if (row.human_review_outcome === 'true_negative') counts.trueNegative = n
    else if (row.human_review_outcome === 'false_negative') counts.falseNegative = n
  }
  return counts
}

export async function insertModerationEvent(
  db: Kysely<Database>,
  params: {
    sessionId: string
    userId: string
    messageId: string | null
    classification: Classification
  },
): Promise<void> {
  await db
    .insertInto('moderation_events')
    .values({
      session_id: params.sessionId,
      user_id: params.userId,
      message_id: params.messageId,
      classification: params.classification,
    })
    .execute()
}
