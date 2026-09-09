import { describe, expect, test } from 'bun:test'
import { SystemRoleImmutableError, updateRole, updateRolePermissions } from './rbacService'

describe('updateRolePermissions', () => {
  test('rejects modifying a system role', async () => {
    await expect(
      updateRolePermissions(
        {
          findRoleById: async () => ({ isSystem: true }),
          replaceRolePermissions: async () => {
            throw new Error('should not replace permissions on a system role')
          },
        },
        { roleId: 'admin-role', permissionIds: [] },
      ),
    ).rejects.toBeInstanceOf(SystemRoleImmutableError)
  })

  test('rejects a role that does not exist', async () => {
    await expect(
      updateRolePermissions(
        { findRoleById: async () => null, replaceRolePermissions: async () => {} },
        { roleId: 'missing', permissionIds: [] },
      ),
    ).rejects.toThrow('Role not found')
  })

  test('replaces permissions on a non-system role', async () => {
    const calls: Array<{ roleId: string; permissionIds: string[] }> = []
    await updateRolePermissions(
      {
        findRoleById: async () => ({ isSystem: false }),
        replaceRolePermissions: async (roleId, permissionIds) => {
          calls.push({ roleId, permissionIds })
        },
      },
      { roleId: 'custom-role', permissionIds: ['p1', 'p2'] },
    )
    expect(calls).toEqual([{ roleId: 'custom-role', permissionIds: ['p1', 'p2'] }])
  })
})

describe('updateRole', () => {
  test('rejects renaming a system role', async () => {
    await expect(
      updateRole(
        {
          findRoleById: async () => ({ isSystem: true }),
          updateRole: async () => {
            throw new Error('should not rename a system role')
          },
        },
        { roleId: 'admin-role', name: 'not admin anymore', description: null },
      ),
    ).rejects.toBeInstanceOf(SystemRoleImmutableError)
  })

  test('updates a non-system role', async () => {
    const calls: Array<{ roleId: string; name: string; description: string | null }> = []
    await updateRole(
      {
        findRoleById: async () => ({ isSystem: false }),
        updateRole: async (roleId, name, description) => {
          calls.push({ roleId, name, description })
        },
      },
      { roleId: 'custom-role', name: 'Reviewer', description: 'Can review flagged content' },
    )
    expect(calls).toEqual([{ roleId: 'custom-role', name: 'Reviewer', description: 'Can review flagged content' }])
  })
})
