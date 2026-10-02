import { sql, type Kysely } from 'kysely'

// Gives a session-report decision teeth. Until now a reviewer could only
// record reviewed/dismissed; this adds what they did about it
// (session_reports.action + targets), a moderator-only note history per
// member, a 'removed' message state for hiding reported messages, and a
// separate users.ban permission so resolving reports and banning
// accounts can be held by different roles. Bans themselves reuse
// 0001_init's account_bans / account_ban_evidence, which until now had no
// write path at all.

const PERMISSIONS: Array<{ slug: string; description: string }> = [
  { slug: 'users.ban', description: 'Ban a member — their sign-in identity is refused from then on' },
]

const GRANTS: Record<string, string[]> = {
  ADMIN: ['users.ban'],
  'TRUST-SAFETY-LEAD': ['users.ban'],
}

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('session_reports').addColumn('action', 'text').execute()
  await db.schema
    .alterTable('session_reports')
    .addColumn('action_target_user_ids', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .execute()
  await sql`alter table session_reports add constraint session_reports_action_check check (action is null or action in ('none','note','warn','remove_from_session','hide_messages','ban'))`.execute(db)

  await db.schema
    .createTable('member_notes')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('report_id', 'uuid', (col) => col.references('session_reports.id').onDelete('set null'))
    .addColumn('body', 'text', (col) => col.notNull())
    .addColumn('created_by', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()
  await db.schema.createIndex('member_notes_user_id_created_at_idx').on('member_notes').columns(['user_id', 'created_at']).execute()

  await sql`alter table messages drop constraint messages_moderation_status_check`.execute(db)
  await sql`alter table messages add constraint messages_moderation_status_check check (moderation_status in ('pass','flag','crisis','reviewed_pass','removed'))`.execute(db)
  await db.schema.alterTable('messages').addColumn('removed_at', 'timestamptz').execute()
  await db.schema
    .alterTable('messages')
    .addColumn('removed_by', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .execute()

  await db
    .insertInto('permissions')
    .values(PERMISSIONS)
    .onConflict((oc) => oc.column('slug').doNothing())
    .execute()
  const permissionRows = await db
    .selectFrom('permissions')
    .select(['id', 'slug'])
    .where('slug', 'in', PERMISSIONS.map((p) => p.slug))
    .execute()
  const permissionIdBySlug = new Map<string, string>(permissionRows.map((row: { id: string; slug: string }) => [row.slug, row.id]))
  const roleRows = await db.selectFrom('roles').select(['id', 'name']).where('name', 'in', Object.keys(GRANTS)).execute()
  for (const role of roleRows as Array<{ id: string; name: string }>) {
    const permissionIds = (GRANTS[role.name] ?? []).map((slug) => permissionIdBySlug.get(slug)).filter((id): id is string => id !== undefined)
    if (permissionIds.length === 0) continue
    await db
      .insertInto('role_permissions')
      .values(permissionIds.map((permissionId) => ({ role_id: role.id, permission_id: permissionId })))
      .onConflict((oc) => oc.columns(['role_id', 'permission_id']).doNothing())
      .execute()
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await db
    .deleteFrom('permissions')
    .where('slug', 'in', PERMISSIONS.map((p) => p.slug))
    .execute()

  await db.schema.alterTable('messages').dropColumn('removed_by').execute()
  await db.schema.alterTable('messages').dropColumn('removed_at').execute()
  // Rows already 'removed' would violate the restored constraint — fold
  // them back to 'pass' first; the down path trades the moderator's
  // decision for schema consistency, which is the right default for a
  // rollback.
  await sql`update messages set moderation_status = 'pass' where moderation_status = 'removed'`.execute(db)
  await sql`alter table messages drop constraint messages_moderation_status_check`.execute(db)
  await sql`alter table messages add constraint messages_moderation_status_check check (moderation_status in ('pass','flag','crisis','reviewed_pass'))`.execute(db)

  await db.schema.dropTable('member_notes').execute()

  await sql`alter table session_reports drop constraint session_reports_action_check`.execute(db)
  await db.schema.alterTable('session_reports').dropColumn('action_target_user_ids').execute()
  await db.schema.alterTable('session_reports').dropColumn('action').execute()
}
