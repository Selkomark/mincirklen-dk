import { z } from 'zod'

export const topicSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  label: z.string(),
})

export type Topic = z.infer<typeof topicSchema>
