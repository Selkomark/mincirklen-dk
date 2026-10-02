import type { SessionPolicyAttributes } from '@mincirklen/shared'

export interface ResolveEffectiveMaxIdleSecondsDeps {
  findSessionPolicyAttributesForRoles: (roleIds: string[]) => Promise<SessionPolicyAttributes[]>
}

// A user's effective session idle duration.
//
// No roles at all → globalDefaultSeconds (an ordinary member; the
// 180-day DEFAULT_MAX_AGE_SECONDS). Holding any role → capped at
// roleCeilingSeconds (ROLE_MAX_IDLE_SECONDS, 2 weeks) whether or not a
// policy is attached: a role is admin-area access, and that never gets
// the member default. Within that ceiling, the minimum across every
// held role that carries a session policy governs. Minimum-wins, no
// override — matches AWS STS capping an assumed session at the minimum
// of the role's own MaxSessionDuration and the request, and Entra ID's
// documented "the most restrictive of several applicable policies
// governs." A policy can only ever shorten a role's session relative to
// the ceiling, never lengthen it, even if a stored value is somehow
// longer. The ceiling itself can't exceed the global default either, so
// a deployment that lowers the platform default lowers roles with it.
export async function resolveEffectiveMaxIdleSeconds(
  deps: ResolveEffectiveMaxIdleSecondsDeps,
  roleIds: string[],
  globalDefaultSeconds: number,
  roleCeilingSeconds: number,
): Promise<number> {
  if (roleIds.length === 0) return globalDefaultSeconds

  const ceiling = Math.min(roleCeilingSeconds, globalDefaultSeconds)

  const attributesList = await deps.findSessionPolicyAttributesForRoles(roleIds)
  const durations = attributesList
    .map((attributes) => attributes.maxIdleSeconds)
    .filter((value): value is number => typeof value === 'number' && value > 0)

  if (durations.length === 0) return ceiling

  return Math.min(...durations, ceiling)
}
