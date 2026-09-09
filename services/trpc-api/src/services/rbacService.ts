// Business rule enforced here rather than in the repository or the router:
// a system role's permission set is protected. Mirrors selkomark.com's
// RoleService rule of the same name — the seeded `admin` role must not be
// silently narrowed down to nothing by an admin editing the UI's toggle
// grid.
export class SystemRoleImmutableError extends Error {}

export interface UpdateRolePermissionsDeps {
  findRoleById: (roleId: string) => Promise<{ isSystem: boolean } | null>
  replaceRolePermissions: (roleId: string, permissionIds: string[]) => Promise<void>
}

export async function updateRolePermissions(
  deps: UpdateRolePermissionsDeps,
  params: { roleId: string; permissionIds: string[] },
): Promise<void> {
  const role = await deps.findRoleById(params.roleId)
  if (!role) {
    throw new Error('Role not found')
  }
  if (role.isSystem) {
    throw new SystemRoleImmutableError('Cannot modify permissions for system roles')
  }
  await deps.replaceRolePermissions(params.roleId, params.permissionIds)
}

export interface UpdateRoleDeps {
  findRoleById: (roleId: string) => Promise<{ isSystem: boolean } | null>
  updateRole: (roleId: string, name: string, description: string | null) => Promise<void>
}

export async function updateRole(
  deps: UpdateRoleDeps,
  params: { roleId: string; name: string; description: string | null },
): Promise<void> {
  const role = await deps.findRoleById(params.roleId)
  if (!role) {
    throw new Error('Role not found')
  }
  if (role.isSystem) {
    throw new SystemRoleImmutableError('Cannot rename a system role')
  }
  await deps.updateRole(params.roleId, params.name, params.description)
}
