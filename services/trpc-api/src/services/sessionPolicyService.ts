import type { SessionPolicyAttributes } from '@mincirklen/shared'

export interface ResolveEffectiveMaxIdleSecondsDeps {
  findSessionPolicyAttributesForRoles: (roleIds: string[]) => Promise<SessionPolicyAttributes[]>
}

// A user's effective session idle duration: the minimum across every
// role they hold that carries a session policy, falling back to the
// platform default when they hold no such role. Minimum-wins, no
// override — matches AWS STS capping an assumed session at the minimum
// of the role's own MaxSessionDuration and the request, and Entra ID's
// documented "the most restrictive of several applicable policies
// governs." Clamped to never exceed globalDefaultSeconds even if a
// policy is misconfigured with a longer value — a policy can only ever
// shorten a role's effective session relative to the platform default,
// never lengthen it.
export async function resolveEffectiveMaxIdleSeconds(
  deps: ResolveEffectiveMaxIdleSecondsDeps,
  roleIds: string[],
  globalDefaultSeconds: number,
): Promise<number> {
  if (roleIds.length === 0) return globalDefaultSeconds

  const attributesList = await deps.findSessionPolicyAttributesForRoles(roleIds)
  const durations = attributesList
    .map((attributes) => attributes.maxIdleSeconds)
    .filter((value): value is number => typeof value === 'number' && value > 0)

  if (durations.length === 0) return globalDefaultSeconds

  return Math.min(...durations, globalDefaultSeconds)
}
