import { describe, expect, test } from 'bun:test'
import { bootstrapAdminIfMasterEmail } from './adminBootstrapService'

describe('bootstrapAdminIfMasterEmail', () => {
  test('does nothing when MASTER_USER_EMAIL is unset', async () => {
    const calls: string[] = []
    await bootstrapAdminIfMasterEmail(
      {
        isBootstrapCompleted: async () => {
          calls.push('checked')
          return false
        },
        findRoleByName: async () => {
          throw new Error('should not look up a role when no master email is configured')
        },
        assignRole: async () => {
          throw new Error('should not assign anything')
        },
        markBootstrapCompleted: async () => {
          throw new Error('should not mark completed')
        },
      },
      { userId: 'u1', email: 'person@example.com', masterEmail: undefined },
    )
    expect(calls).toEqual([])
  })

  test('does nothing when the logging-in email does not match', async () => {
    await bootstrapAdminIfMasterEmail(
      {
        isBootstrapCompleted: async () => {
          throw new Error('should not check completion for a non-matching email')
        },
        findRoleByName: async () => {
          throw new Error('should not look up a role')
        },
        assignRole: async () => {
          throw new Error('should not assign anything')
        },
        markBootstrapCompleted: async () => {
          throw new Error('should not mark completed')
        },
      },
      { userId: 'u1', email: 'person@example.com', masterEmail: 'admin@example.com' },
    )
  })

  test('does nothing once bootstrap has already completed, even for the master email', async () => {
    await bootstrapAdminIfMasterEmail(
      {
        isBootstrapCompleted: async () => true,
        findRoleByName: async () => {
          throw new Error('should not look up a role once already bootstrapped')
        },
        assignRole: async () => {
          throw new Error('should not assign anything')
        },
        markBootstrapCompleted: async () => {
          throw new Error('should not mark completed again')
        },
      },
      { userId: 'u1', email: 'admin@example.com', masterEmail: 'admin@example.com' },
    )
  })

  test('does nothing if the admin role has not been seeded', async () => {
    const calls: string[] = []
    await bootstrapAdminIfMasterEmail(
      {
        isBootstrapCompleted: async () => false,
        findRoleByName: async (name) => {
          calls.push(name)
          return null
        },
        assignRole: async () => {
          throw new Error('should not assign anything with no role found')
        },
        markBootstrapCompleted: async () => {
          throw new Error('should not mark completed with no role found')
        },
      },
      { userId: 'u1', email: 'admin@example.com', masterEmail: 'admin@example.com' },
    )
    expect(calls).toEqual(['admin'])
  })

  test('assigns the admin role and marks bootstrap complete on first match', async () => {
    const assigned: Array<{ userId: string; roleId: string }> = []
    let marked = false
    await bootstrapAdminIfMasterEmail(
      {
        isBootstrapCompleted: async () => false,
        findRoleByName: async () => ({ id: 'role-admin' }),
        assignRole: async (userId, roleId) => {
          assigned.push({ userId, roleId })
        },
        markBootstrapCompleted: async () => {
          marked = true
        },
      },
      { userId: 'u1', email: 'admin@example.com', masterEmail: 'admin@example.com' },
    )
    expect(assigned).toEqual([{ userId: 'u1', roleId: 'role-admin' }])
    expect(marked).toBe(true)
  })
})
