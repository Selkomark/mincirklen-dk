import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { Checkbox } from '../../components/Checkbox'
import { Alert } from '../../components/Alert'
import { Table } from '../../components/Table'
import { getTrpc, postTrpc } from './manageShared'

interface UserWithRoles {
  id: string
  createdAt: string
  bannedAt: string | null
  // Decrypted and masked server-side (rbacRepository.ts::maskEmail) — the
  // unmasked address is never sent to the browser. Null means the row
  // never got an email set — see UserWithRoles's comment in
  // rbacRepository.ts for why that's a legacy/failure case, not a normal
  // signed-up user, now that Google sign-in is the only way in.
  emailMasked: string | null
  roles: { id: string; name: string }[]
}

interface Role {
  id: string
  name: string
}

function EditRolesRow({ user, allRoles, onSaved }: { user: UserWithRoles; allRoles: Role[]; onSaved: () => void }) {
  const { t } = useTranslation('console')
  const [editing, setEditing] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(user.roles.map((r) => r.id)))
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await postTrpc('rbac.users.updateRoles', { userId: user.id, roleIds: [...selectedIds] })
      setEditing(false)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <tr>
        <td style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-xs)' }}>{user.id}</td>
        <td>{user.emailMasked ?? <span style={{ color: 'var(--text-secondary)' }}>—</span>}</td>
        <td>
          {user.roles.length === 0 ? (
            <span style={{ color: 'var(--text-secondary)' }}>—</span>
          ) : (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {user.roles.map((role) => (
                <Badge key={role.id} variant="info">
                  {role.name}
                </Badge>
              ))}
            </div>
          )}
        </td>
        <td>{user.bannedAt ? <Badge variant="urgent">{t('users.banned')}</Badge> : null}</td>
        <td>
          <Button variant="ghost" onPress={() => setEditing(true)}>
            {t('users.editRoles')}
          </Button>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-xs)' }}>{user.id}</td>
      <td>{user.emailMasked ?? <span style={{ color: 'var(--text-secondary)' }}>—</span>}</td>
      <td colSpan={2}>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          {allRoles.map((role) => (
            <Checkbox
              key={role.id}
              isSelected={selectedIds.has(role.id)}
              onChange={(isSelected) => {
                const next = new Set(selectedIds)
                if (isSelected) next.add(role.id)
                else next.delete(role.id)
                setSelectedIds(next)
              }}
            >
              {role.name}
            </Checkbox>
          ))}
        </div>
      </td>
      <td>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button variant="safe" isPending={saving} onPress={() => void save()}>
            {t('common.save')}
          </Button>
          <Button variant="ghost" onPress={() => setEditing(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </td>
    </tr>
  )
}

export function UsersTab() {
  const { t } = useTranslation('console')
  const [users, setUsers] = useState<UserWithRoles[] | null>(null)
  const [roles, setRoles] = useState<Role[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (afterCursor?: string) => {
      try {
        const page = await getTrpc<{ users: UserWithRoles[]; nextCursor: string | null }>('rbac.users.list', {
          cursor: afterCursor,
          limit: 20,
        })
        setUsers((prev) => (afterCursor ? [...(prev ?? []), ...page.users] : page.users))
        setCursor(page.nextCursor)
      } catch {
        setError(t('users.loadFailed'))
      }
    },
    [t],
  )

  useEffect(() => {
    void load()
    void getTrpc<Role[]>('rbac.roles.list', undefined).then(setRoles)
  }, [load])

  if (users === null || roles === null) {
    return <div style={{ color: 'var(--text-secondary)' }}>{t('common.loading')}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && <Alert variant="urgent">{error}</Alert>}

      <div style={{ overflowX: 'auto' }}>
        <Table striped>
          <thead>
            <tr>
              <th>{t('users.columns.user')}</th>
              <th>{t('users.columns.email')}</th>
              <th>{t('users.columns.roles')}</th>
              <th>{t('users.columns.status')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <EditRolesRow key={user.id} user={user} allRoles={roles} onSaved={() => void load()} />
            ))}
          </tbody>
        </Table>
      </div>

      {cursor && (
        <Button variant="ghost" onPress={() => void load(cursor)}>
          {t('common.loadMore')}
        </Button>
      )}
    </div>
  )
}
