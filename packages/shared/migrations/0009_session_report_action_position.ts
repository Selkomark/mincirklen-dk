import { sql, type Kysely } from 'kysely'

// Outcomes of one decision are inserted together and so share a
// created_at; their order (the order the reviewer listed them) needs its
// own column. Back-filled by (created_at, id) for rows that exist.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('session_report_actions')
    .addColumn('position', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()
  await sql`
    update session_report_actions a
    set position = n.position
    from (
      select id, row_number() over (partition by report_id order by created_at, id) - 1 as position
      from session_report_actions
    ) n
    where n.id = a.id
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('session_report_actions').dropColumn('position').execute()
}
