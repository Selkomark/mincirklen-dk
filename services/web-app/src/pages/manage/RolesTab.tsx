import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Checkbox } from '../../components/Checkbox'
import { TextField } from '../../components/TextField'
import { Alert } from '../../components/Alert'
import { getTrpc, postTrpc } from './manageShared'

interface Role {
  id: string
  name: string
  description: string | null
  isSystem: boolean
}

interface Permission {
  id: string
  slug: string
  description: string | null
}

function groupByPrefix(permissions: Permission[]): [string, Permission[]][] {
  const groups = new Map<string, Permission[]>()
  for (const permission of permissions) {
    const prefix = permission.slug.split('.')[0] ?? permission.slug
    const list = groups.get(prefix) ?? []
    list.push(permission)
    groups.set(prefix, list)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function PermissionEditor({
  allPermissions,
  selectedIds,
  onChange,
}: {
  allPermissions: Permission[]
  selectedIds: Set<string>
  onChange: (next: Set<string>) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {groupByPrefix(allPermissions).map(([prefix, permissions]) => (
        <div key={prefix}>
          <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 4 }}>
            {prefix}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
            {permissions.map((permission) => (
              <Checkbox
                key={permission.id}
                isSelected={selectedIds.has(permission.id)}
                onChange={(isSelected) => {
                  const next = new Set(selectedIds)
                  if (isSelected) next.add(permission.id)
                  else next.delete(permission.id)
                  onChange(next)
                }}
              >
                {permission.slug}
              </Checkbox>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function EditRoleCard({
  role,
  allPermissions,
  onSaved,
}: {
  role: Role
  allPermissions: Permission[]
  onSaved: () => void
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (role.isSystem) return
    void (async () => {
      const ids = await getTrpc<string[]>('rbac.roles.getPermissions', { roleId: role.id })
      setSelectedIds(new Set(ids))
    })()
  }, [role.id, role.isSystem])

  const save = async () => {
    if (!selectedIds) return
    setSaving(true)
    setError(null)
    try {
      await postTrpc('rbac.roles.updatePermissions', { roleId: role.id, permissionIds: [...selectedIds] })
      onSaved()
    } catch {
      setError('Failed to save permissions.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
        <div style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--text-primary)' }}>{role.name}</div>
        {role.isSystem && (
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>System role — not editable</span>
        )}
      </div>
      {role.description && (
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
          {role.description}
        </div>
      )}
      {error && <Alert variant="urgent">{error}</Alert>}
      {!role.isSystem && (
        <>
          {selectedIds ? (
            <PermissionEditor allPermissions={allPermissions} selectedIds={selectedIds} onChange={setSelectedIds} />
          ) : (
            <div style={{ color: 'var(--text-secondary)' }}>Loading…</div>
          )}
          <Button variant="safe" isPending={saving} onPress={() => void save()} style={{ marginTop: 'var(--space-3)' }}>
            Save permissions
          </Button>
        </>
      )}
    </Card>
  )
}

export function RolesTab() {
  const [roles, setRoles] = useState<Role[] | null>(null)
  const [permissions, setPermissions] = useState<Permission[] | null>(null)
  const [newRoleName, setNewRoleName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [roleList, permissionList] = await Promise.all([
      getTrpc<Role[]>('rbac.roles.list', undefined),
      getTrpc<Permission[]>('rbac.roles.listPermissions', undefined),
    ])
    setRoles(roleList)
    setPermissions(permissionList)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const createRole = async () => {
    if (!newRoleName.trim()) return
    setCreating(true)
    setError(null)
    try {
      await postTrpc('rbac.roles.create', { name: newRoleName.trim() })
      setNewRoleName('')
      await reload()
    } catch {
      setError('Failed to create role — name may already be taken.')
    } finally {
      setCreating(false)
    }
  }

  if (roles === null || permissions === null) {
    return <div style={{ color: 'var(--text-secondary)' }}>Loading…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && <Alert variant="urgent">{error}</Alert>}

      <Card>
        <div style={{ fontWeight: 'var(--font-weight-bold)', marginBottom: 'var(--space-2)' }}>Create a role</div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
          <TextField
            label="Role name"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            style={{ flex: 1 }}
          />
          <Button variant="safe" isPending={creating} onPress={() => void createRole()}>
            Create
          </Button>
        </div>
      </Card>

      {roles.map((role) => (
        <EditRoleCard key={role.id} role={role} allPermissions={permissions} onSaved={reload} />
      ))}
    </div>
  )
}
