import type { Database, SessionReportDecision, SessionReportStatus } from '@mincirklen/shared'
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
  body: string
  status: SessionReportStatus
  createdAt: Date
  reviewedAt: Date | null
  reviewedBy: string | null
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
export async function listSessionReports(
  db: Kysely<Database>,
  params: { status: SessionReportStatus; cursor?: string; limit: number },
): Promise<ListSessionReportsResult> {
  let query = db
    .selectFrom('session_reports')
    .leftJoin('sessions', 'sessions.id', 'session_reports.session_id')
    .select([
      'session_reports.id as id',
      'session_reports.session_id as session_id',
      'sessions.name as session_name',
      'session_reports.reporter_user_id as reporter_user_id',
      'session_reports.about_user_ids as about_user_ids',
      'session_reports.body as body',
      'session_reports.status as status',
      'session_reports.created_at as created_at',
      sql<string>`session_reports.created_at::text`.as('created_at_cursor'),
      'session_reports.reviewed_at as reviewed_at',
      'session_reports.reviewed_by as reviewed_by',
    ])
    .where('session_reports.status', '=', params.status)

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
    reports: page.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      sessionName: row.session_name,
      reporterUserId: row.reporter_user_id,
      aboutUserIds: row.about_user_ids,
      body: row.body,
      status: row.status,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
      reviewedBy: row.reviewed_by,
    })),
    nextCursor: hasMore && last ? `${last.created_at_cursor}|${last.id}` : null,
  }
}

export async function findSessionReportStatus(db: Kysely<Database>, reportId: string): Promise<{ status: SessionReportStatus } | null> {
  const row = await db.selectFrom('session_reports').select('status').where('id', '=', reportId).executeTakeFirst()
  return row ?? null
}

export async function applySessionReportDecision(
  db: Kysely<Database>,
  params: { reportId: string; status: SessionReportDecision; reviewedBy: string },
): Promise<void> {
  await db
    .updateTable('session_reports')
    .set({ status: params.status, reviewed_at: sql`now()`, reviewed_by: params.reviewedBy })
    .where('id', '=', params.reportId)
    .execute()
}
