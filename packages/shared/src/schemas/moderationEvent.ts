import { z } from 'zod'

export const classificationSchema = z.enum(['pass', 'flag', 'crisis'])

export type Classification = z.infer<typeof classificationSchema>

export const humanReviewOutcomeSchema = z.enum([
  'true_positive',
  'false_positive',
  'true_negative',
  'false_negative',
])

export type HumanReviewOutcome = z.infer<typeof humanReviewOutcomeSchema>

export const moderationEventSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  userId: z.string().uuid(),
  messageId: z.string().uuid().nullable(),
  classification: classificationSchema,
  humanReviewed: z.boolean(),
  humanReviewOutcome: humanReviewOutcomeSchema.nullable(),
  reviewedAt: z.coerce.date().nullable(),
  reviewedBy: z.string().uuid().nullable(),
  createdAt: z.coerce.date(),
})

export type ModerationEvent = z.infer<typeof moderationEventSchema>

export const listPendingReviewInputSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
})
export type ListPendingReviewInput = z.infer<typeof listPendingReviewInputSchema>

export const submitReviewDecisionInputSchema = z.object({
  moderationEventId: z.string().uuid(),
  outcome: humanReviewOutcomeSchema,
})
export type SubmitReviewDecisionInput = z.infer<typeof submitReviewDecisionInputSchema>
