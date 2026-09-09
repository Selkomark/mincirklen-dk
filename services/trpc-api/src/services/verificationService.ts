// "Verified" here means the operator's actual, non-negotiable bar for
// using the platform at all: a real Google-authenticated identity AND a
// completed profile (see RegisterPage.tsx) — the traceability the operator
// needs to cooperate with authorities if predatory behavior slips past
// moderation. In-chat anonymity (Charter §4) is a display choice on top of
// this, never a substitute for it — an unlinked, unprofiled session must
// never reach anything past auth.whoAmI/auth.myProfile.

export interface IsGoogleLinkedDeps {
  hasLinkedIdentity: () => Promise<boolean>
}

export async function isGoogleLinked(deps: IsGoogleLinkedDeps): Promise<boolean> {
  return deps.hasLinkedIdentity()
}

export interface IsFullyVerifiedDeps {
  hasLinkedIdentity: () => Promise<boolean>
  hasProfile: () => Promise<boolean>
}

export async function isFullyVerified(deps: IsFullyVerifiedDeps): Promise<boolean> {
  const [linked, profiled] = await Promise.all([deps.hasLinkedIdentity(), deps.hasProfile()])
  return linked && profiled
}
