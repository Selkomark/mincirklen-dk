export interface ResolveGoogleLoginDeps {
  findUserIdByIdentity(): Promise<string | null>
  createUser(): Promise<{ id: string }>
  linkIdentity(userId: string): Promise<void>
  hasProfile(userId: string): Promise<boolean>
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

// Every user row is created here or not at all — there is no pre-Google
// "anonymous" user to upgrade (see SECURITY_FINDINGS.md H1, resolved by
// removing auth.createAnonymousSession rather than rate-limiting it):
// Google sign-in is this platform's actual identity boundary, so the
// first time a given Google identity is seen, it gets a fresh user row.
export async function resolveGoogleLogin(deps: ResolveGoogleLoginDeps): Promise<ResolveGoogleLoginResult> {
  const linkedUserId = await deps.findUserIdByIdentity()
  if (linkedUserId) {
    return { userId: linkedUserId, hasProfile: await deps.hasProfile(linkedUserId) }
  }

  const userId = (await deps.createUser()).id
  await deps.linkIdentity(userId)

  return { userId, hasProfile: await deps.hasProfile(userId) }
}
