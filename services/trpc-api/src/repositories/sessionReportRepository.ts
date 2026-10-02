import type { BanReasonCategory, Database, SessionReportAction, SessionReportDecision, SessionReportStatus } from '@mincirklen/shared'
import { sql, type Kysely } from 'kysely'

// "Report this session" (SessionPage.tsx's ReportSessionModal) — a
// user-initiated complaint, not to be confused with moderationEventRepository.ts's
// insertModerationEvent, which logs the AI classifier's own automated
// pass/flag/crisis calls on message content. See
// migrations/0001_init.ts's session_reports table doc comment.
export async function insertSessionReport(
  db: Kysely<Database>,
  params: {
    sessionId: string
    reporterUserId: string
    aboutUserIds: string[]
    messageIds?: string[]
    body: string
  },
): Promise<void> {
  await db
    .insertInto('session_reports')
    .values({
      session_id: params.sessionId,
      reporter_user_id: params.reporterUserId,
      // Explicit ::jsonb cast, same convention as sessionRepository.ts's
      // mergeAgreements — the pg driver doesn't implicitly serialize a
      // plain JS array into the jsonb column type on its own.
      about_user_ids: sql`${JSON.stringify(params.aboutUserIds)}::jsonb`,
      message_ids: sql`${JSON.stringify(params.messageIds ?? [])}::jsonb`,
      body: params.body,
    })
    .execute()
}

// ---- Review side (the /manage "Session reports" tab) ----

export interface SessionReportRow {
  id: string
  sessionId: string
  sessionName: string | null
  reporterUserId: string | null
  aboutUserIds: string[]
  messageIds: string[]
  body: string
  status: SessionReportStatus
  createdAt: Date
  reviewedAt: Date | null
  reviewedBy: string | null
  decisionNote: string | null
  // What was done, outcome by outcome (session_report_actions). Empty
  // for open reports and for "no further action".
  outcomes: ReportOutcome[]
}

export interface ReportOutcome {
  action: Exclude<SessionReportAction, 'none'>
  targetUserIds: string[]
  memberMessage: string | null
  banReasonCategory: BanReasonCategory | null
}

export interface ListSessionReportsResult {
  reports: SessionReportRow[]
  nextCursor: string | null
}

// Oldest-first within a status, same cursor shape as
// moderationEventRepository.ts's listPendingReview (created_at|id) so
// the backlog is worked in filing order. Joins sessions only for the
// display name; never user_profiles — a reviewer sees raw user ids, not
// decrypted identities, exactly as the moderation queue does (CHARTER.md
// §4). Cross-referencing an id is what the Users tab is for.
const REPORT_COLUMNS = [
  'session_reports.id as id',
  'session_reports.session_id as session_id',
  'sessions.name as session_name',
  'session_reports.reporter_user_id as reporter_user_id',
  'session_reports.about_user_ids as about_user_ids',
  'session_reports.message_ids as message_ids',
  'session_reports.body as body',
  'session_reports.status as status',
  'session_reports.created_at as created_at',
  sql<string>`session_reports.created_at::text`.as('created_at_cursor'),
  'session_reports.reviewed_at as reviewed_at',
  'session_reports.reviewed_by as reviewed_by',
  'session_reports.decision_note as decision_note',
] as const

function reportsQuery(db: Kysely<Database>) {
  return db.selectFrom('session_reports').leftJoin('sessions', 'sessions.id', 'session_reports.session_id').select(REPORT_COLUMNS)
}

type ReportQueryRow = Awaited<ReturnType<ReturnType<typeof reportsQuery>['execute']>>[number]

// Outcomes for a set of reports in one query, grouped by report, in the
// order they were recorded.
async function outcomesByReport(db: Kysely<Database>, reportIds: string[]): Promise<Map<string, ReportOutcome[]>> {
  const out = new Map<string, ReportOutcome[]>()
  if (reportIds.length === 0) return out
  const rows = await db
    .selectFrom('session_report_actions')
    .select(['report_id', 'action', 'target_user_ids', 'member_message', 'ban_reason_category'])
    .where('report_id', 'in', reportIds)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute()
  for (const row of rows) {
    out.set(row.report_id, [
      ...(out.get(row.report_id) ?? []),
      { action: row.action, targetUserIds: row.target_user_ids, memberMessage: row.member_message, banReasonCategory: row.ban_reason_category },
    ])
  }
  return out
}

async function attachOutcomes(db: Kysely<Database>, rows: ReportQueryRow[]): Promise<SessionReportRow[]> {
  const outcomes = await outcomesByReport(
    db,
    rows.map((row) => row.id),
  )
  return rows.map((row) => ({ ...toSessionReportRow(row), outcomes: outcomes.get(row.id) ?? [] }))
}

function toSessionReportRow(row: ReportQueryRow): SessionReportRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    sessionName: row.session_name,
    reporterUserId: row.reporter_user_id,
    aboutUserIds: row.about_user_ids,
    messageIds: row.message_ids,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    decisionNote: row.decision_note,
    outcomes: [],
  }
}

