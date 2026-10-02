import type { Kysely } from 'kysely'

// A separate permission for seeing members' email addresses unmasked in
// /manage. users.read shows the masked form (b***@example.com) — enough
// to tell members apart and spot duplicates; the full address is a
// stronger exposure, so it's its own grant a role has to hold
// explicitly. ADMIN gets it; everything else opts in via the Roles tab.

const PERMISSIONS: Array<{ slug: string; description: string }> = [
  { slug: 'users.read_pii', description: "View members' email addresses unmasked" },
]

const GRANTS: Record<string, string[]> = {
  ADMIN: ['users.read_pii'],
}

export async function up(db: Kysely<any>): Promise<void> {
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
}
