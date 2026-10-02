import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDate, Time } from '@internationalized/date'
import { Button } from '../../components/Button'
import { CopyText } from '../../components/CopyText'
import { Badge } from '../../components/Badge'
import { Alert } from '../../components/Alert'
import { Table } from '../../components/Table'
import { Switch } from '../../components/Switch'
import { DatePicker } from '../../components/DatePicker'
import { TimePicker } from '../../components/TimePicker'
import { Modal } from '../../components/Modal'
import { Tab, TabList, TabPanel, Tabs } from '../../components/Tabs'
import { Text } from '../../components/Text'
import { getTrpc, postTrpc } from './manageShared'
import './GatesTab.css'

type SignupStatus = 'pending' | 'granted' | 'revoked' | 'rejected'
const SIGNUP_STATUSES: SignupStatus[] = ['pending', 'granted', 'revoked', 'rejected']

// One row per packages/shared/src/gates/registry.ts entry — this tab
// never lets an admin type in a key, it only ever lists what code
// defines (gates.list, gatesRouter.ts::listGatesWithStats).
interface GateStat {
  key: string
  name: string
  description: string
  mode: 'open' | 'invite_only'
  scheduledOpenAt: string | null
  open: boolean
  pendingCount: number
  grantedCount: number
  revokedCount: number
  rejectedCount: number
}

interface GateSignup {
  id: string
  gateKey: string
  email: string
  status: SignupStatus
  createdAt: string
  grantedAt: string | null
  grantedBy: string | null
}

// See .agents/skills/admin-ui-components/SKILL.md's DatePicker/TimePicker
// gotcha — both take @internationalized/date values, not a plain Date or
// ISO string. Same combine direction as pages/start/StartNewPage.tsx's
// combineToISOString; this is the reverse, for seeding form state from an
// existing scheduledOpenAt.
function splitFromISOString(iso: string): { date: CalendarDate; time: Time } {
  const d = new Date(iso)
  return {
    date: new CalendarDate(d.getFullYear(), d.getMonth() + 1, d.getDate()),
    time: new Time(d.getHours(), d.getMinutes()),
  }
}

function combineToISOString(date: CalendarDate, time: Time): string {
  return new Date(date.year, date.month - 1, date.day, time.hour, time.minute).toISOString()
}

// Re-invokes gates.grantSignup for a signup that's already granted — the
// service layer treats granting as idempotent (markGranted always
// updates granted_at/granted_by and mints a fresh token regardless of
// current status), so this is a legitimate way to get a working invite
// link back for someone whose original link scrolled out of view or was
// lost to a page refresh, not a workaround. Every mint stays valid
// independently — this never invalidates an earlier link the person
// might already have.
function CopyInviteLinkButton({ signupId, variant = 'ghost' }: { signupId: string; variant?: 'ghost' | 'safe' }) {
  const { t } = useTranslation('console')
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')

  async function copy() {
    setState('copying')
    try {
      const result = await postTrpc<{ inviteUrl: string }>('gates.grantSignup', { signupId })
      await navigator.clipboard.writeText(result.inviteUrl)
      setState('copied')
      setTimeout(() => setState('idle'), 2000)
    } catch {
      setState('error')
    }
  }

  return (
    <Button variant={state === 'error' ? 'urgent' : variant} isPending={state === 'copying'} onPress={() => void copy()}>
      {state === 'copied' ? t('gates.signups.copied') : state === 'error' ? t('gates.signups.copyFailed') : t('gates.signups.copyLink')}
    </Button>
  )
}

