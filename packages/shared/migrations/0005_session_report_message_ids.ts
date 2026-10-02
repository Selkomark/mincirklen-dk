import { sql, type Kysely } from 'kysely'

// A member can now point a report at specific messages, not just at
// members (SessionPage.tsx's per-message report action). Stored the
// same way about_user_ids is — a jsonb array of ids, no join table —
// since it's read back whole, never queried by element. Empty array,
// not null, for reports filed about members alone, so readers never
// branch on null.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('session_reports')
    .addColumn('message_ids', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('session_reports').dropColumn('message_ids').execute()
}
