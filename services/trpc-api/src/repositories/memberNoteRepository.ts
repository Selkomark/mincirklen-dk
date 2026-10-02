import type { Database, MemberNote } from '@mincirklen/shared'
import type { Kysely } from 'kysely'

// Moderator-only history on a member — see migrations/0006_moderation_actions.ts.
export async function insertMemberNote(
  db: Kysely<Database>,
  params: { userId: string; body: string; createdBy: string; reportId?: string | null },
): Promise<void> {
  await db
    .insertInto('member_notes')
    .values({ user_id: params.userId, body: params.body, created_by: params.createdBy, report_id: params.reportId ?? null })
    .execute()
}

export async function listMemberNotes(db: Kysely<Database>, userId: string): Promise<MemberNote[]> {
  const rows = await db
    .selectFrom('member_notes')
    .select(['id', 'user_id', 'report_id', 'body', 'created_by', 'created_at'])
    .where('user_id', '=', userId)
    .orderBy('created_at', 'desc')
    .execute()
  return rows.map((row) => ({ id: row.id, userId: row.user_id, reportId: row.report_id, body: row.body, createdBy: row.created_by, createdAt: row.created_at }))
}
