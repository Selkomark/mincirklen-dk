import { sql, type Kysely } from 'kysely'

// A decision can now carry several outcomes — warn one member, ban
// another — instead of 0006's single action applied to a list of
// members. Each outcome is its own row with the members it applies to
// and the extra field its action needs. Existing single-action decisions
// are copied across so nothing already decided is lost, then the two
// columns on session_reports go away.

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('session_report_actions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('report_id', 'uuid', (col) => col.notNull().references('session_reports.id').onDelete('cascade'))
    .addColumn('action', 'text', (col) => col.notNull())
    .addColumn('target_user_ids', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('member_message', 'text')
    .addColumn('ban_reason_category', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('session_report_actions_action_check', sql`action in ('note','warn','remove_from_session','hide_messages','ban')`)
    .addCheckConstraint(
      'session_report_actions_ban_reason_check',
      sql`ban_reason_category is null or ban_reason_category in ('predatory_contact','harassment','crisis_abuse','illegal_content','other')`,
    )
    .execute()
  await db.schema.createIndex('session_report_actions_report_id_idx').on('session_report_actions').column('report_id').execute()

  // Carry 0006's single action over. 'none' had no row's worth of
  // meaning; the warn text and ban reason were never stored before, so
  // they come across null.
  await sql`
    insert into session_report_actions (report_id, action, target_user_ids, created_at)
    select id, action, action_target_user_ids, coalesce(reviewed_at, now())
    from session_reports
    where action is not null and action <> 'none'
  `.execute(db)

  await sql`alter table session_reports drop constraint session_reports_action_check`.execute(db)
  await db.schema.alterTable('session_reports').dropColumn('action_target_user_ids').execute()
  await db.schema.alterTable('session_reports').dropColumn('action').execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('session_reports').addColumn('action', 'text').execute()
  await db.schema
    .alterTable('session_reports')
    .addColumn('action_target_user_ids', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .execute()
  await sql`alter table session_reports add constraint session_reports_action_check check (action is null or action in ('none','note','warn','remove_from_session','hide_messages','ban'))`.execute(db)
  // Lossy by nature: a multi-outcome decision folds back to its first
  // outcome, which is all the old shape can hold.
  await sql`
    update session_reports r
    set action = a.action, action_target_user_ids = a.target_user_ids
    from (
      select distinct on (report_id) report_id, action, target_user_ids
      from session_report_actions
      order by report_id, created_at asc, id asc
    ) a
    where a.report_id = r.id
  `.execute(db)
  await db.schema.dropTable('session_report_actions').execute()
}
