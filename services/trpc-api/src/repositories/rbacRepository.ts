import type { Database } from '@mincirklen/shared'
import type { Kysely } from 'kysely'
import { type KmsConfig, decryptField } from '../adapters/kmsAdapter'

// Never ships the full plaintext address to the browser for a list view —
// decrypted and masked here, server-side, so the mask can't be trivially
// undone from devtools/network tab the way a client-side mask could be.
// Keeps the first character of the local part and the full domain (useful
// for spotting patterns/duplicates), masks the rest of the local part with
// a fixed-length run of asterisks (not length-revealing).
export function maskEmail(email: string): string {
  const atIndex = email.indexOf('@')
  if (atIndex <= 0) return '***'
  const local = email.slice(0, atIndex)
  const domain = email.slice(atIndex + 1)
  return `${local[0]}***@${domain}`
}

export interface Role {
  id: string
  name: string
  description: string | null
  isSystem: boolean
}

export interface Permission {
  id: string
  slug: string
  description: string | null
}

export async function findRoleByName(db: Kysely<Database>, name: string): Promise<Role | null> {
  const row = await db
    .selectFrom('roles')
    .select(['id', 'name', 'description', 'is_system'])
    .where('name', '=', name)
    .executeTakeFirst()

  if (!row) return null
  return { id: row.id, name: row.name, description: row.description, isSystem: row.is_system }
}

export async function findRoleById(db: Kysely<Database>, roleId: string): Promise<Role | null> {
  const row = await db
    .selectFrom('roles')
    .select(['id', 'name', 'description', 'is_system'])
    .where('id', '=', roleId)
    .executeTakeFirst()

  if (!row) return null
  return { id: row.id, name: row.name, description: row.description, isSystem: row.is_system }
}

export async function listRoles(db: Kysely<Database>): Promise<Role[]> {
  const rows = await db.selectFrom('roles').select(['id', 'name', 'description', 'is_system']).orderBy('name').execute()
  return rows.map((row) => ({ id: row.id, name: row.name, description: row.description, isSystem: row.is_system }))
}

export async function createRole(
  db: Kysely<Database>,
  params: { name: string; description: string | null },
): Promise<Role> {
  const row = await db
    .insertInto('roles')
    .values({ name: params.name, description: params.description })
    .returning(['id', 'name', 'description', 'is_system'])
    .executeTakeFirstOrThrow()

  return { id: row.id, name: row.name, description: row.description, isSystem: row.is_system }
}

export async function updateRole(
  db: Kysely<Database>,
  params: { roleId: string; name: string; description: string | null },
): Promise<void> {
  await db
    .updateTable('roles')
    .set({ name: params.name, description: params.description })
    .where('id', '=', params.roleId)
    .execute()
}

export async function listPermissions(db: Kysely<Database>): Promise<Permission[]> {
  const rows = await db.selectFrom('permissions').select(['id', 'slug', 'description']).orderBy('slug').execute()
  return rows.map((row) => ({ id: row.id, slug: row.slug, description: row.description }))
}

export async function getRolePermissionIds(db: Kysely<Database>, roleId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('role_permissions')
    .select('permission_id')
    .where('role_id', '=', roleId)
    .execute()

  return rows.map((row) => row.permission_id)
}

// Replace-all-in-a-transaction, same shape as selkomark.com's
// updateRolePermissionsTransaction — a role's permission set is always
// fully replaced, never incrementally patched.
export async function replaceRolePermissions(db: Kysely<Database>, roleId: string, permissionIds: string[]): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('role_permissions').where('role_id', '=', roleId).execute()
    if (permissionIds.length > 0) {
      await trx
        .insertInto('role_permissions')
        .values(permissionIds.map((permissionId) => ({ role_id: roleId, permission_id: permissionId })))
        .execute()
    }
  })
}

export async function assignRoleToUser(db: Kysely<Database>, userId: string, roleId: string): Promise<void> {
  await db
    .insertInto('user_roles')
    .values({ user_id: userId, role_id: roleId })
    .onConflict((oc) => oc.doNothing())
    .execute()
}

// Replace-all-in-a-transaction for a user's role set, same pattern as
// replaceRolePermissions above — improves on selkomark.com's own
// non-transactional version of this exact operation.
export async function replaceUserRoles(db: Kysely<Database>, userId: string, roleIds: string[]): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('user_roles').where('user_id', '=', userId).execute()
    if (roleIds.length > 0) {
      await trx.insertInto('user_roles').values(roleIds.map((roleId) => ({ user_id: userId, role_id: roleId }))).execute()
    }
  })
}