export async function findSessionReportById(db: Kysely<Database>, reportId: string): Promise<SessionReportRow | null> {
  const row = await reportsQuery(db).where('session_reports.id', '=', reportId).executeTakeFirst()
  if (!row) return null
  const [report] = await attachOutcomes(db, [row])
  return report ?? null
}

// Every other report naming any of these members — the review dialog's
// history panel. `?|` is jsonb "has any of these keys", which for a
// jsonb array of strings is "contains any of these values".
export async function listReportsAboutUsers(db: Kysely<Database>, userIds: string[], excludeReportId: string): Promise<SessionReportRow[]> {
  if (userIds.length === 0) return []
  const rows = await reportsQuery(db)
    .where(sql<boolean>`session_reports.about_user_ids ?| ${userIds}::text[]`)
    .where('session_reports.id', '!=', excludeReportId)
    .orderBy('session_reports.created_at', 'desc')
    .limit(50)
    .execute()
  return attachOutcomes(db, rows)
}

export async function listSessionReports(
  db: Kysely<Database>,
  params: { status: SessionReportStatus; cursor?: string; limit: number },
): Promise<ListSessionReportsResult> {
  let query = reportsQuery(db).where('session_reports.status', '=', params.status)

  if (params.cursor) {
    const [cursorCreatedAt, cursorId] = params.cursor.split('|')
    query = query.where(
      sql<boolean>`(session_reports.created_at > ${cursorCreatedAt}::timestamptz) or (session_reports.created_at = ${cursorCreatedAt}::timestamptz and session_reports.id > ${cursorId})`,
    )
  }

  const rows = await query
    .orderBy('session_reports.created_at', 'asc')
    .orderBy('session_reports.id', 'asc')
    .limit(params.limit + 1)
    .execute()

  const hasMore = rows.length > params.limit
  const page = rows.slice(0, params.limit)
  const last = page[page.length - 1]

  return {
    reports: await attachOutcomes(db, page),
    nextCursor: hasMore && last ? `${last.created_at_cursor}|${last.id}` : null,
  }
}

export interface SessionReportForReview {
  status: SessionReportStatus
  sessionId: string
  aboutUserIds: string[]
  messageIds: string[]
}

// What reviewSessionReport needs to validate an action against: the
// current status, and which members / messages the report actually names.
export async function findSessionReportForReview(db: Kysely<Database>, reportId: string): Promise<SessionReportForReview | null> {
  const row = await db
    .selectFrom('session_reports')
    .select(['status', 'session_id', 'about_user_ids', 'message_ids'])
    .where('id', '=', reportId)
    .executeTakeFirst()
  return row ? { status: row.status, sessionId: row.session_id, aboutUserIds: row.about_user_ids, messageIds: row.message_ids } : null
}

// What the transcript view needs to anchor itself: which circle, and
// the instant the member hit "report" — the messages just before that
// are what prompted it.
//
// `createdAtExact` is Postgres's own text form of the timestamp (same
// precision rationale as messageRepository.ts's created_at_cursor): a JS
// Date only keeps milliseconds, so comparing against it in SQL would put
// a message stamped in the same millisecond as the report on the wrong
// side of the window.
export async function findSessionReportAnchor(
  db: Kysely<Database>,
  reportId: string,
): Promise<{ sessionId: string; createdAt: Date; createdAtExact: string; aboutUserIds: string[]; messageIds: string[] } | null> {
  const row = await db
    .selectFrom('session_reports')
    .select(['session_id', 'created_at', 'about_user_ids', 'message_ids', sql<string>`created_at::text`.as('created_at_exact')])
    .where('id', '=', reportId)
    .executeTakeFirst()
  return row
    ? {
        sessionId: row.session_id,
        createdAt: row.created_at,
        createdAtExact: row.created_at_exact,
        aboutUserIds: row.about_user_ids,
        messageIds: row.message_ids,
      }
    : null
}

// The decision and its outcomes land together — one transaction, so a
// report is never marked decided with half its outcomes missing.
export async function applySessionReportDecision(
  db: Kysely<Database>,
  params: {
    reportId: string
    status: SessionReportDecision
    reviewedBy: string
    note: string
    outcomes: ReportOutcome[]
  },
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('session_reports')
      .set({ status: params.status, reviewed_at: sql`now()`, reviewed_by: params.reviewedBy, decision_note: params.note })
      .where('id', '=', params.reportId)
      .execute()
    if (params.outcomes.length > 0) {
      await trx
        .insertInto('session_report_actions')
        .values(
          params.outcomes.map((outcome) => ({
            report_id: params.reportId,
            action: outcome.action,
            target_user_ids: sql`${JSON.stringify(outcome.targetUserIds)}::jsonb`,
            member_message: outcome.memberMessage,
            ban_reason_category: outcome.banReasonCategory,
          })),
        )
        .execute()
    }
  })
}

// Who filed it — null once they've deleted their account (0001_init's
// set-null), in which case there's nobody to update.
export async function findReporterId(db: Kysely<Database>, reportId: string): Promise<string | null> {
  const row = await db.selectFrom('session_reports').select('reporter_user_id').where('id', '=', reportId).executeTakeFirst()
  return row?.reporter_user_id ?? null
}
