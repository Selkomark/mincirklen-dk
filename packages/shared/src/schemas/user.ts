import { z } from 'zod'

export const userSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.coerce.date(),
  lastSeenAt: z.coerce.date().nullable(),
})

export type User = z.infer<typeof userSchema>
