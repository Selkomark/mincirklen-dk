import { sql, type Kysely } from 'kysely'

// Makes member-filed session reports reviewable from /manage. Before
// this, session_reports (0001_init) was write-only: a row plus a log
// line, nothing ever read it back. Adds the review state and the two
// permissions that gate the new "Session reports" tab, and hands those
// permissions to the roles that plausibly work the queue.

const PERMISSIONS: Array<{ slug: string; description: string }> = [
  { slug: 'session_reports.read', description: 'View session reports filed by members' },
  { slug: 'session_reports.review', description: 'Mark a session report reviewed or dismissed' },
]

// ADMIN holds every permission by convention (0001 granted it the whole
// catalog at the time), so each later migration that adds permissions
// has to extend that grant itself. The rest follow 0002's role shapes:
// the moderation roles work the queue, the auditor only reads it.
const GRANTS: Record<string, string[]> = {
  ADMIN: ['session_reports.read', 'session_reports.review'],
  MODERATOR: ['session_reports.read', 'session_reports.review'],
  'TRUST-SAFETY-LEAD': ['session_reports.read', 'session_reports.review'],
  AUDITOR: ['session_reports.read'],
}

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('session_reports')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('open'))
    .execute()
  await db.schema
    .alterTable('session_reports')
    .addColumn('reviewed_at', 'timestamptz')
    .execute()
  // Same shape as moderation_events.reviewed_by (0001): a users.id that
  // survives the reviewer's own account deletion as null.
  await db.schema
    .alterTable('session_reports')
    .addColumn('reviewed_by', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .execute()
  await sql`alter table session_reports add constraint session_reports_status_check check (status in ('open','reviewed','dismissed'))`.execute(db)
  // The queue is "open reports, oldest first" — index exactly that.
  await db.schema
    .createIndex('session_reports_status_created_at_idx')
    .on('session_reports')
    .columns(['status', 'created_at', 'id'])
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

  const roleRows = await db
    .selectFrom('roles')
    .select(['id', 'name'])
    .where('name', 'in', Object.keys(GRANTS))
    .execute()

  for (const role of roleRows as Array<{ id: string; name: string }>) {
    const permissionIds = (GRANTS[role.name] ?? [])
      .map((slug) => permissionIdBySlug.get(slug))
      .filter((id): id is string => id !== undefined)
    if (permissionIds.length === 0) continue
    await db
      .insertInto('role_permissions')
      .values(permissionIds.map((permissionId) => ({ role_id: role.id, permission_id: permissionId })))
      .onConflict((oc) => oc.columns(['role_id', 'permission_id']).doNothing())
      .execute()
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  // role_permissions cascades from permissions (0001_init).
  await db
    .deleteFrom('permissions')
    .where('slug', 'in', PERMISSIONS.map((p) => p.slug))
    .execute()

  await db.schema.dropIndex('session_reports_status_created_at_idx').execute()
  await sql`alter table session_reports drop constraint session_reports_status_check`.execute(db)
  await db.schema.alterTable('session_reports').dropColumn('reviewed_by').execute()
  await db.schema.alterTable('session_reports').dropColumn('reviewed_at').execute()
  await db.schema.alterTable('session_reports').dropColumn('status').execute()
}
