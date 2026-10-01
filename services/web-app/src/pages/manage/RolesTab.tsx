import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Checkbox } from '../../components/Checkbox'
import { TextField } from '../../components/TextField'
import { Select, SelectItem } from '../../components/Select'
import { Alert } from '../../components/Alert'
import { getTrpc, postTrpc } from './manageShared'

interface Role {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  sessionPolicyId: string | null
}

interface Permission {
  id: string
  slug: string
  description: string | null
}

interface SessionPolicy {
  id: string
  name: string
  attributes: { maxIdleSeconds?: number }
}

type DurationUnit = 'minutes' | 'hours' | 'days'

const SECONDS_PER_UNIT: Record<DurationUnit, number> = {
  minutes: 60,
  hours: 60 * 60,
  days: 60 * 60 * 24,
}

// Platform default (sessionToken.ts's DEFAULT_MAX_AGE_SECONDS) — a role
// with no attached policy falls back to this. Used only as the sentinel
// "no policy" option's id below; the actual 180-day value lives
// server-side and is never sent from here.
const PLATFORM_DEFAULT_ID = ''

function formatDuration(maxIdleSeconds: number | undefined): string {
  if (!maxIdleSeconds) return ''
  if (maxIdleSeconds % SECONDS_PER_UNIT.days === 0) return `${maxIdleSeconds / SECONDS_PER_UNIT.days}d`
  if (maxIdleSeconds % SECONDS_PER_UNIT.hours === 0) return `${maxIdleSeconds / SECONDS_PER_UNIT.hours}h`
  if (maxIdleSeconds % SECONDS_PER_UNIT.minutes === 0) return `${maxIdleSeconds / SECONDS_PER_UNIT.minutes}m`
  return `${maxIdleSeconds}s`
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

function RoleSessionPolicyPicker({
  role,
  sessionPolicies,
  onChanged,
}: {
  role: Role
  sessionPolicies: SessionPolicy[]
  onChanged: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setPolicy = async (policyId: string) => {
    setSaving(true)
    setError(null)
    try {
      await postTrpc('rbac.roles.setSessionPolicy', { roleId: role.id, sessionPolicyId: policyId || null })
      onChanged()
    } catch {
      setError('Failed to set the session policy.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginBottom: 'var(--space-3)' }}>
      {error && <Alert variant="urgent">{error}</Alert>}
      {/* Deliberately available for every role, including system ones —
          an admin role is exactly the kind of role this feature exists
          to rate-limit, unlike permission editing above which is locked
          for system roles. */}
      <Select
        label="Session idle timeout"
        selectedKey={role.sessionPolicyId ?? PLATFORM_DEFAULT_ID}
        isDisabled={saving}
        onSelectionChange={(key) => void setPolicy(String(key))}
      >
        <SelectItem id={PLATFORM_DEFAULT_ID}>Platform default (180 days)</SelectItem>
        {sessionPolicies.map((policy) => (
          <SelectItem key={policy.id} id={policy.id}>
            {policy.name} ({formatDuration(policy.attributes.maxIdleSeconds)})
          </SelectItem>
        ))}
      </Select>
    </div>
  )
}

function EditRoleCard({
  role,
  allPermissions,
  sessionPolicies,
  onSaved,
}: {
  role: Role
  allPermissions: Permission[]
  sessionPolicies: SessionPolicy[]
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
      <RoleSessionPolicyPicker role={role} sessionPolicies={sessionPolicies} onChanged={onSaved} />
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

function CreateSessionPolicyCard({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState<DurationUnit>('minutes')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    const parsedValue = Number(value)
    if (!name.trim() || !Number.isFinite(parsedValue) || parsedValue <= 0) return

    setCreating(true)
    setError(null)
    try {
      const maxIdleSeconds = Math.round(parsedValue * SECONDS_PER_UNIT[unit])
      await postTrpc('rbac.sessionPolicies.create', { name: name.trim(), attributes: { maxIdleSeconds } })
      setName('')
      setValue('')
      onCreated()
    } catch {
      setError('Failed to create session policy — name may already be taken, or the duration is out of range (1min–1yr).')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Card>
      <div style={{ fontWeight: 'var(--font-weight-bold)', marginBottom: 'var(--space-2)' }}>Create a session policy</div>
      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
        A named idle-timeout template — attach it to any role below. A user holding several roles is bound by whichever
        attached policy resolves to the shortest duration.
      </div>
      {error && <Alert variant="urgent">{error}</Alert>}
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <TextField label="Policy name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
        <TextField
          label="Max idle time"
          type="number"
          min={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ width: 100 }}
        />
        <Select label="Unit" selectedKey={unit} onSelectionChange={(key) => setUnit(key as DurationUnit)} style={{ width: 120 }}>
          <SelectItem id="minutes">Minutes</SelectItem>
          <SelectItem id="hours">Hours</SelectItem>
          <SelectItem id="days">Days</SelectItem>
        </Select>
        <Button variant="safe" isPending={creating} onPress={() => void create()}>
          Create
        </Button>
      </div>
    </Card>
  )
}

export function RolesTab() {
  const [roles, setRoles] = useState<Role[] | null>(null)
  const [permissions, setPermissions] = useState<Permission[] | null>(null)
  const [sessionPolicies, setSessionPolicies] = useState<SessionPolicy[] | null>(null)
  const [newRoleName, setNewRoleName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [roleList, permissionList, policyList] = await Promise.all([
      getTrpc<Role[]>('rbac.roles.list', undefined),
      getTrpc<Permission[]>('rbac.roles.listPermissions', undefined),
      getTrpc<SessionPolicy[]>('rbac.sessionPolicies.list', undefined),
    ])
    setRoles(roleList)
    setPermissions(permissionList)
    setSessionPolicies(policyList)
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

  if (roles === null || permissions === null || sessionPolicies === null) {
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

      <CreateSessionPolicyCard onCreated={reload} />

      {roles.map((role) => (
        <EditRoleCard key={role.id} role={role} allPermissions={permissions} sessionPolicies={sessionPolicies} onSaved={reload} />
      ))}
    </div>
  )
}
