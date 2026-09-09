import type { Database } from '@mincirklen/shared'
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
