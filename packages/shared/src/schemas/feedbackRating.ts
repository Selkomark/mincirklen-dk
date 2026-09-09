import { z } from 'zod'

export const feedbackRatingSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  userId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  freeText: z.string().nullable(),
  createdAt: z.coerce.date(),
})

export type FeedbackRating = z.infer<typeof feedbackRatingSchema>
