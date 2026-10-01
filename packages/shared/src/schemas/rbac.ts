import { z } from 'zod'

export const roleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  sessionPolicyId: z.string().uuid().nullable(),
})
export type Role = z.infer<typeof roleSchema>

export const permissionSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  description: z.string().nullable(),
})
export type Permission = z.infer<typeof permissionSchema>

export const createRoleInputSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
})
export type CreateRoleInput = z.infer<typeof createRoleInputSchema>

export const updateRoleInputSchema = z.object({
  roleId: z.string().uuid(),
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
})
export type UpdateRoleInput = z.infer<typeof updateRoleInputSchema>

export const updateRolePermissionsInputSchema = z.object({
  roleId: z.string().uuid(),
  permissionIds: z.array(z.string().uuid()),
})
export type UpdateRolePermissionsInput = z.infer<typeof updateRolePermissionsInputSchema>

export const listUsersInputSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
})
export type ListUsersInput = z.infer<typeof listUsersInputSchema>

export const updateUserRolesInputSchema = z.object({
  userId: z.string().uuid(),
  roleIds: z.array(z.string().uuid()),
})
export type UpdateUserRolesInput = z.infer<typeof updateUserRolesInputSchema>

// 60s floor guards against a fat-fingered 0/negative value instantly
// locking out everyone in a role; 1yr ceiling guards against an absurd
// value defeating the point of the feature. The platform default
// (sessionToken.ts's DEFAULT_MAX_AGE_SECONDS, 180 days) is enforced
// separately as an upper clamp in sessionPolicyService.ts — a policy can
// only ever shorten a role's effective session, never lengthen it past
// that default, regardless of what's stored here.
export const sessionPolicyAttributesSchema = z.object({
  maxIdleSeconds: z
    .number()
    .int()
    .min(60)
    .max(60 * 60 * 24 * 365)
    .optional(),
})
export type SessionPolicyAttributes = z.infer<typeof sessionPolicyAttributesSchema>

export const sessionPolicySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  attributes: sessionPolicyAttributesSchema,
})
export type SessionPolicy = z.infer<typeof sessionPolicySchema>

export const createSessionPolicyInputSchema = z.object({
  name: z.string().min(2).max(100),
  attributes: sessionPolicyAttributesSchema,
})
export type CreateSessionPolicyInput = z.infer<typeof createSessionPolicyInputSchema>

export const updateSessionPolicyInputSchema = z.object({
  policyId: z.string().uuid(),
  name: z.string().min(2).max(100),
  attributes: sessionPolicyAttributesSchema,
})
export type UpdateSessionPolicyInput = z.infer<typeof updateSessionPolicyInputSchema>

export const setRoleSessionPolicyInputSchema = z.object({
  roleId: z.string().uuid(),
  sessionPolicyId: z.string().uuid().nullable(),
})
export type SetRoleSessionPolicyInput = z.infer<typeof setRoleSessionPolicyInputSchema>
