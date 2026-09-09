import { z } from 'zod'

export const userIdentitySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  provider: z.string(),
  providerSubjectHash: z.string(),
  linkedAt: z.coerce.date(),
})

export type UserIdentity = z.infer<typeof userIdentitySchema>
