import {
  createGateInviteToken,
  getGateStatusInputSchema,
  grantGateSignupInputSchema,
  isKnownGateKey,
  listGateSignupsInputSchema,
  redeemGateInviteInputSchema,
  revokeGateSignupInputSchema,
  submitGateSignupInputSchema,
  updateGateStateInputSchema,
  verifyGateInviteToken,
} from '@mincirklen/shared'
import { TRPCError } from '@trpc/server'
import { countsByGateKey, findSignupById, insertSignup, listSignups, markGranted, markRevoked } from '../repositories/gateSignupRepository'
import { findState, listStates, upsertState } from '../repositories/featureGateStateRepository'
import {
  SignupNotFoundError,
  UnknownGateError,
  grantSignupAccess,
  isGateEffectivelyOpen,
  listGatesWithStats,
  redeemGateInvite,
  revokeSignupAccess,
  submitSignup,
  updateGateState,
} from '../services/featureGateService'
import { buildGateCookie } from '../context'
import { hasPermission, publicProcedure, router } from './trpc'

function toTRPCError(err: unknown): TRPCError {
  if (err instanceof UnknownGateError) {
    return new TRPCError({ code: 'BAD_REQUEST', message: err.message })
  }
  if (err instanceof SignupNotFoundError) {
    return new TRPCError({ code: 'NOT_FOUND', message: err.message })
  }
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', cause: err })
}

export const gatesRouter = router({
  submitSignup: publicProcedure.input(submitGateSignupInputSchema).mutation(async ({ ctx, input }) => {
    try {
      await submitSignup({ insertSignup: (gateKey, email) => insertSignup(ctx.appEnv.db, gateKey, email) }, input)
      return { ok: true }
    } catch (err) {
      throw toTRPCError(err)
    }
  }),

  // Gate key comes from the verified token itself, never a client-
  // supplied param — see gateInviteToken.ts's comment on why the payload
  // carries it.
  redeemInvite: publicProcedure.input(redeemGateInviteInputSchema).mutation(async ({ ctx, input }) => {
    const result = await redeemGateInvite(
      {
        verifyToken: (token) => verifyGateInviteToken(token, ctx.appEnv.gateInviteSecret),
        findSignupById: async (id) => {
          const row = await ctx.appEnv.db
            .selectFrom('gate_signups')
            .select(['gate_key', 'status'])
            .where('id', '=', id)
            .executeTakeFirst()
          return row ? { gateKey: row.gate_key, status: row.status } : null
        },
      },
      input.token,
    )

    if (!result.ok) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason })
    }

    ctx.resHeaders.append('set-cookie', buildGateCookie(result.gateKey, input.token, ctx.appEnv.publicBaseUrl))
    return { ok: true, gateKey: result.gateKey }
  }),

  getStatus: publicProcedure.input(getGateStatusInputSchema).query(async ({ ctx, input }) => {
    if (!isKnownGateKey(input.gateKey)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown gate: ${input.gateKey}` })
    }

    const open = await isGateEffectivelyOpen({ findState: (key) => findState(ctx.appEnv.db, key) }, input.gateKey)
    const cookieToken = ctx.gateTokens[input.gateKey]
    // Re-checks the signup's live status on every call (redeemGateInvite,
    // same as requireGateAccess in controllers/trpc.ts uses for real
    // enforcement) rather than trusting the cookie's signature alone —
    // otherwise a revoked visitor (GatesTab.tsx's Revoke button) would
    // keep seeing themselves as unlocked here and never get routed back
    // to the waitlist landing page (App.tsx's redirect effect), even
    // though their actual gated requests now correctly 403.
    const redeemed = cookieToken
      ? await redeemGateInvite(
          {
            verifyToken: (t) => verifyGateInviteToken(t, ctx.appEnv.gateInviteSecret),
            findSignupById: (id) => findSignupById(ctx.appEnv.db, id),
          },
          cookieToken,
        )
      : null
    // `unlocked` — open, or *this specific visitor* genuinely has a valid
    // grant for this gate — is deliberately kept separate from
    // `hasAccess` below: it's what the landing page's own display swap
    // uses (App.tsx), so a real invited visitor who redeemed their link
    // sees the unlocked page, not the waitlist form, regardless of the
    // gate's global mode.
    const unlocked = open || (redeemed?.ok === true && redeemed.gateKey === input.gateKey)
    // `hasAccess` additionally folds in the admin bypass — used for
    // navigation/enforcement (can this visitor reach a gated route at
    // all), where an admin always passes. Kept broader than `unlocked` on
    // purpose: an admin with no gate cookie of their own still needs
    // `hasAccess: true` to navigate freely, even while `unlocked: false`
    // correctly keeps them seeing the waitlist landing as a preview of
    // what a real visitor sees.
    const hasAccess = unlocked || ctx.permissions.includes('admin.access')
    return { open, unlocked, hasAccess }
  }),

  list: hasPermission('gates.read').query(({ ctx }) =>
    listGatesWithStats({ listStates: () => listStates(ctx.appEnv.db), countsByGateKey: () => countsByGateKey(ctx.appEnv.db) }),
  ),

  update: hasPermission('gates.manage')
    .input(updateGateStateInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        await updateGateState(
          { upsertState: (key, params) => upsertState(ctx.appEnv.db, key, params) },
          { ...input, updatedBy: ctx.userId },
        )
        return { ok: true }
      } catch (err) {
        throw toTRPCError(err)
      }
    }),

  listSignups: hasPermission('gates.read')
    .input(listGateSignupsInputSchema)
    .query(({ ctx, input }) => listSignups(ctx.appEnv.db, input.gateKey, input)),

  grantSignup: hasPermission('gates.manage')
    .input(grantGateSignupInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { gateKey, token } = await grantSignupAccess(
          {
            markGranted: (signupId, grantedBy) => markGranted(ctx.appEnv.db, signupId, grantedBy),
            createInviteToken: (key, signupId) => createGateInviteToken(key, signupId, ctx.appEnv.gateInviteSecret),
          },
          { signupId: input.signupId, grantedBy: ctx.userId },
        )
        return { inviteUrl: `${ctx.appEnv.publicBaseUrl}/?invite=${token}`, gateKey }
      } catch (err) {
        throw toTRPCError(err)
      }
    }),

  // Invalidates the person's existing invite link (redeemGateInvite only
  // ever accepts an exactly-'granted' row) without touching any session
  // they've already established — see App.tsx's manageAdminBypass-style
  // reasoning: gates.getStatus's `unlocked` only verifies the invite
  // token's own signature, never re-checks this row, so a visitor who
  // already redeemed their link and is mid-session keeps their access
  // until they lose that token some other way (e.g. a cookie clear).
  // This stops a mistaken grant, or a not-yet-redeemed link, cold; it is
  // not a kill switch for an active visitor.
  revokeSignup: hasPermission('gates.manage')
    .input(revokeGateSignupInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await revokeSignupAccess({ markRevoked: (signupId) => markRevoked(ctx.appEnv.db, signupId) }, { signupId: input.signupId })
      } catch (err) {
        throw toTRPCError(err)
      }
    }),
})
