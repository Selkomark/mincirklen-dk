import { listPendingReviewInputSchema, submitReviewDecisionInputSchema } from '@mincirklen/shared'
import { TRPCError } from '@trpc/server'
import { NoResultError } from 'kysely'
import { applyHumanReviewOutcome } from '../repositories/messageRepository'
import { countHumanReviewOutcomes, listPendingReview } from '../repositories/moderationEventRepository'
import { findModeratorLabels } from '../repositories/rbacRepository'
import { computeTransparencyMetrics } from '../services/moderationTransparencyService'
import { hasPermission, publicProcedure, router } from './trpc'

function toTRPCError(err: unknown): TRPCError {
  if (err instanceof NoResultError) {
    return new TRPCError({ code: 'NOT_FOUND', message: 'moderation event not found' })
  }
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', cause: err })
}

export const moderationRouter = router({
  // Seeing the queue and deciding in it are separate grants (migration
  // 0010) — a read-only role gets the first without the second.
  listPendingReview: hasPermission('moderation_events.read')
    .input(listPendingReviewInputSchema)
    .query(async ({ ctx, input }) => {
      const page = await listPendingReview(ctx.appEnv.db, input)
      // Decided rows name their reviewer the way the rest of /manage does
      // (full email — staff identifying staff).
      const labels = await findModeratorLabels(
        ctx.appEnv.db,
        ctx.appEnv.vault,
        page.events.map((e) => e.reviewedBy).filter((id): id is string => id !== null),
      )
      return { ...page, events: page.events.map((e) => ({ ...e, reviewedByLabel: e.reviewedBy ? (labels.get(e.reviewedBy) ?? null) : null })) }
    }),

  submitReviewDecision: hasPermission('moderation_events.review')
    .input(submitReviewDecisionInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        await applyHumanReviewOutcome(ctx.appEnv.db, {
          moderationEventId: input.moderationEventId,
          outcome: input.outcome,
          note: input.note,
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
