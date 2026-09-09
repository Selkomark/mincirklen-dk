export interface ResolveGoogleLoginDeps {
  findUserIdByIdentity(): Promise<string | null>
  createUser(): Promise<{ id: string }>
  linkIdentity(userId: string): Promise<void>
  hasProfile(userId: string): Promise<boolean>
  // Verifies `existingUserId` (from the browser's mc_session cookie) still
  // has a row before trusting it as the "upgrade" target — a session
  // cookie signed against a user id that's since been deleted (account
  // deletion, moderation action, or just a stale cookie from before a dev
  // database reset) would otherwise hit `user_identities`'s foreign key
  // constraint and crash the whole callback with a 500.
  userExists(userId: string): Promise<boolean>
}

export interface ResolveGoogleLoginResult {
  userId: string
  // Whether `user_profiles` already has a row for this user — the
  // controller uses this (not "is this identity link new") to pick the
  // /register vs /new redirect target, so a user who linked Google but
  // abandoned the registration form gets sent back to it on their next
  // login instead of straight to /new.
  hasProfile: boolean
}

// An established Google identity always wins over whatever anonymous
// session happens to be active in the browser at callback time — see
// controllers/oauthController.ts for the flagged multi-tab / identity-swap
// edge cases this creates (session-confusion, not a security issue: no
// cross-user data is ever exposed, only cookies already in that
// browser's own jar are ever read).
export async function resolveGoogleLogin(
  deps: ResolveGoogleLoginDeps,
  existingUserId: string | null,
): Promise<ResolveGoogleLoginResult> {
  const linkedUserId = await deps.findUserIdByIdentity()
  if (linkedUserId) {
    return { userId: linkedUserId, hasProfile: await deps.hasProfile(linkedUserId) }
  }

  const upgradeTarget = existingUserId !== null && (await deps.userExists(existingUserId)) ? existingUserId : null
  const userId = upgradeTarget ?? (await deps.createUser()).id
  await deps.linkIdentity(userId)

  return { userId, hasProfile: await deps.hasProfile(userId) }
}
