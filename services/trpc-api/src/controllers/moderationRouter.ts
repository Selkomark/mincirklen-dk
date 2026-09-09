import { listPendingReviewInputSchema, submitReviewDecisionInputSchema } from '@mincirklen/shared'
import { TRPCError } from '@trpc/server'
import { NoResultError } from 'kysely'
import { applyHumanReviewOutcome } from '../repositories/messageRepository'
import { countHumanReviewOutcomes, listPendingReview } from '../repositories/moderationEventRepository'
import { computeTransparencyMetrics } from '../services/moderationTransparencyService'
import { hasPermission, publicProcedure, router } from './trpc'

function toTRPCError(err: unknown): TRPCError {
  if (err instanceof NoResultError) {
    return new TRPCError({ code: 'NOT_FOUND', message: 'moderation event not found' })
  }
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', cause: err })
}

export const moderationRouter = router({
  listPendingReview: hasPermission('moderation_events.review')
    .input(listPendingReviewInputSchema)
    .query(({ ctx, input }) => listPendingReview(ctx.appEnv.db, input)),

  submitReviewDecision: hasPermission('moderation_events.review')
    .input(submitReviewDecisionInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        await applyHumanReviewOutcome(ctx.appEnv.db, {
          moderationEventId: input.moderationEventId,
          outcome: input.outcome,
          reviewedBy: ctx.userId,
        })
        return { ok: true }
      } catch (err) {
        throw toTRPCError(err)
      }
    }),

  // Aggregate-only, no per-event detail, no PII — exactly what
  // ModerationTransparencyPage.tsx needs, safe to leave unauthenticated.
  transparencyMetrics: publicProcedure.query(async ({ ctx }) => {
    const counts = await countHumanReviewOutcomes(ctx.appEnv.db)
    return computeTransparencyMetrics(counts)
  }),
})
