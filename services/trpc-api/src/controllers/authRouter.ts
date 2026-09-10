import { randomUUID } from 'node:crypto'
import { createSessionToken, createUserProfileInputSchema } from '@mincirklen/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { deleteUser } from '../repositories/userRepository'
import { hasLinkedIdentityForUser } from '../repositories/userIdentityRepository'
import { findUserProfileByUserId, upsertUserProfile, userProfileExists } from '../repositories/userProfileRepository'
import { listActiveSessionIdsForUser } from '../repositories/sessionRepository'
import {
  findDataExportRequestForUser,
  findDataExportRequestsForUser,
  insertDataExportRequest,
} from '../repositories/dataExportRequestRepository'
import { KmsError } from '../adapters/kmsAdapter'
import { publishDataExportRequested } from '../adapters/pubsubAdapter'
import { notifyProfileUpdated } from '../adapters/websocketServiceAdapter'
import { completeUserProfile } from '../services/userProfileService'
import { deleteAccount } from '../services/accountDeletionService'
import { getDataExportStatus, requestDataExport } from '../services/dataExportRequestService'
import { ExportNotFoundError, ExportNotReadyError, createExportDownloadToken } from '../services/exportDownloadService'
import { buildLegacySessionCookieClear, buildLogoutCookie } from '../context'
import type { AppEnv } from '../context'
import { googleLinkedProcedure, protectedProcedure, publicProcedure, router } from './trpc'

// Fans a profile save out live to every active session this user
// currently belongs to, so other connected viewers' roster entries
// (SessionPage.tsx's memberFor) update immediately instead of waiting
// on their next ~20s getState poll — see websocket-service's
// createProfileUpdatedHandler. Fire-and-forget per session, same
// rationale as sessionRouter.ts's notifyJoinedFireAndForget: Postgres is
// already the source of truth for the new profile by this point, so a
// missed live relay only means a slightly later update on the next poll,
// never a correctness gap.
function notifyProfileUpdatedFireAndForget(env: AppEnv, userId: string, displayName: string | null): void {
  void listActiveSessionIdsForUser(env.db, userId)
    .then((sessionIds) =>
      Promise.all(
        sessionIds.map((sessionId) =>
          notifyProfileUpdated(env.websocketServiceUrl, env.internalServiceSecret, sessionId, userId, displayName).catch((err) => {
            console.error('[PROFILE] failed to notify websocket-service of a profile update', sessionId, err)
          }),
        ),
      ),
    )
    .catch((err) => {
      console.error('[PROFILE] failed to look up active sessions to notify of a profile update', err)
    })
}

