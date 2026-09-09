import { z } from 'zod'

export const roleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
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
