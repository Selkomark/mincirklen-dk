import { z } from 'zod'

export const sessionUserSchema = z.object({
  userId: z.string().uuid(),
  turnOrder: z.number().int().min(0),
})

export type SessionUser = z.infer<typeof sessionUserSchema>
