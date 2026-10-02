import type { Kysely } from 'kysely'

// A reviewer's decision on a flagged message carries a written reason.
// The outcome alone (true/false positive) says *what* the classifier got
// wrong; the reason says *why* — which is what a future training pass
// on these events needs. Required at the API for new decisions; existing
// rows stay null.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('moderation_events').addColumn('human_review_note', 'text').execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('moderation_events').dropColumn('human_review_note').execute()
}
