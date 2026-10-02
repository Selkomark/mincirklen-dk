import type { Kysely } from 'kysely'

// Gates the /manage "Emails" section (0016's tables). Reading the sent
// log, delivery events, suppressions and the template catalog is one
// permission; sending a test email of any template to any address is a
// second, because it reaches outside the platform. Seeing a recipient
// unmasked stays under users.read_pii (0011), as everywhere else.

const PERMISSIONS: Array<{ slug: string; description: string }> = [
  { slug: 'emails.read', description: 'View sent emails, delivery events, suppressions and templates' },
  { slug: 'emails.send_test', description: 'Send a test email of any template to an address' },
]

// ADMIN holds every permission by convention (see 0003). Support and
// the trust & safety lead need to answer "did the email reach them";
// the auditor reads everything. Moderators don't need the log for the
// queue itself and can be granted it from the Roles tab.
const GRANTS: Record<string, string[]> = {
  ADMIN: ['emails.read', 'emails.send_test'],
  SUPPORT: ['emails.read'],
  'TRUST-SAFETY-LEAD': ['emails.read'],
  AUDITOR: ['emails.read'],
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
}