export const authRouter = router({
  // publicProcedure, not protectedProcedure: logging out must never itself
  // fail — an already-expired or missing session cookie is exactly the
  // state this is meant to end up in anyway, so there's nothing to guard.
  logout: publicProcedure.mutation(({ ctx }) => {
    ctx.resHeaders.append('set-cookie', buildLogoutCookie(ctx.appEnv.publicBaseUrl))
    ctx.resHeaders.append('set-cookie', buildLegacySessionCookieClear())
    return { ok: true }
  }),

  whoAmI: protectedProcedure.query(({ ctx }) => ({ userId: ctx.userId })),

  // The full picture the frontend's auth gate needs (App.tsx):
  // `hasLinkedIdentity: false` means "still needs Google" (in practice
  // unreachable today, since resolveGoogleLogin is the only way to get a
  // session cookie at all — kept as a real, independently-checked signal
  // rather than assumed, so it stays correct if that ever changes),
  // `hasProfile: false` (with `hasLinkedIdentity: true`) means "Google
  // done, still needs RegisterPage.tsx." Only `hasLinkedIdentity &&
  // hasProfile` means the operator's actual bar for using the platform is
  // met — see verificationService.ts.
  //
  // This runs on every page load (App.tsx's auth gate), so `hasProfile`
  // is answered via the KMS-free existence check, never by whether
  // `profile` below decrypted successfully — a Vault/KMS outage or
  // key-rotation hiccup must degrade PII display, not lock an already-
  // registered user out of the app. `profile` is still the real decrypted
  // data when available; on a KMS failure it's null (data temporarily
  // unavailable) while `hasProfile` stays true.
  myProfile: protectedProcedure.query(async ({ ctx }) => {
    const [hasLinkedIdentity, hasProfile, profile] = await Promise.all([
      hasLinkedIdentityForUser(ctx.appEnv.db, ctx.userId),
      userProfileExists(ctx.appEnv.db, ctx.userId),
      findUserProfileByUserId(ctx.appEnv.db, ctx.appEnv.vault, ctx.userId).catch((err) => {
        if (!(err instanceof KmsError)) throw err
        console.error('[AUTH] myProfile: failed to decrypt existing profile', err)
        return null
      }),
    ])

    return { hasLinkedIdentity, hasProfile, profile }
  }),

  // The post-login registration page (RegisterPage.tsx) — collects
  // opt-in identity info into `user_profiles`, separate from `users`.
  // googleLinkedProcedure, not protectedProcedure: a bare anonymous
  // session must never be able to "complete" a profile without ever
  // proving it's a real, traceable person via Google first.
  completeProfile: googleLinkedProcedure.input(createUserProfileInputSchema).mutation(async ({ ctx, input }) => {
    const profile = await completeUserProfile(
      {
        upsertUserProfile: (params) => upsertUserProfile(ctx.appEnv.db, ctx.appEnv.vault, { userId: ctx.userId, ...params }),
      },
      input,
    )

    // Read off the validated input, not `profile` — completeUserProfile's
    // return type is narrowed to { id }, and the upsert persists exactly
    // what was submitted anyway. Only ever a name reveal/mask, never
    // anything else this endpoint can change (country/timezone/etc aren't
    // shown per-member anywhere) — mirrors findDisplayNames' identical
    // stayAnonymous-gated logic, so the live push and the next poll agree.
    notifyProfileUpdatedFireAndForget(ctx.appEnv, ctx.userId, input.stayAnonymous ? null : input.firstName)

    return profile
  }),

  // GDPR right to erasure (Article 17) — immediate, no grace period (see
  // the plan this shipped with). Existing cascade FKs do the actual
  // cleanup; account_bans/account_ban_evidence are untouched by
  // construction. Clears the session cookie server-side too, same as
  // `logout` above — the account this cookie names no longer exists
  // either way, so there's nothing left to guard by not clearing it.
  deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
    await deleteAccount({ deleteUser: () => deleteUser(ctx.appEnv.db, ctx.userId) })

    ctx.resHeaders.append('set-cookie', buildLogoutCookie(ctx.appEnv.publicBaseUrl))
    ctx.resHeaders.append('set-cookie', buildLegacySessionCookieClear())

    return { ok: true }
  }),

  // "Download your data" (GDPR Article 20) — see
  // services/dataExportRequestService.ts's doc comment for why this only
  // inserts a row and publishes, never aggregates anything itself.
  requestDataExport: protectedProcedure.mutation(({ ctx }) =>
    requestDataExport({
      generateId: () => randomUUID(),
      insertRequest: (id) => insertDataExportRequest(ctx.appEnv.db, ctx.userId, id),
      publish: (requestId) => publishDataExportRequested(ctx.appEnv.pubsub, { requestId, userId: ctx.userId }),
    }),
  ),

  getDataExportStatus: protectedProcedure.query(({ ctx }) =>
    getDataExportStatus({ findRequests: () => findDataExportRequestsForUser(ctx.appEnv.db, ctx.userId) }),
  ),

  // Mints a fresh, short-lived (1 day) download token every call, rather
  // than handing back anything reusable/long-lived — see
  // exportDownloadService.ts and controllers/exportDownloadController.ts,
  // the proxy route this URL points at.
  createExportDownloadToken: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const token = await createExportDownloadToken({
          findRequest: () => findDataExportRequestForUser(ctx.appEnv.db, ctx.userId, input.requestId),
          signToken: () => createSessionToken(input.requestId, ctx.appEnv.downloadTokenSecret),
        })
        return { url: `${ctx.appEnv.trpcPublicBaseUrl}/storage/exports/${token}` }
      } catch (err) {
        if (err instanceof ExportNotFoundError) throw new TRPCError({ code: 'NOT_FOUND', message: err.message })
        if (err instanceof ExportNotReadyError) throw new TRPCError({ code: 'CONFLICT', message: err.message })
        throw err
      }
    }),
})
