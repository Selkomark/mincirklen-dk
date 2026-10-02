import { GATE_REGISTRY, isKnownGateKey, type GateKey, type GateMode } from '@mincirklen/shared'

export class UnknownGateError extends Error {}
export class SignupNotFoundError extends Error {}

interface GateOverride {
  mode: GateMode
  scheduledOpenAt: Date | null
}

// Pure — takes an already-resolved (registry default merged with any DB
// override) mode/schedule and decides openness. `scheduledOpenAt` wins
// regardless of `mode`: "invite-only now, opens automatically on launch
// day" is one write, not a second manual flip on the day itself.
export function isGateOpen(gate: GateOverride, now: Date = new Date()): boolean {
  if (gate.mode === 'open') return true
  return gate.scheduledOpenAt !== null && now >= gate.scheduledOpenAt
}

export interface IsGateEffectivelyOpenDeps {
  findState: (key: string) => Promise<GateOverride | null>
}

// The one implementation every caller shares (controllers/trpc.ts's
// requireGateAccess for enforcement, gatesRouter.ts's getStatus for the
// frontend) — they can never disagree about whether a gate is open.
export async function isGateEffectivelyOpen(
  deps: IsGateEffectivelyOpenDeps,
  key: GateKey,
  now: Date = new Date(),
): Promise<boolean> {
  const definition = GATE_REGISTRY[key]
  const override = await deps.findState(key)
  return isGateOpen({ mode: override?.mode ?? definition.defaultMode, scheduledOpenAt: override?.scheduledOpenAt ?? null }, now)
}

export interface SubmitSignupDeps {
  insertSignup: (gateKey: string, email: string) => Promise<void>
}

export async function submitSignup(deps: SubmitSignupDeps, params: { gateKey: string; email: string }): Promise<void> {
  if (!isKnownGateKey(params.gateKey)) {
    throw new UnknownGateError(`Unknown gate: ${params.gateKey}`)
  }
  await deps.insertSignup(params.gateKey, params.email)
}

export interface UpdateGateStateDeps {
  upsertState: (key: string, params: { mode: GateMode; scheduledOpenAt: Date | null; updatedBy: string | null }) => Promise<void>
}

export async function updateGateState(
  deps: UpdateGateStateDeps,
  params: { gateKey: string; mode: GateMode; scheduledOpenAt: Date | null; updatedBy: string | null },
): Promise<void> {
  if (!isKnownGateKey(params.gateKey)) {
    throw new UnknownGateError(`Unknown gate: ${params.gateKey}`)
  }
  await deps.upsertState(params.gateKey, {
    mode: params.mode,
    scheduledOpenAt: params.scheduledOpenAt,
    updatedBy: params.updatedBy,
  })
}

export interface GrantSignupAccessDeps {
  markGranted: (signupId: string, grantedBy: string | null) => Promise<{ id: string; gateKey: string; email: string } | null>
  createInviteToken: (gateKey: string, signupId: string) => string
}

export async function grantSignupAccess(
  deps: GrantSignupAccessDeps,
  params: { signupId: string; grantedBy: string | null },
): Promise<{ signupId: string; gateKey: string; email: string; token: string }> {
  const granted = await deps.markGranted(params.signupId, params.grantedBy)
  if (!granted) {
    throw new SignupNotFoundError('Signup not found')
  }
  // `email` so the caller can send the invite link to the person
  // (gatesRouter.ts) — the grant itself is the record, the email the
  // delivery.
  return { signupId: granted.id, gateKey: granted.gateKey, email: granted.email, token: deps.createInviteToken(granted.gateKey, granted.id) }
}

export interface RejectSignupDeps {
  markRejected: (signupId: string) => Promise<{ id: string; gateKey: string } | null>
}

