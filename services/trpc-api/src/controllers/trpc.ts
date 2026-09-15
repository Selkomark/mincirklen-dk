import { type GateKey, verifyGateInviteToken } from '@mincirklen/shared'
import { initTRPC, TRPCError } from '@trpc/server'
import type { AppContext } from '../context'
import { findState } from '../repositories/featureGateStateRepository'
import { hasLinkedIdentityForUser } from '../repositories/userIdentityRepository'
import { userProfileExists } from '../repositories/userProfileRepository'
import { isGateEffectivelyOpen } from '../services/featureGateService'
import { isFullyVerified, isGoogleLinked } from '../services/verificationService'

const t = initTRPC.context<AppContext>().create()

export const router = t.router
export const publicProcedure = t.procedure

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return next({ ctx: { ...ctx, userId: ctx.userId } })
})

// Composable per-gate middleware factory (packages/shared/src/gates/registry.ts
// is the catalog of valid keys — GateKey being that registry's own type
// means an unregistered key fails to compile here, not just at runtime).
// A future feature gates itself by calling requireGateAccess('its_key')
// on top of whatever procedure it already needs — no change to this
// file's existing exports, no new token/cookie scheme to design.
//
// Bypass order: an admin (admin.access — already held by every admin,
// see hasPermission below) always passes, so /manage stays reachable
// regardless of any gate's state. Otherwise: the gate's own effective
// openness (registry default or DB override — isGateEffectivelyOpen is
// the one implementation gatesRouter.ts's getStatus also uses, so they
// can never disagree), then this specific gate's own cookie.
export function requireGateAccess(gateKey: GateKey) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    if (ctx.permissions.includes('admin.access')) {
      return next({ ctx })
    }
    if (await isGateEffectivelyOpen({ findState: (key) => findState(ctx.appEnv.db, key) }, gateKey)) {
      return next({ ctx })
    }
    const token = ctx.gateTokens[gateKey]
    const verified = token ? verifyGateInviteToken(token, ctx.appEnv.gateInviteSecret) : null
    if (verified?.gateKey === gateKey) {
      return next({ ctx })
    }
    throw new TRPCError({ code: 'FORBIDDEN', message: `gate:${gateKey}` })
  })
}

// The pre-launch platform-wide lock — just the first registry entry to
// use requireGateAccess, not a special case baked into it.
export const platformAccessProcedure = requireGateAccess('platform_launch')

// A session cookie alone (protectedProcedure) only proves "some browser
// holds a signed token." This additionally requires a linked Google
// identity, i.e. a real, traceable person — Google sign-in is this
// platform's only way to get a session in the first place (see
// resolveGoogleLogin), but a user can still be mid-registration with no
// profile yet. Used wherever a session is about to acquire or change
// real-identity data (currently just auth.completeProfile) but hasn't
// necessarily finished registering yet. Built on platformAccessProcedure
// (not protectedProcedure directly) so profile completion is gated by
// the pre-launch lock same as everything else past login.
export const googleLinkedProcedure = platformAccessProcedure.use(async ({ ctx, next }) => {
  const linked = await isGoogleLinked({
    hasLinkedIdentity: () => hasLinkedIdentityForUser(ctx.appEnv.db, ctx.userId),
  })
  if (!linked) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Google sign-in required' })
  }
  return next({ ctx })
})

// The operator's actual bar for using the platform: Google-linked AND a
// completed profile (see docs on verificationService.ts for why). Every
// procedure that lets someone actually participate — create/join a
// circle, send a message — must use this, not protectedProcedure. Built
// on platformAccessProcedure (not protectedProcedure directly), same
// reasoning as googleLinkedProcedure above — an admin still passes
// (admin.access bypasses requireGateAccess before this even runs).
export const verifiedProcedure = platformAccessProcedure.use(async ({ ctx, next }) => {
  const verified = await isFullyVerified({
    hasLinkedIdentity: () => hasLinkedIdentityForUser(ctx.appEnv.db, ctx.userId),
    // Existence-only — this gate guards every real feature (create/join a
    // circle, send a message), so it must never depend on KMS/Vault being
    // reachable. See userProfileExists's comment.
    hasProfile: () => userProfileExists(ctx.appEnv.db, ctx.userId),
  })
  if (!verified) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Google sign-in and profile completion required' })
  }
  return next({ ctx })
})

// RBAC gate for /manage and everything it calls. Built on verifiedProcedure
// (not the bare protectedProcedure) — an admin is the same kind of user as
// anyone else on the platform, just one holding a permission, not a
// separate identity. ctx.permissions is hydrated fresh per request (see
// context.ts::createContextFactory), so a role change takes effect on the
// user's very next request with no re-login needed. The seeded `admin`
// role holds every permission directly (migrations/0001_init.ts), so a
// plain membership check already covers admins — no separate bypass.
export const hasPermission = (slug: string) =>
  verifiedProcedure.use(({ ctx, next }) => {
    if (!ctx.permissions.includes(slug)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `Missing permission: ${slug}` })
    }
    return next({ ctx })
  })
