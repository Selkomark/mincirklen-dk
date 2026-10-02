import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Alert } from '../../components/Alert'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { Checkbox } from '../../components/Checkbox'
import { Modal } from '../../components/Modal'
import { Select, SelectItem } from '../../components/Select'
import { Skeleton } from '../../components/Skeleton'
import { Table } from '../../components/Table'
import { Tab, TabList, TabPanel, Tabs } from '../../components/Tabs'
import { Text } from '../../components/Text'
import { TextField } from '../../components/TextField'
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
const PLATFORM_DEFAULT_LABEL = 'Platform default (180 days)'

function formatDuration(maxIdleSeconds: number | undefined): string {
  if (!maxIdleSeconds) return '—'
  const units: [DurationUnit, string][] = [
    ['days', 'day'],
    ['hours', 'hour'],
    ['minutes', 'minute'],
  ]
  for (const [unit, label] of units) {
    if (maxIdleSeconds % SECONDS_PER_UNIT[unit] === 0) {
      const count = maxIdleSeconds / SECONDS_PER_UNIT[unit]
      return `${count} ${label}${count === 1 ? '' : 's'}`
    }
  }
  return `${maxIdleSeconds} seconds`
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

const EMPTY_CELL = <span style={{ color: 'var(--text-secondary)' }}>—</span>

// Same column count as the real table so the layout doesn't jump once
// data lands — see .agents/skills/skeleton-loading.
function TableSkeleton({ columns, rows = 3 }: { columns: number; rows?: number }) {
  return (
    <Table striped>
      <thead>
        <tr>
          {Array.from({ length: columns }).map((_, i) => (
            <th key={i}>
              <Skeleton width="60%" height={12} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r}>
            {Array.from({ length: columns }).map((_, c) => (
              <td key={c}>
                <Skeleton width={c === 0 ? '70%' : '50%'} height={14} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

// Toolbar above each table: one line of context on the left, the one
// primary action on the right. Creation lives in a Modal so the list
// itself is the page, not a stack of forms above it.
function PanelToolbar({ description, action }: { description: string; action: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
      <Text variant="muted" style={{ margin: 0 }}>
        {description}
      </Text>
      {action}
    </div>
  )
}

function ModalActions({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>{children}</div>
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
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-bold)',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            {prefix}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
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

function SessionPolicySelect({
  value,
  onChange,
  sessionPolicies,
  isDisabled,
}: {
  value: string
  onChange: (policyId: string) => void
  sessionPolicies: SessionPolicy[]
  isDisabled?: boolean
}) {
  return (
    <Select label="Session idle timeout" selectedKey={value} isDisabled={isDisabled} onSelectionChange={(key) => onChange(String(key))}>
      <SelectItem id={PLATFORM_DEFAULT_ID}>{PLATFORM_DEFAULT_LABEL}</SelectItem>
      {sessionPolicies.map((policy) => (
        <SelectItem key={policy.id} id={policy.id}>
          {policy.name} ({formatDuration(policy.attributes.maxIdleSeconds)})
        </SelectItem>
      ))}
    </Select>
  )
}

function EditRoleModal({
  role,
  allPermissions,
  sessionPolicies,
  onClose,
  onSaved,
}: {
  role: Role
  allPermissions: Permission[]
  sessionPolicies: SessionPolicy[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [policyId, setPolicyId] = useState(role.sessionPolicyId ?? PLATFORM_DEFAULT_ID)
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
    setSaving(true)
    setError(null)
    try {
      // The session policy is editable on every role, including system
      // ones — an admin role is exactly the kind of role idle policies
      // exist to rate-limit. Permissions stay locked for system roles.
      if (policyId !== (role.sessionPolicyId ?? PLATFORM_DEFAULT_ID)) {
        await postTrpc('rbac.roles.setSessionPolicy', { roleId: role.id, sessionPolicyId: policyId || null })
      }
      if (!role.isSystem && selectedIds) {
        await postTrpc('rbac.roles.updatePermissions', { roleId: role.id, permissionIds: [...selectedIds] })
      }
      await onSaved()
      onClose()
    } catch {
      setError('Failed to save the role.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} title={role.name}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {role.description && (
          <Text variant="muted" style={{ margin: 0 }}>
            {role.description}
          </Text>
        )}
        {error && <Alert variant="urgent">{error}</Alert>}

        <SessionPolicySelect value={policyId} onChange={setPolicyId} sessionPolicies={sessionPolicies} isDisabled={saving} />

        <div>
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
            Permissions
          </div>
          {role.isSystem ? (
            <Alert variant="info">System role — holds every permission and cannot be edited.</Alert>
          ) : selectedIds ? (
            <PermissionEditor allPermissions={allPermissions} selectedIds={selectedIds} onChange={setSelectedIds} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <Skeleton width="40%" height={14} />
              <Skeleton width="55%" height={14} />
              <Skeleton width="45%" height={14} />
            </div>
          )}
        </div>

        <ModalActions>
          <Button variant="ghost" onPress={onClose} isDisabled={saving}>
            Cancel
          </Button>
          <Button variant="safe" isPending={saving} onPress={() => void save()}>
            Save
          </Button>
        </ModalActions>
      </div>
    </Modal>
  )
}

function CreateRoleModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    try {
      await postTrpc('rbac.roles.create', { name: name.trim() })
      await onCreated()
      onClose()
    } catch {
      setError('Failed to create role — name may already be taken.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} title="New role">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        {error && <Alert variant="urgent">{error}</Alert>}
        <TextField label="Role name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <ModalActions>
          <Button variant="ghost" onPress={onClose} isDisabled={creating}>
            Cancel
          </Button>
          <Button type="submit" variant="safe" isPending={creating} isDisabled={!name.trim()}>
            Create
          </Button>
        </ModalActions>
      </form>
    </Modal>
  )
}

function CreateSessionPolicyModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState<DurationUnit>('minutes')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsedValue = Number(value)
  const isValid = name.trim().length > 0 && Number.isFinite(parsedValue) && parsedValue > 0

  const create = async () => {
    if (!isValid) return
    setCreating(true)
    setError(null)
    try {
      const maxIdleSeconds = Math.round(parsedValue * SECONDS_PER_UNIT[unit])
      await postTrpc('rbac.sessionPolicies.create', { name: name.trim(), attributes: { maxIdleSeconds } })
      await onCreated()
      onClose()
    } catch {
      setError('Failed to create session policy — name may already be taken, or the duration is out of range (1 minute to 1 year).')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} title="New session policy">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        <Text variant="muted" style={{ margin: 0 }}>
          A named idle-timeout template you can attach to roles. A user holding several roles is bound by whichever attached
          policy is shortest.
        </Text>
        {error && <Alert variant="urgent">{error}</Alert>}
        <TextField label="Policy name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        {/* Each field sits in its own flex wrapper — TextField forwards
            `style` to the inner <input>, whose own wrapper is a flex
            column, so `flex: 1` there collapses the input's height
            instead of widening it. Digits-only text instead of
            type="number": the DS field has no styling for the native
            spinner, which otherwise shows up next to every other
            spinner-less control. */}
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <div style={{ flex: 1 }}>
            <TextField
              label="Max idle time"
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <div style={{ flex: 1 }}>
            <Select label="Unit" selectedKey={unit} onSelectionChange={(key) => setUnit(key as DurationUnit)}>
              <SelectItem id="minutes">Minutes</SelectItem>
              <SelectItem id="hours">Hours</SelectItem>
              <SelectItem id="days">Days</SelectItem>
            </Select>
          </div>
        </div>
        <ModalActions>
          <Button variant="ghost" onPress={onClose} isDisabled={creating}>
            Cancel
          </Button>
          <Button type="submit" variant="safe" isPending={creating} isDisabled={!isValid}>
            Create
          </Button>
        </ModalActions>
      </form>
    </Modal>
  )
}

function RolesPanel({
  roles,
  permissionCounts,
  allPermissions,
  sessionPolicies,
  reload,
}: {
  roles: Role[]
  permissionCounts: Record<string, number>
  allPermissions: Permission[]
  sessionPolicies: SessionPolicy[]
  reload: () => Promise<void>
}) {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Role | null>(null)
  const policyById = new Map(sessionPolicies.map((policy) => [policy.id, policy]))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <PanelToolbar
        description="Roles bundle permissions. Assign them to users from the Users page."
        action={
          <Button variant="safe" onPress={() => setCreating(true)}>
            New role
          </Button>
        }
      />

      <Table striped>
        <thead>
          <tr>
            <th>Role</th>
            <th>Description</th>
            <th>Permissions</th>
            <th>Session idle timeout</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => {
            const policy = role.sessionPolicyId ? policyById.get(role.sessionPolicyId) : undefined
            return (
              <tr key={role.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 'var(--font-weight-medium)' }}>{role.name}</span>
                    {role.isSystem && <Badge variant="info">System</Badge>}
                  </div>
                </td>
                <td>{role.description ?? EMPTY_CELL}</td>
                <td>{role.isSystem ? 'All' : (permissionCounts[role.id] ?? 0)}</td>
                <td>
                  {policy ? (
                    <>
                      {policy.name} <span style={{ color: 'var(--text-secondary)' }}>({formatDuration(policy.attributes.maxIdleSeconds)})</span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--text-secondary)' }}>{PLATFORM_DEFAULT_LABEL}</span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <Button variant="ghost" onPress={() => setEditing(role)}>
                    Edit
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>

      {creating && <CreateRoleModal onClose={() => setCreating(false)} onCreated={reload} />}
      {editing && (
        <EditRoleModal
          key={editing.id}
          role={editing}
          allPermissions={allPermissions}
          sessionPolicies={sessionPolicies}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </div>
  )
}

function SessionPoliciesPanel({
  roles,
  sessionPolicies,
  reload,
}: {
  roles: Role[]
  sessionPolicies: SessionPolicy[]
  reload: () => Promise<void>
}) {
  const [creating, setCreating] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <PanelToolbar
        description={`Idle-timeout templates attached to roles. Roles without one use the ${PLATFORM_DEFAULT_LABEL.toLowerCase()}.`}
        action={
          <Button variant="safe" onPress={() => setCreating(true)}>
            New policy
          </Button>
        }
      />

      <Table striped>
        <thead>
          <tr>
            <th>Policy</th>
            <th>Max idle time</th>
            <th>Used by</th>
          </tr>
        </thead>
        <tbody>
          {sessionPolicies.length === 0 && (
            <tr>
              <td colSpan={3} style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>
                No session policies yet.
              </td>
            </tr>
          )}
          {sessionPolicies.map((policy) => {
            const users = roles.filter((role) => role.sessionPolicyId === policy.id)
            return (
              <tr key={policy.id}>
                <td style={{ fontWeight: 'var(--font-weight-medium)' }}>{policy.name}</td>
                <td>{formatDuration(policy.attributes.maxIdleSeconds)}</td>
                <td>
                  {users.length === 0 ? (
                    EMPTY_CELL
                  ) : (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {users.map((role) => (
                        <Badge key={role.id} variant="info">
                          {role.name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>

      {creating && <CreateSessionPolicyModal onClose={() => setCreating(false)} onCreated={reload} />}
    </div>
  )
}

export function RolesTab() {
  const [roles, setRoles] = useState<Role[] | null>(null)
  const [permissions, setPermissions] = useState<Permission[] | null>(null)
  const [permissionCounts, setPermissionCounts] = useState<Record<string, number>>({})
  const [sessionPolicies, setSessionPolicies] = useState<SessionPolicy[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [roleList, permissionList, policyList] = await Promise.all([
        getTrpc<Role[]>('rbac.roles.list', undefined),
        getTrpc<Permission[]>('rbac.roles.listPermissions', undefined),
        getTrpc<SessionPolicy[]>('rbac.sessionPolicies.list', undefined),
      ])
      // One getPermissions per non-system role — rbac.roles.list doesn't
      // carry the permission set, and the roles list is small.
      const counts = await Promise.all(
        roleList
          .filter((role) => !role.isSystem)
          .map(async (role) => [role.id, (await getTrpc<string[]>('rbac.roles.getPermissions', { roleId: role.id })).length] as const),
      )
      setRoles(roleList)
      setPermissions(permissionList)
      setSessionPolicies(policyList)
      setPermissionCounts(Object.fromEntries(counts))
      setError(null)
    } catch {
      setError('Failed to load roles.')
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const loaded = roles !== null && permissions !== null && sessionPolicies !== null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && <Alert variant="urgent">{error}</Alert>}
      <Tabs defaultSelectedKey="roles">
        <TabList aria-label="Roles and permissions">
          <Tab id="roles">Roles</Tab>
          <Tab id="policies">Session policies</Tab>
        </TabList>
        <TabPanel id="roles">
          {loaded ? (
            <RolesPanel
              roles={roles}
              permissionCounts={permissionCounts}
              allPermissions={permissions}
              sessionPolicies={sessionPolicies}
              reload={reload}
            />
          ) : (
            <TableSkeleton columns={5} />
          )}
        </TabPanel>
        <TabPanel id="policies">
          {loaded ? <SessionPoliciesPanel roles={roles} sessionPolicies={sessionPolicies} reload={reload} /> : <TableSkeleton columns={3} />}
        </TabPanel>
      </Tabs>
    </div>
  )
}
