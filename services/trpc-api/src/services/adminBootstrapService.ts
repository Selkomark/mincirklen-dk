// Master-admin bootstrap. A permanent, one-way `admin_bootstrap` marker
// row (not "does anyone currently hold the admin role") gates this —
// deliberately, so it can never re-arm itself: if the sole admin is later
// removed/deroled, or if someone with prod env-var access changes
// MASTER_USER_EMAIL after the fact and redeploys hoping to re-trigger
// elevation, this stays permanently inert once it has fired once. Only
// ever comes into play at first deployment: the operator logs in with the
// configured email, gets elevated, and the mechanism disables itself for
// good. Called from oauthController.ts's callback, after verifyIdToken
// and before the session cookie is issued.
export interface BootstrapAdminDeps {
  isBootstrapCompleted: () => Promise<boolean>
  findRoleByName: (name: string) => Promise<{ id: string } | null>
  assignRole: (userId: string, roleId: string) => Promise<void>
  markBootstrapCompleted: () => Promise<void>
}

const ADMIN_ROLE_NAME = 'admin'

export async function bootstrapAdminIfMasterEmail(
  deps: BootstrapAdminDeps,
  params: { userId: string; email: string; masterEmail: string | undefined },
): Promise<void> {
  if (!params.masterEmail || params.email !== params.masterEmail) {
    return
  }

  if (await deps.isBootstrapCompleted()) {
    return
  }

  const adminRole = await deps.findRoleByName(ADMIN_ROLE_NAME)
  if (!adminRole) {
    return
  }

  await deps.assignRole(params.userId, adminRole.id)
  await deps.markBootstrapCompleted()
}
