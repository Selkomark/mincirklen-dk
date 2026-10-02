import type { Kysely } from 'kysely'

// Splits the review queue into seeing it and deciding in it. Until now
// moderation_events.review did both, so a read-only role (AUDITOR) could
// only be given the queue by also being allowed to rule on it. Roles
// that review keep both; AUDITOR moves to read only.

const PERMISSIONS: Array<{ slug: string; description: string }> = [
  { slug: 'moderation_events.read', description: 'View the moderation review queue' },
]

const READ_GRANTS = ['ADMIN', 'MODERATOR', 'TRUST-SAFETY-LEAD', 'AUDITOR']
const REVIEW_REVOKED_FROM = ['AUDITOR']

export async function up(db: Kysely<any>): Promise<void> {
  await db
    .insertInto('permissions')
    .values(PERMISSIONS)
    .onConflict((oc) => oc.column('slug').doNothing())
    .execute()
  const read = await db.selectFrom('permissions').select('id').where('slug', '=', 'moderation_events.read').executeTakeFirstOrThrow()
  const review = await db.selectFrom('permissions').select('id').where('slug', '=', 'moderation_events.review').executeTakeFirst()
  const roles = (await db
    .selectFrom('roles')
    .select(['id', 'name'])
    .where('name', 'in', [...new Set([...READ_GRANTS, ...REVIEW_REVOKED_FROM])])
    .execute()) as Array<{ id: string; name: string }>

  const readRoleIds = roles.filter((r) => READ_GRANTS.includes(r.name)).map((r) => r.id)
  if (readRoleIds.length > 0) {
    await db
      .insertInto('role_permissions')
      .values(readRoleIds.map((roleId) => ({ role_id: roleId, permission_id: read.id })))
      .onConflict((oc) => oc.columns(['role_id', 'permission_id']).doNothing())
      .execute()
  }
  const revokeRoleIds = roles.filter((r) => REVIEW_REVOKED_FROM.includes(r.name)).map((r) => r.id)
  if (review && revokeRoleIds.length > 0) {
    await db.deleteFrom('role_permissions').where('permission_id', '=', review.id).where('role_id', 'in', revokeRoleIds).execute()
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  // Give AUDITOR back the review permission it held before, then drop
  // the read permission (role_permissions cascade).
  const review = await db.selectFrom('permissions').select('id').where('slug', '=', 'moderation_events.review').executeTakeFirst()
  const auditors = (await db.selectFrom('roles').select('id').where('name', 'in', REVIEW_REVOKED_FROM).execute()) as Array<{ id: string }>
  if (review && auditors.length > 0) {
    await db
      .insertInto('role_permissions')
      .values(auditors.map((r) => ({ role_id: r.id, permission_id: review.id })))
      .onConflict((oc) => oc.columns(['role_id', 'permission_id']).doNothing())
      .execute()
  }
  await db
    .deleteFrom('permissions')
    .where('slug', 'in', PERMISSIONS.map((p) => p.slug))
    .execute()
}
