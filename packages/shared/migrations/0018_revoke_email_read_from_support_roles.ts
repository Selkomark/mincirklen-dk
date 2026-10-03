import type { Kysely } from 'kysely'

// Follow-up to 0017: SUPPORT, TRUST-SAFETY-LEAD and AUDITOR no longer
// get emails.read (or any other emails.* permission, in case one was
// granted by hand since via the Roles tab) — only ADMIN keeps email
// access. Revokes by role+slug lookup rather than assuming 0017's exact
// history, so this is correct even if a grant changed since then.

const ROLE_NAMES = ['SUPPORT', 'TRUST-SAFETY-LEAD', 'AUDITOR']

export async function up(db: Kysely<any>): Promise<void> {
  const roleRows = await db.selectFrom('roles').select(['id']).where('name', 'in', ROLE_NAMES).execute()
  const roleIds = (roleRows as Array<{ id: string }>).map((row) => row.id)
  if (roleIds.length === 0) return

  const permissionRows = await db.selectFrom('permissions').select(['id']).where('slug', 'like', 'emails.%').execute()
  const permissionIds = (permissionRows as Array<{ id: string }>).map((row) => row.id)
  if (permissionIds.length === 0) return

  await db
    .deleteFrom('role_permissions')
    .where('role_id', 'in', roleIds)
    .where('permission_id', 'in', permissionIds)
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  // Restores exactly what 0017 granted these three roles (emails.read
  // only — emails.send_test was always ADMIN-only, never theirs).
  const roleRows = await db.selectFrom('roles').select(['id', 'name']).where('name', 'in', ROLE_NAMES).execute()
  const permissionRow = await db.selectFrom('permissions').select(['id']).where('slug', '=', 'emails.read').executeTakeFirst()
  if (!permissionRow) return

  const rows = (roleRows as Array<{ id: string; name: string }>).map((role) => ({
    role_id: role.id,
    permission_id: (permissionRow as { id: string }).id,
  }))
  if (rows.length === 0) return

  await db.insertInto('role_permissions').values(rows).onConflict((oc) => oc.columns(['role_id', 'permission_id']).doNothing()).execute()
}
