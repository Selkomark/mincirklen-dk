export interface ResolveSessionDeps {
  verifyToken: (token: string) => { userId: string } | null
  touchUser: (userId: string) => Promise<boolean>
  // Live-block check (users.banned_at) — a signed, otherwise-valid token
  // for a banned account must still resolve to "no session," not just a
  // future login attempt. See userRepository.ts's isUserBanned.
  isBanned: (userId: string) => Promise<boolean>
}

export async function resolveSession(deps: ResolveSessionDeps, token: string | null): Promise<string | null> {
  if (!token) return null

  const verified = deps.verifyToken(token)
  if (!verified) return null

  const touched = await deps.touchUser(verified.userId)
  if (!touched) return null

  const banned = await deps.isBanned(verified.userId)
  return banned ? null : verified.userId
}
