import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { Checkbox } from '../../components/Checkbox'
import { CopyText } from '../../components/CopyText'
import { Alert } from '../../components/Alert'
import { Modal } from '../../components/Modal'
import { Skeleton } from '../../components/Skeleton'
import { Table } from '../../components/Table'
import { Text } from '../../components/Text'
import { Textarea } from '../../components/Textarea'
import { getTrpc, postTrpc } from './manageShared'
import { ReportByIdModal } from './ReportsTab'

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
  // Full address — present only when this admin's role holds
  // users.read_pii (rbacRouter.ts); null otherwise.
  email: string | null
  roles: { id: string; name: string }[]
}

// Id and address are things an admin copies into a search, a ticket, a
// query — so each is a CopyText. The address copies whatever is shown:
// the full one when the role may see it, the mask otherwise.
function UserCell({ user }: { user: UserWithRoles }) {
  const { t } = useTranslation('console')
  return (
    <CopyText copyLabel={t('users.copy')} copiedLabel={t('users.copied')} style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-xs)' }}>
      {user.id}
    </CopyText>
  )
}

function EmailCell({ user }: { user: UserWithRoles }) {
  const { t } = useTranslation('console')
  const shown = user.email ?? user.emailMasked
  if (!shown) return <span style={{ color: 'var(--text-secondary)' }}>—</span>
  return (
    <CopyText copyLabel={t('users.copy')} copiedLabel={t('users.copied')}>
      {shown}
    </CopyText>
  )
}

interface Role {
  id: string
  name: string
}

interface MemberNote {
  id: string
  reportId: string | null
  body: string
  createdBy: string | null
  createdByLabel: string | null
  createdAt: string
}

// Moderator-only history on a member — written by hand here or by a
// session report's "note" action. Never shown to the member.
function NotesModal({ userId, canAddNote, onClose }: { userId: string; canAddNote: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation('console')
  const [notes, setNotes] = useState<MemberNote[] | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openReportId, setOpenReportId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setNotes(await getTrpc<MemberNote[]>('rbac.users.listNotes', { userId }))
    } catch {
      setError(t('users.notes.loadFailed'))
    }
  }, [userId, t])

  useEffect(() => {
    void load()
  }, [load])

  const add = async () => {
    if (!draft.trim()) return
    setSaving(true)
    setError(null)
    try {
      await postTrpc('rbac.users.addNote', { userId, body: draft.trim() })
      setDraft('')
      await load()
    } catch {
      setError(t('users.notes.addFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} title={t('users.notes.title')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <Text variant="muted" style={{ margin: 0 }}>
          {t('users.notes.intro')}
        </Text>
        {error && <Alert variant="urgent">{error}</Alert>}
        {notes === null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <Skeleton width="70%" height={14} />
            <Skeleton width="50%" height={14} />
          </div>
        ) : notes.length === 0 ? (
          <Text variant="muted" style={{ margin: 0 }}>
            {t('users.notes.empty')}
          </Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxHeight: '40vh', overflowY: 'auto' }}>
            {notes.map((note) => (
              <div key={note.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span>{new Date(note.createdAt).toLocaleString(i18n.language)}</span>
                  {note.createdByLabel && <span>{t('users.notes.by', { who: note.createdByLabel })}</span>}
                  {note.reportId && (
                    <Button variant="ghost" onPress={() => setOpenReportId(note.reportId)}>
                      {t('users.notes.viewReport')}
                    </Button>
                  )}
                </span>
                <span style={{ fontSize: 'var(--font-size-sm)', whiteSpace: 'pre-wrap' }}>{note.body}</span>
              </div>
            ))}
          </div>
        )}
        {openReportId && <ReportByIdModal reportId={openReportId} canBan={false} onClose={() => setOpenReportId(null)} />}
        {canAddNote && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void add()
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
          >
            <Textarea label={t('users.notes.addLabel')} value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              <Button variant="ghost" onPress={onClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="safe" isPending={saving} isDisabled={!draft.trim()}>
                {t('users.notes.add')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  )
}

function EditRolesRow({
  user,
  allRoles,
  canEditRoles,
  canAddNote,
  onSaved,
}: {
  user: UserWithRoles
  allRoles: Role[]
  canEditRoles: boolean
  canAddNote: boolean
  onSaved: () => void
}) {
  const { t } = useTranslation('console')
  const [editing, setEditing] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
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
        <td>
          <UserCell user={user} />
        </td>
        <td>
          <EmailCell user={user} />
        </td>
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
          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onPress={() => setNotesOpen(true)}>
              {t('users.notes.open')}
            </Button>
            {canEditRoles && (
              <Button variant="ghost" onPress={() => setEditing(true)}>
                {t('users.editRoles')}
              </Button>
            )}
          </div>
          {notesOpen && <NotesModal userId={user.id} canAddNote={canAddNote} onClose={() => setNotesOpen(false)} />}
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td>
        <UserCell user={user} />
      </td>
      <td>
        <EmailCell user={user} />
      </td>
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

export function UsersTab({ canEditRoles, canAddNote }: { canEditRoles: boolean; canAddNote: boolean }) {
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
              <EditRolesRow key={user.id} user={user} allRoles={roles} canEditRoles={canEditRoles} canAddNote={canAddNote} onSaved={() => void load()} />
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
