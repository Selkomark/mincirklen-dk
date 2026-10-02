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
import { searchPermissionGroups, searchRoles } from './roleSearch'
import './RolesTab.css'

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

// Role ceiling (sessionToken.ts's ROLE_MAX_IDLE_SECONDS, 2 weeks) — a
// role with no attached policy falls back to this, and no policy may
// store more. The 180-day platform default is for members holding no
// role at all; it never applies to anyone who can reach /manage. The
// empty id is the sentinel "no policy" option; the server owns the real
// value and enforces it regardless of what's sent from here.
const PLATFORM_DEFAULT_ID = ''
const MAX_IDLE_SECONDS = 60 * 60 * 24 * 14
const PLATFORM_DEFAULT_LABEL = 'Default (2 weeks)'

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

// Seeded policies (migrations/0002) are named by their duration, so
// "13 days (13 days)" would be noise — show the name alone then.
function policyLabel(policy: SessionPolicy): string {
  const duration = formatDuration(policy.attributes.maxIdleSeconds)
  return policy.name === duration ? policy.name : `${policy.name} (${duration})`
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
  const [query, setQuery] = useState('')
  const groups = searchPermissionGroups(groupByPrefix(allPermissions), query)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)' }}>Permissions</div>
      {/* Full-width search directly under the section label; the field's
          own label is for screen readers only — "Permissions" above it
          already says what it searches. */}
      <TextField
        label="Search permissions"
        className="roles-permission-search"
        placeholder="Search permissions, e.g. edit users, timeout…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {groups.length === 0 ? (
        <Text variant="muted" style={{ margin: 0 }}>
          No permissions match “{query.trim()}”.
        </Text>
      ) : (
        <div className="roles-permission-grid">
          {groups.map(({ prefix, categoryMatched, permissions }) => (
            <div key={prefix}>
              <div className={['roles-permission-group', categoryMatched && 'roles-permission-group--matched'].filter(Boolean).join(' ')}>
                {prefix}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                {permissions.map(({ permission, matched }) => (
                  <div
                    key={permission.id}
                    className={['roles-permission-item', matched && 'roles-permission-item--matched'].filter(Boolean).join(' ')}
                  >
                    <Checkbox
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
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
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
          {policyLabel(policy)}
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
  const [name, setName] = useState(role.name)
  const [description, setDescription] = useState(role.description ?? '')
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

  const trimmedName = name.trim()
  const trimmedDescription = description.trim()
  const detailsChanged = trimmedName !== role.name || trimmedDescription !== (role.description ?? '')

  // Mirrors the schema's name minimum (2 chars) so the button isn't
  // enabled for input the server will reject.
  const nameValid = trimmedName.length >= 2

  const save = async () => {
    if (!nameValid) return
    setSaving(true)
    setError(null)
    try {
      // The session policy is editable on every role, including system
      // ones — an admin role is exactly the kind of role idle policies
      // exist to rate-limit. Name, description and permissions stay
      // locked for system roles (rbacService.ts rejects them).
      if (!role.isSystem && detailsChanged) {
        // createRoleInputSchema/updateRoleInputSchema take description as
        // optional, not nullable — omit it (undefined drops out of the
        // JSON) to clear; the router stores null.
        await postTrpc('rbac.roles.update', { roleId: role.id, name: trimmedName, description: trimmedDescription || undefined })
      }
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
    <Modal isOpen onOpenChange={(open) => !open && onClose()} title={role.name} className="roles-edit-modal">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {error && <Alert variant="urgent">{error}</Alert>}

        {role.isSystem ? (
          role.description && (
            <Text variant="muted" style={{ margin: 0 }}>
              {role.description}
            </Text>
          )
        ) : (
          <div className="roles-field-row">
            <TextField label="Role name" value={name} onChange={(e) => setName(e.target.value)} />
            <TextField
              label="Description"
              placeholder="What this role is for"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        )}

        {/* Same two-column row with one cell filled, so the select takes
            exactly the width of the name field above it. */}
        <div className="roles-field-row">
          <SessionPolicySelect value={policyId} onChange={setPolicyId} sessionPolicies={sessionPolicies} isDisabled={saving} />
        </div>

        <div>
          {role.isSystem ? (
            <>
              <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
                Permissions
              </div>
              <Alert variant="info">System role — holds every permission and cannot be edited.</Alert>
            </>
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
          <Button variant="safe" isPending={saving} isDisabled={!nameValid} onPress={() => void save()}>
            Save
          </Button>
        </ModalActions>
      </div>
    </Modal>
  )
}

function CreateRoleModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nameValid = name.trim().length >= 2

  const create = async () => {
    if (!nameValid) return
    setCreating(true)
    setError(null)
    try {
      await postTrpc('rbac.roles.create', { name: name.trim(), description: description.trim() || undefined })
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
        <TextField
          label="Description"
          placeholder="What this role is for (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <ModalActions>
          <Button variant="ghost" onPress={onClose} isDisabled={creating}>
            Cancel
          </Button>
          <Button type="submit" variant="safe" isPending={creating} isDisabled={!nameValid}>
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
  const maxIdleSeconds = Math.round(parsedValue * SECONDS_PER_UNIT[unit])
  const exceedsCap = Number.isFinite(parsedValue) && maxIdleSeconds > MAX_IDLE_SECONDS
  const isValid = name.trim().length > 0 && Number.isFinite(parsedValue) && parsedValue > 0 && !exceedsCap

  const create = async () => {
    if (!isValid) return
    setCreating(true)
    setError(null)
    try {
      await postTrpc('rbac.sessionPolicies.create', { name: name.trim(), attributes: { maxIdleSeconds } })
      await onCreated()
      onClose()
    } catch {
      setError('Failed to create session policy — name may already be taken, or the duration is out of range (1 minute to 2 weeks).')
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
          A named idle-timeout template you can attach to roles, from 1 minute to 2 weeks. A user holding several roles is
          bound by whichever attached policy is shortest.
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
              hint={exceedsCap ? 'Must be 2 weeks or less' : undefined}
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
  rolePermissionIds,
  allPermissions,
  sessionPolicies,
  reload,
}: {
  roles: Role[]
  rolePermissionIds: Record<string, string[]>
  allPermissions: Permission[]
  sessionPolicies: SessionPolicy[]
  reload: () => Promise<void>
}) {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Role | null>(null)
  const [query, setQuery] = useState('')
  const policyById = new Map(sessionPolicies.map((policy) => [policy.id, policy]))
  const permissionById = new Map(allPermissions.map((permission) => [permission.id, permission]))

  // What the search sees for each role — see roleSearch.ts. A system
  // role holds every permission, so it's searchable by all of them.
  const searchable = roles.map((role) => ({
    ...role,
    sessionPolicyName: role.sessionPolicyId ? (policyById.get(role.sessionPolicyId)?.name ?? null) : null,
    permissions: role.isSystem
      ? allPermissions
      : (rolePermissionIds[role.id] ?? []).map((id) => permissionById.get(id)).filter((p): p is Permission => p !== undefined),
  }))
  const visibleRoles = searchRoles(searchable, query)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Text variant="muted" style={{ margin: 0 }}>
        Roles bundle permissions. Assign them to users from the Users page.
      </Text>

      {/* alignItems: flex-end lines the button up with the input, not
          with the field's label above it. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px', maxWidth: 420 }}>
          <TextField
            label="Search roles"
            placeholder="Name, what it can do, or a policy…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button variant="safe" onPress={() => setCreating(true)}>
          New role
        </Button>
      </div>

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
          {visibleRoles.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>
                No roles match “{query.trim()}”.
              </td>
            </tr>
          )}
          {visibleRoles.map((role) => {
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
                <td>{role.isSystem ? 'All' : role.permissions.length}</td>
                <td>
                  {policy ? (
                    policyLabel(policy)
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
        description="Idle-timeout templates attached to roles, 2 weeks at most. A role without one gets the full 2 weeks."
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
  const [rolePermissionIds, setRolePermissionIds] = useState<Record<string, string[]>>({})
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
      // carry the permission set, and the roles list is small. Feeds
      // both the Permissions column and the search (roleSearch.ts).
      const permissionIds = await Promise.all(
        roleList
          .filter((role) => !role.isSystem)
          .map(async (role) => [role.id, await getTrpc<string[]>('rbac.roles.getPermissions', { roleId: role.id })] as const),
      )
      setRoles(roleList)
      setPermissions(permissionList)
      setSessionPolicies([...policyList].sort((a, b) => (a.attributes.maxIdleSeconds ?? 0) - (b.attributes.maxIdleSeconds ?? 0)))
      setRolePermissionIds(Object.fromEntries(permissionIds))
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
              rolePermissionIds={rolePermissionIds}
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
