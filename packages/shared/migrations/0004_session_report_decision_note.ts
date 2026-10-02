import type { Kysely } from 'kysely'

// Every session-report decision now records the reviewer's reasoning
// (sessionReportService.ts::reviewSessionReport refuses one without it).
// Nullable at the column level only because existing rows predate it;
// the service makes it effectively required from here on.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('session_reports').addColumn('decision_note', 'text').execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('session_reports').dropColumn('decision_note').execute()
}
