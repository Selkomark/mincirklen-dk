import { isSessionTokenFresh } from '@mincirklen/shared'

export interface ResolveSessionDeps {
  touchUser: (userId: string) => Promise<boolean>
  // Live-block check (users.banned_at) — a signed, otherwise-valid token
  // for a banned account must still resolve to "no session," not just a
  // future login attempt. See userRepository.ts's isUserBanned.
  isBanned: (userId: string) => Promise<boolean>
}

// Signature verification moved out to context.ts
// (sessionToken.ts's verifySessionTokenSignature) — this function no
// longer owns token parsing/crypto at all. It takes an ALREADY-verified
// token (or null, if there wasn't one / it failed signature verification)
// plus an ALREADY-RESOLVED maxIdleSeconds. The caller must look up the
// user's effective session-policy duration in between those two steps
// (see sessionPolicyService.ts's resolveEffectiveMaxIdleSeconds), since
// that lookup itself needs the userId this function's own input already
// carries — resolveSession can't do that lookup itself without owning a
// role-resolution dependency it has no other reason to need.
export async function resolveSession(
  deps: ResolveSessionDeps,
  verified: { userId: string; issuedAt: Date } | null,
  maxIdleSeconds: number,
): Promise<string | null> {
  if (!verified) return null
  if (!isSessionTokenFresh(verified.issuedAt, maxIdleSeconds)) return null

  const touched = await deps.touchUser(verified.userId)
  if (!touched) return null

  const banned = await deps.isBanned(verified.userId)
  return banned ? null : verified.userId
}
