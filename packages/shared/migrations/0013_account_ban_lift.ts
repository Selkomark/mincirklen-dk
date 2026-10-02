import type { Kysely } from 'kysely'

// A ban can be lifted. The row stays — it is the record of a decision
// that was made, and docs/gdpr-runbook.md's disclosure logic depends on
// it — but a lifted ban no longer refuses the identity at login
// (accountBanRepository.ts's findBanByIdentityHash ignores rows with
// lifted_at set). Who lifted it and their note live here too.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('account_bans').addColumn('lifted_at', 'timestamptz').execute()
  await db.schema
    .alterTable('account_bans')
    .addColumn('lifted_by', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .execute()
  await db.schema.alterTable('account_bans').addColumn('lift_note', 'text').execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('account_bans').dropColumn('lift_note').execute()
  await db.schema.alterTable('account_bans').dropColumn('lifted_by').execute()
  await db.schema.alterTable('account_bans').dropColumn('lifted_at').execute()
}
