import {
  createRoleInputSchema,
  listUsersInputSchema,
  updateRoleInputSchema,
  updateRolePermissionsInputSchema,
  updateUserRolesInputSchema,
} from '@mincirklen/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  createRole,
  findRoleById,
  getRolePermissionIds,
  listPermissions,
  listRoles,
  listUsersWithRoles,
  replaceRolePermissions,
  replaceUserRoles,
  updateRole as updateRoleRow,
} from '../repositories/rbacRepository'
import { SystemRoleImmutableError, updateRole as updateRoleService, updateRolePermissions } from '../services/rbacService'
import { hasPermission, router, verifiedProcedure } from './trpc'

function toTRPCError(err: unknown): TRPCError {
  if (err instanceof SystemRoleImmutableError) {
    return new TRPCError({ code: 'FORBIDDEN', message: err.message })
  }
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', cause: err })
}

export const rbacRouter = router({
  // The frontend's client-side UX gate (not the real security boundary —
  // every procedure below is independently gated by hasPermission). Any
  // verified user can call this; it just reflects back whatever roles/
  // permissions they actually have, which is empty for most users.
  myAccess: verifiedProcedure.query(({ ctx }) => ({ roles: ctx.roles, permissions: ctx.permissions })),

  roles: router({
    list: hasPermission('roles.read').query(({ ctx }) => listRoles(ctx.appEnv.db)),

    listPermissions: hasPermission('roles.read').query(({ ctx }) => listPermissions(ctx.appEnv.db)),

    getPermissions: hasPermission('roles.read')
      .input(z.object({ roleId: z.string().uuid() }))
      .query(({ ctx, input }) => getRolePermissionIds(ctx.appEnv.db, input.roleId)),

    create: hasPermission('roles.create')
      .input(createRoleInputSchema)
      .mutation(({ ctx, input }) => createRole(ctx.appEnv.db, { name: input.name, description: input.description ?? null })),

    update: hasPermission('roles.update')
      .input(updateRoleInputSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          await updateRoleService(
            {
              findRoleById: (roleId) => findRoleById(ctx.appEnv.db, roleId),
              updateRole: (roleId, name, description) => updateRoleRow(ctx.appEnv.db, { roleId, name, description }),
            },
            { roleId: input.roleId, name: input.name, description: input.description ?? null },
          )
          return { ok: true }
        } catch (err) {
          throw toTRPCError(err)
        }
      }),

    updatePermissions: hasPermission('roles.update')
      .input(updateRolePermissionsInputSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          await updateRolePermissions(
            {
              findRoleById: (roleId) => findRoleById(ctx.appEnv.db, roleId),
              replaceRolePermissions: (roleId, permissionIds) => replaceRolePermissions(ctx.appEnv.db, roleId, permissionIds),
            },
            { roleId: input.roleId, permissionIds: input.permissionIds },
          )
          return { ok: true }
        } catch (err) {
          throw toTRPCError(err)
        }
      }),
  }),

  users: router({
    list: hasPermission('users.read')
      .input(listUsersInputSchema)
      .query(({ ctx, input }) => listUsersWithRoles(ctx.appEnv.db, ctx.appEnv.vault, input)),

    updateRoles: hasPermission('users.update')
      .input(updateUserRolesInputSchema)
      .mutation(async ({ ctx, input }) => {
        await replaceUserRoles(ctx.appEnv.db, input.userId, input.roleIds)
        return { ok: true }
      }),
  }),
})
