import { z } from 'zod'

export const gateModeSchema = z.enum(['open', 'invite_only'])
export type GateMode = z.infer<typeof gateModeSchema>

export const gateStatSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  mode: gateModeSchema,
  scheduledOpenAt: z.coerce.date().nullable(),
  open: z.boolean(),
  pendingCount: z.number().int().min(0),
  grantedCount: z.number().int().min(0),
  revokedCount: z.number().int().min(0),
})
export type GateStat = z.infer<typeof gateStatSchema>

export const submitGateSignupInputSchema = z.object({
  gateKey: z.string(),
  email: z.string().trim().toLowerCase().email(),
})
export type SubmitGateSignupInput = z.infer<typeof submitGateSignupInputSchema>

export const updateGateStateInputSchema = z.object({
  gateKey: z.string(),
  mode: gateModeSchema,
  scheduledOpenAt: z.coerce.date().nullable(),
})
export type UpdateGateStateInput = z.infer<typeof updateGateStateInputSchema>

export const listGateSignupsInputSchema = z.object({
  gateKey: z.string(),
  status: z.enum(['pending', 'granted', 'revoked']).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
})
export type ListGateSignupsInput = z.infer<typeof listGateSignupsInputSchema>

export const gateSignupSchema = z.object({
  id: z.string().uuid(),
  gateKey: z.string(),
  email: z.string(),
  status: z.enum(['pending', 'granted', 'revoked']),
  createdAt: z.coerce.date(),
  grantedAt: z.coerce.date().nullable(),
  grantedBy: z.string().nullable(),
})
export type GateSignup = z.infer<typeof gateSignupSchema>

export const grantGateSignupInputSchema = z.object({
  signupId: z.string().uuid(),
})
export type GrantGateSignupInput = z.infer<typeof grantGateSignupInputSchema>

export const revokeGateSignupInputSchema = z.object({
  signupId: z.string().uuid(),
})
export type RevokeGateSignupInput = z.infer<typeof revokeGateSignupInputSchema>

export const redeemGateInviteInputSchema = z.object({
  token: z.string(),
})
export type RedeemGateInviteInput = z.infer<typeof redeemGateInviteInputSchema>

export const getGateStatusInputSchema = z.object({
  gateKey: z.string(),
})
export type GetGateStatusInput = z.infer<typeof getGateStatusInputSchema>
