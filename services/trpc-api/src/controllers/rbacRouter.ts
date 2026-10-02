import {
  addMemberNoteInputSchema,
  createRoleInputSchema,
  createSessionPolicyInputSchema,
  listUsersInputSchema,
  setRoleSessionPolicyInputSchema,
  updateRoleInputSchema,
  updateRolePermissionsInputSchema,
  updateSessionPolicyInputSchema,
  updateUserRolesInputSchema,
} from '@mincirklen/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  createRole,
  createSessionPolicy,
  findRoleById,
  findSessionPolicyById,
  getRolePermissionIds,
  listPermissions,
  listRoles,
  listSessionPolicies,
  listUsersWithRoles,
  replaceRolePermissions,
  replaceUserRoles,
  setRoleSessionPolicy,
  updateRole as updateRoleRow,
  updateSessionPolicy,
  findMaskedEmails,
} from '../repositories/rbacRepository'
import { SystemRoleImmutableError, updateRole as updateRoleService, updateRolePermissions } from '../services/rbacService'
import { insertMemberNote, listMemberNotes } from '../repositories/memberNoteRepository'
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
  myAccess: verifiedProcedure.query(({ ctx }) => ({
    roles: ctx.roles,
    permissions: ctx.permissions,
    // Seeds /manage's client-side idle timer (manageShared.ts) — the
    // resolved ceiling this very request was already checked against,
    // not a fresh lookup. See context.ts::createContextFactory.
    maxIdleSeconds: ctx.maxIdleSeconds,
  })),

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

    // Deliberately NOT routed through updateRoleService — that guard
    // throws SystemRoleImmutableError for any is_system role, and the
    // seeded `admin` role is exactly the role this feature's motivating
    // use case (rate-limiting a high-privilege role's idle session) needs
    // to stay attachable to. Calls the repository directly on purpose;
    // see setRoleSessionPolicy's own doc comment.
    setSessionPolicy: hasPermission('roles.update')
      .input(setRoleSessionPolicyInputSchema)
      .mutation(async ({ ctx, input }) => {
        await setRoleSessionPolicy(ctx.appEnv.db, input.roleId, input.sessionPolicyId)
        return { ok: true }
      }),
  }),

  // A reusable, named idle-session-duration template a role can
  // optionally attach to (roles.setSessionPolicy above). See
  // migrations/0001_init.ts's session_policies table comment and
  // services/sessionPolicyService.ts for how a user's effective duration
  // is resolved across every role they hold.
  sessionPolicies: router({
    list: hasPermission('session_policies.read').query(({ ctx }) => listSessionPolicies(ctx.appEnv.db)),

    create: hasPermission('session_policies.create')
      .input(createSessionPolicyInputSchema)
      .mutation(({ ctx, input }) => createSessionPolicy(ctx.appEnv.db, input)),

    update: hasPermission('session_policies.update')
      .input(updateSessionPolicyInputSchema)
      .mutation(async ({ ctx, input }) => {
        const existing = await findSessionPolicyById(ctx.appEnv.db, input.policyId)
        if (!existing) throw new TRPCError({ code: 'NOT_FOUND' })

        await updateSessionPolicy(ctx.appEnv.db, input)
        return { ok: true }
      }),
  }),

  users: router({
    // Moderator-only history on a member (migrations/0006) — readable by
    // anyone who can see users, writable by anyone who can change them.
    // Also written automatically by a session-report 'note' action.
    listNotes: hasPermission('users.read')
      .input(z.object({ userId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const notes = await listMemberNotes(ctx.appEnv.db, input.userId)
        const labels = await findMaskedEmails(
          ctx.appEnv.db,
          ctx.appEnv.vault,
          notes.map((n) => n.createdBy).filter((id): id is string => id !== null),
        )
        return notes.map((n) => ({ ...n, createdByLabel: n.createdBy ? (labels.get(n.createdBy) ?? null) : null }))
      }),

    addNote: hasPermission('users.update')
      .input(addMemberNoteInputSchema)
      .mutation(async ({ ctx, input }) => {
        await insertMemberNote(ctx.appEnv.db, { userId: input.userId, body: input.body, createdBy: ctx.userId })
        return { ok: true }
      }),

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