// Hydrated fresh on every request (context.ts) rather than cached in the
// session token — a role/permission change takes effect on the user's
// very next request without needing to re-login, same as
// selkomark.com/server/context.ts's createContext.
export async function getUserRolesAndPermissions(
  db: Kysely<Database>,
  userId: string,
): Promise<{ roles: { id: string; name: string }[]; permissions: string[] }> {
  const roleRows = await db
    .selectFrom('user_roles')
    .innerJoin('roles', 'roles.id', 'user_roles.role_id')
    .select(['roles.id as id', 'roles.name as name'])
    .where('user_roles.user_id', '=', userId)
    .execute()

  const roleIds = roleRows.map((row) => row.id)
  if (roleIds.length === 0) {
    return { roles: [], permissions: [] }
  }

  const permissionRows = await db
    .selectFrom('role_permissions')
    .innerJoin('permissions', 'permissions.id', 'role_permissions.permission_id')
    .select('permissions.slug as slug')
    .where('role_permissions.role_id', 'in', roleIds)
    .execute()

  return {
    roles: roleRows,
    permissions: [...new Set(permissionRows.map((row) => row.slug))],
  }
}

// See migrations/0001_init.ts's admin_bootstrap doc comment — a permanent,
// one-way marker for the master-admin bootstrap (adminBootstrapService.ts).
export async function isAdminBootstrapCompleted(db: Kysely<Database>): Promise<boolean> {
  const row = await db.selectFrom('admin_bootstrap').select('id').executeTakeFirst()
  return row !== undefined
}

export async function markAdminBootstrapCompleted(db: Kysely<Database>): Promise<void> {
  await db.insertInto('admin_bootstrap').defaultValues().execute()
}

export async function userHasRole(db: Kysely<Database>, userId: string, roleId: string): Promise<boolean> {
  const row = await db
    .selectFrom('user_roles')
    .select('user_id')
    .where('user_id', '=', userId)
    .where('role_id', '=', roleId)
    .executeTakeFirst()

  return row !== undefined
}

// Used by the master-admin bootstrap (adminBootstrapService.ts) to decide
// whether auto-elevation should still fire — a one-time "first login by
// the designated master email becomes admin" bootstrap, not a persistent
// override, so it must never fire again once any OTHER user already holds
// the role.
export async function anotherUserHasRole(db: Kysely<Database>, roleId: string, excludingUserId: string): Promise<boolean> {
  const row = await db
    .selectFrom('user_roles')
    .select('user_id')
    .where('role_id', '=', roleId)
    .where('user_id', '!=', excludingUserId)
    .executeTakeFirst()

  return row !== undefined
}

export interface UserWithRoles {
  id: string
  createdAt: Date
  bannedAt: Date | null
  // Masked (see maskEmail above), or null for a fully anonymous user who
  // never linked Google. The unmasked address never leaves this process.
  emailMasked: string | null
  roles: { id: string; name: string }[]
}

// Paginated list for /manage's UsersTab — cursor is the last-seen user id
// (created_at, id) tuple, same pagination shape as
// messageRepository.ts::listMessages.
export async function listUsersWithRoles(
  db: Kysely<Database>,
  kms: KmsConfig,
  params: { cursor?: string; limit: number },
): Promise<{ users: UserWithRoles[]; nextCursor: string | null }> {
  let query = db
    .selectFrom('users')
    .select(['id', 'created_at', 'banned_at', 'email_ciphertext'])
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(params.limit + 1)

  if (params.cursor) {
    query = query.where('id', '<', params.cursor)
  }

  const userRows = await query.execute()
  const hasMore = userRows.length > params.limit
  const page = hasMore ? userRows.slice(0, params.limit) : userRows

  const userIds = page.map((row) => row.id)
  const roleRows =
    userIds.length > 0
      ? await db
          .selectFrom('user_roles')
          .innerJoin('roles', 'roles.id', 'user_roles.role_id')
          .select(['user_roles.user_id as user_id', 'roles.id as role_id', 'roles.name as role_name'])
          .where('user_roles.user_id', 'in', userIds)
          .execute()
      : []

  const rolesByUser = new Map<string, { id: string; name: string }[]>()
  for (const row of roleRows) {
    const list = rolesByUser.get(row.user_id) ?? []
    list.push({ id: row.role_id, name: row.role_name })
    rolesByUser.set(row.user_id, list)
  }

  const users = await Promise.all(
    page.map(async (row) => ({
      id: row.id,
      createdAt: row.created_at,
      bannedAt: row.banned_at,
      emailMasked: row.email_ciphertext ? maskEmail(await decryptField(kms, row.email_ciphertext)) : null,
      roles: rolesByUser.get(row.id) ?? [],
    })),
  )

  return { users, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null }
}