// Declining a pending signup. Nothing is sent to the person — they were
// told at signup that we'd be in touch when their circle is ready, and
// a "no" email has no upside for them. Only a 'pending' row can be
// rejected (markRejected's own WHERE clause); anything else reads as
// not found, same as revoke.
export async function rejectSignup(deps: RejectSignupDeps, params: { signupId: string }): Promise<{ gateKey: string }> {
  const rejected = await deps.markRejected(params.signupId)
  if (!rejected) {
    throw new SignupNotFoundError('Signup not found')
  }
  return { gateKey: rejected.gateKey }
}

export interface RevokeSignupAccessDeps {
  markRevoked: (signupId: string) => Promise<{ id: string; gateKey: string } | null>
}

// Only reachable from a 'granted' row (markRevoked's own WHERE clause) —
// a not-found here means either a bad id or a signup that was already
// pending/revoked, both of which are genuinely "nothing to revoke", not
// distinguishable states worth a different error for.
export async function revokeSignupAccess(deps: RevokeSignupAccessDeps, params: { signupId: string }): Promise<{ gateKey: string }> {
  const revoked = await deps.markRevoked(params.signupId)
  if (!revoked) {
    throw new SignupNotFoundError('Signup not found')
  }
  return { gateKey: revoked.gateKey }
}

export interface RedeemGateInviteDeps {
  verifyToken: (token: string) => { gateKey: string; signupId: string } | null
  findSignupById: (id: string) => Promise<{ gateKey: string; status: string } | null>
}

export type RedeemGateInviteResult = { ok: true; gateKey: string } | { ok: false; reason: 'invalid' | 'not_granted' }

// Re-checks the signup's live DB status rather than trusting the token's
// signature alone — the token only proves "this was a real grant at issue
// time." Checking the row too is what makes a future "revoke this one
// person" feature a small change (flip status back, this catches it) as
// opposed to a token-format redesign.
export async function redeemGateInvite(deps: RedeemGateInviteDeps, token: string): Promise<RedeemGateInviteResult> {
  const verified = deps.verifyToken(token)
  if (!verified) return { ok: false, reason: 'invalid' }

  const signup = await deps.findSignupById(verified.signupId)
  if (!signup || signup.gateKey !== verified.gateKey || signup.status !== 'granted') {
    return { ok: false, reason: 'not_granted' }
  }
  return { ok: true, gateKey: verified.gateKey }
}

export interface GateStatsEntry {
  key: string
  name: string
  description: string
  mode: GateMode
  scheduledOpenAt: Date | null
  open: boolean
  pendingCount: number
  grantedCount: number
  revokedCount: number
}

export interface ListGatesWithStatsDeps {
  listStates: () => Promise<{ key: string; mode: GateMode; scheduledOpenAt: Date | null }[]>
  countsByGateKey: () => Promise<Map<string, { pending: number; granted: number; revoked: number; rejected: number }>>
}

// Iterates GATE_REGISTRY, not the DB — a gate with zero rows anywhere
// still shows up (with zeroed stats), and nothing in the DB can ever add
// a gate that doesn't already exist in code. This is the "magically
// shows up in /manage" call.
export async function listGatesWithStats(deps: ListGatesWithStatsDeps, now: Date = new Date()): Promise<GateStatsEntry[]> {
  const [states, counts] = await Promise.all([deps.listStates(), deps.countsByGateKey()])
  const stateByKey = new Map(states.map((state) => [state.key, state]))

  return (Object.keys(GATE_REGISTRY) as GateKey[]).map((key) => {
    const definition = GATE_REGISTRY[key]
    const override = stateByKey.get(key)
    const mode = override?.mode ?? definition.defaultMode
    const scheduledOpenAt = override?.scheduledOpenAt ?? null
    const count = counts.get(key) ?? { pending: 0, granted: 0, revoked: 0, rejected: 0 }

    return {
      key,
      name: definition.name,
      description: definition.description,
      mode,
      scheduledOpenAt,
      open: isGateOpen({ mode, scheduledOpenAt }, now),
      pendingCount: count.pending,
      grantedCount: count.granted,
      revokedCount: count.revoked,
      rejectedCount: count.rejected,
    }
  })
}