// Only ever reachable for a 'granted' row (SignupsPanel below), which
// gates.revokeSignup's own repository query re-checks server-side too —
// see markRevoked's comment (gateSignupRepository.ts). Revoking flips
// status back so their existing invite link stops verifying
// (redeemGateInvite only accepts an exactly-'granted' row) and the row
// reverts to a re-grantable "Grant access" state, same as a never-
// granted signup — but it does NOT end a session for someone who
// already redeemed their link before this click; see gatesRouter.ts's
// revokeSignup comment for why that's a real limit, not an oversight.
function RevokeAccessButton({ email, signupId, onRevoked }: { email: string; signupId: string; onRevoked: () => void }) {
  const { t } = useTranslation('console')
  const [isOpen, setIsOpen] = useState(false)
  const [isRevoking, setIsRevoking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function revoke(close: () => void) {
    setIsRevoking(true)
    setError(null)
    try {
      await postTrpc('gates.revokeSignup', { signupId })
      setIsRevoking(false)
      close()
      onRevoked()
    } catch {
      setError(t('gates.signups.revokeFailed'))
      setIsRevoking(false)
    }
  }

  return (
    <>
      <Button variant="urgent" onPress={() => setIsOpen(true)}>
        {t('gates.signups.revoke')}
      </Button>
      <Modal isOpen={isOpen} onOpenChange={setIsOpen} title={t('gates.signups.revokeTitle')}>
        {(close) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <Alert variant="urgent">{t('gates.signups.revokeBody', { email })}</Alert>
            {error && <Alert variant="urgent">{error}</Alert>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button variant="secondary" onPress={close}>
                {t('common.cancel')}
              </Button>
              <Button variant="urgent" isPending={isRevoking} onPress={() => void revoke(close)}>
                {t('gates.signups.revokeConfirm')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

// One status at a time — the tab decides which. Pending rows can be
// granted (an invite email goes out, the link is also copied here as a
// fallback) or rejected (nothing goes out); granted rows can have their
// link re-copied or be revoked; revoked and rejected rows can be granted
// again if the decision changes.
function SignupsList({ gateKey, status, canManage, onChanged }: { gateKey: string; status: SignupStatus; canManage: boolean; onChanged: () => void }) {
  const { t, i18n } = useTranslation('console')
  const [signups, setSignups] = useState<GateSignup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [copiedForEmail, setCopiedForEmail] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const page = await getTrpc<{ signups: GateSignup[] }>('gates.listSignups', { gateKey, status, limit: 50 })
      setSignups(page.signups)
    } catch {
      setError(t('gates.signups.loadFailed'))
    }
  }, [gateKey, status, t])

  useEffect(() => {
    void load()
  }, [load])

  async function grant(id: string, email: string) {
    setBusyId(id)
    setError(null)
    setCopiedForEmail(null)
    try {
      const result = await postTrpc<{ inviteUrl: string }>('gates.grantSignup', { signupId: id })
      try {
        await navigator.clipboard.writeText(result.inviteUrl)
        setCopiedForEmail(email)
        setTimeout(() => setCopiedForEmail(null), 4000)
      } catch {
        // Clipboard can be refused; the invite email already went out and
        // the granted row's Copy button is a second chance.
      }
      await load()
      onChanged()
    } catch {
      setError(t('gates.signups.grantFailed'))
    } finally {
      setBusyId(null)
    }
  }

  async function reject(id: string) {
    setBusyId(id)
    setError(null)
    try {
      await postTrpc('gates.rejectSignup', { signupId: id })
      await load()
      onChanged()
    } catch {
      setError(t('gates.signups.rejectFailed'))
    } finally {
      setBusyId(null)
    }
  }

  async function handleRevoked() {
    await load()
    onChanged()
  }

  if (signups === null) {
    return <div style={{ color: 'var(--text-secondary)' }}>{t('common.loading')}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {error && <Alert variant="urgent">{error}</Alert>}
      {copiedForEmail && <Alert variant="safe">{t('gates.signups.grantedNotice', { email: copiedForEmail })}</Alert>}
      {signups.length === 0 ? (
        <Text variant="muted" style={{ margin: 0 }}>
          {t(`gates.signups.emptyByStatus.${status}`)}
        </Text>
      ) : (
        <Table striped>
          <thead>
            <tr>
              <th>{t('gates.signups.columns.email')}</th>
              <th>{t('gates.signups.columns.signedUp')}</th>
              {canManage && <th></th>}
            </tr>
          </thead>
          <tbody>
            {signups.map((signup) => (
              <tr key={signup.id}>
                <td>
                  <CopyText copyLabel={t('users.copy')} copiedLabel={t('users.copied')}>
                    {signup.email}
                  </CopyText>
                </td>
                <td>
                  <CopyText copyLabel={t('users.copy')} copiedLabel={t('users.copied')}>
                    {new Date(signup.createdAt).toLocaleString(i18n.language)}
                  </CopyText>
                </td>
                {canManage && (
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {signup.status === 'granted' ? (
                        <>
                          <CopyInviteLinkButton signupId={signup.id} />
                          <RevokeAccessButton signupId={signup.id} email={signup.email} onRevoked={() => void handleRevoked()} />
                        </>
                      ) : (
                        <>
                          <Button variant="safe" isPending={busyId === signup.id} isDisabled={busyId !== null && busyId !== signup.id} onPress={() => void grant(signup.id, signup.email)}>
                            {t('gates.signups.grantAccess')}
                          </Button>
                          {signup.status === 'pending' && (
                            <Button variant="secondary" isPending={busyId === signup.id} isDisabled={busyId !== null && busyId !== signup.id} onPress={() => void reject(signup.id)}>
                              {t('gates.signups.reject')}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}

// Everything about one gate that isn't the row itself: the auto-open
// schedule (managers only) and the signups, by status. Counts in the tab
// labels come from the gate's stats so a manager can see where the work
// is before opening a tab.
function GateManageModal({ gate, canManage, onClose, onUpdated }: { gate: GateStat; canManage: boolean; onClose: () => void; onUpdated: () => void }) {
  const { t } = useTranslation('console')
  const [saving, setSaving] = useState(false)
  const seeded = gate.scheduledOpenAt ? splitFromISOString(gate.scheduledOpenAt) : null
  const [scheduleEnabled, setScheduleEnabled] = useState(gate.scheduledOpenAt !== null)
  const [scheduleDate, setScheduleDate] = useState<CalendarDate | null>(seeded?.date ?? null)
  const [scheduleTime, setScheduleTime] = useState<Time | null>(seeded?.time ?? null)
  const [error, setError] = useState<string | null>(null)

  async function saveSchedule(scheduledOpenAt: string | null) {
    setSaving(true)
    setError(null)
    try {
      await postTrpc('gates.update', { gateKey: gate.key, mode: gate.mode, scheduledOpenAt })
      onUpdated()
    } catch {
      setError(t('gates.scheduleUpdateFailed'))
    } finally {
      setSaving(false)
    }
  }

  // Off means no schedule, full stop — clear the fields to the same
  // empty state gates.update's scheduledOpenAt: null accepts, and save
  // that immediately rather than leaving a stale schedule active in the
  // backend until Save is clicked again with the fields already blanked.
  function toggleSchedule(enabled: boolean) {
    setScheduleEnabled(enabled)
    if (!enabled) {
      setScheduleDate(null)
      setScheduleTime(null)
      void saveSchedule(null)
    }
  }

  const counts: Record<SignupStatus, number> = {
    pending: gate.pendingCount,
    granted: gate.grantedCount,
    revoked: gate.revokedCount,
    rejected: gate.rejectedCount,
  }

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} title={gate.name} className="gates-manage-modal">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <Text variant="muted" style={{ margin: 0 }}>
          {gate.description}
        </Text>
        {error && <Alert variant="urgent">{error}</Alert>}

        {canManage && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Switch isSelected={scheduleEnabled} isDisabled={saving} onChange={toggleSchedule}>
              {t('gates.autoOpen')}
            </Switch>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
              <DatePicker aria-label={t('gates.autoOpenDate')} value={scheduleDate} onChange={setScheduleDate} isDisabled={!scheduleEnabled} style={{ flex: '1 1 200px' }} />
              <TimePicker aria-label={t('gates.autoOpenTime')} value={scheduleTime} onChange={setScheduleTime} isDisabled={!scheduleEnabled} style={{ flex: '1 1 160px' }} />
              <Button
                variant="secondary"
                isPending={saving}
                isDisabled={!scheduleEnabled || !scheduleDate || !scheduleTime}
                onPress={() => scheduleDate && scheduleTime && void saveSchedule(combineToISOString(scheduleDate, scheduleTime))}
              >
                {t('gates.saveSchedule')}
              </Button>
            </div>
          </div>
        )}

        <Tabs defaultSelectedKey="pending">
          <TabList aria-label={t('gates.signups.tabsLabel')}>
            {SIGNUP_STATUSES.map((status) => (
              <Tab key={status} id={status}>
                {t(`gates.signups.tabs.${status}`)} · {counts[status]}
              </Tab>
            ))}
          </TabList>
          {SIGNUP_STATUSES.map((status) => (
            <TabPanel key={status} id={status}>
              <SignupsList gateKey={gate.key} status={status} canManage={canManage} onChanged={onUpdated} />
            </TabPanel>
          ))}
        </Tabs>
      </div>
    </Modal>
  )
}

function GateRow({ gate, canManage, onUpdated }: { gate: GateStat; canManage: boolean; onUpdated: () => void }) {
  const { t } = useTranslation('console')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function setMode(mode: 'open' | 'invite_only') {
    setSaving(true)
    setError(null)
    try {
      await postTrpc('gates.update', { gateKey: gate.key, mode, scheduledOpenAt: gate.scheduledOpenAt })
      onUpdated()
    } catch {
      setError(t('gates.updateFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <tr>
        <td>
          <div style={{ fontWeight: 'var(--font-weight-medium)' }}>{gate.name}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>{gate.description}</div>
          <div style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>{gate.key}</div>
        </td>
        <td>{gate.open ? <Badge variant="safe">{t('gates.open')}</Badge> : <Badge variant="urgent">{t('gates.inviteOnly')}</Badge>}</td>
        <td>{gate.pendingCount}</td>
        <td>{gate.grantedCount}</td>
        <td>{gate.revokedCount}</td>
        <td>{gate.rejectedCount}</td>
        <td>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Switch isSelected={gate.mode === 'open'} isDisabled={saving || !canManage} onChange={(isSelected) => void setMode(isSelected ? 'open' : 'invite_only')}>
              {gate.mode === 'open' ? t('gates.openToEveryone') : t('gates.inviteOnly')}
            </Switch>
            <Button variant="ghost" onPress={() => setOpen(true)}>
              {t('gates.manageSignups')}
            </Button>
          </div>
          {error && (
            <div style={{ marginTop: 'var(--space-2)' }}>
              <Alert variant="urgent">{error}</Alert>
            </div>
          )}
        </td>
      </tr>
      {open && <GateManageModal gate={gate} canManage={canManage} onClose={() => setOpen(false)} onUpdated={onUpdated} />}
    </>
  )
}

export function GatesTab({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation('console')
  const [gates, setGates] = useState<GateStat[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setGates(await getTrpc<GateStat[]>('gates.list', undefined))
    } catch {
      setError(t('gates.loadFailed'))
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  if (gates === null) {
    return <div style={{ color: 'var(--text-secondary)' }}>{t('common.loading')}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && <Alert variant="urgent">{error}</Alert>}
      <div style={{ overflowX: 'auto' }}>
        <Table striped>
          <thead>
            <tr>
              <th>{t('gates.columns.gate')}</th>
              <th>{t('gates.columns.status')}</th>
              <th>{t('gates.columns.pending')}</th>
              <th>{t('gates.columns.granted')}</th>
              <th>{t('gates.columns.revoked')}</th>
              <th>{t('gates.columns.rejected')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {gates.map((gate) => (
              <GateRow key={gate.key} gate={gate} canManage={canManage} onUpdated={() => void load()} />
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  )
}
