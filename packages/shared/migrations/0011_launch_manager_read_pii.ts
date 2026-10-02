import type { Kysely } from 'kysely'

// Gate signup addresses are now masked for anyone without users.read_pii
// (gatesRouter.ts). A launch manager grants access by handing the person
// an invite link, which needs their real address — so the role gets the
// permission. AUDITOR, with gates.read only, sees the mask.
const ROLE = 'LAUNCH-MANAGER'
const PERMISSION = 'users.read_pii'

export async function up(db: Kysely<any>): Promise<void> {
  const role = await db.selectFrom('roles').select('id').where('name', '=', ROLE).executeTakeFirst()
  const permission = await db.selectFrom('permissions').select('id').where('slug', '=', PERMISSION).executeTakeFirst()
  if (!role || !permission) return
  await db
    .insertInto('role_permissions')
    .values({ role_id: role.id, permission_id: permission.id })
    .onConflict((oc) => oc.columns(['role_id', 'permission_id']).doNothing())
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  const role = await db.selectFrom('roles').select('id').where('name', '=', ROLE).executeTakeFirst()
  const permission = await db.selectFrom('permissions').select('id').where('slug', '=', PERMISSION).executeTakeFirst()
  if (!role || !permission) return
  await db.deleteFrom('role_permissions').where('role_id', '=', role.id).where('permission_id', '=', permission.id).execute()
}
