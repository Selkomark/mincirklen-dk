import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDate, Time } from '@internationalized/date'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { Alert } from '../../components/Alert'
import { Table } from '../../components/Table'
import { Switch } from '../../components/Switch'
import { DatePicker } from '../../components/DatePicker'
import { TimePicker } from '../../components/TimePicker'
import { Modal } from '../../components/Modal'
import { getTrpc, postTrpc } from './manageShared'

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
}

interface GateSignup {
  id: string
  gateKey: string
  email: string
  status: 'pending' | 'granted' | 'revoked'
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

function SignupsPanel({ gateKey, onChanged }: { gateKey: string; onChanged: () => void }) {
  const { t, i18n } = useTranslation('console')
  const [signups, setSignups] = useState<GateSignup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [grantingId, setGrantingId] = useState<string | null>(null)
  const [copiedForEmail, setCopiedForEmail] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const page = await getTrpc<{ signups: GateSignup[] }>('gates.listSignups', { gateKey, limit: 50 })
      setSignups(page.signups)
    } catch {
      setError(t('gates.signups.loadFailed'))
    }
  }, [gateKey, t])

  useEffect(() => {
    void load()
  }, [load])

  // The granted row's own Copy invite link button (CopyInviteLinkButton
  // above) still works anytime afterward — this is just the common case
  // (grant, then immediately go paste the link somewhere) needing one
  // fewer click, not a replacement for it.
  async function grant(id: string, email: string) {
    setGrantingId(id)
    setError(null)
    setCopiedForEmail(null)
    try {
      const result = await postTrpc<{ inviteUrl: string }>('gates.grantSignup', { signupId: id })
      try {
        await navigator.clipboard.writeText(result.inviteUrl)
        setCopiedForEmail(email)
        setTimeout(() => setCopiedForEmail(null), 3000)
      } catch {
        // Clipboard access can fail silently (permissions, a non-secure
        // context) — granting itself already succeeded regardless, and
        // the row's own Copy invite link button is still right there as
        // a fallback, so this is quiet rather than surfaced as an error.
      }
      await load()
      onChanged()
    } catch {
      setError(t('gates.signups.grantFailed'))
    } finally {
      setGrantingId(null)
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
      {copiedForEmail && <Alert variant="safe">{t('gates.signups.copiedFor', { email: copiedForEmail })}</Alert>}
      {signups.length === 0 ? (
        <span style={{ color: 'var(--text-secondary)' }}>{t('gates.signups.empty')}</span>
      ) : (
        <Table striped>
          <thead>
            <tr>
              <th>{t('gates.signups.columns.email')}</th>
              <th>{t('gates.signups.columns.status')}</th>
              <th>{t('gates.signups.columns.signedUp')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {signups.map((signup) => (
              <tr key={signup.id}>
                <td>{signup.email}</td>
                <td>
                  {signup.status === 'granted' ? (
                    <Badge variant="safe">{t('gates.signups.granted')}</Badge>
                  ) : signup.status === 'revoked' ? (
                    <Badge variant="urgent">{t('gates.signups.revoked')}</Badge>
                  ) : (
                    <Badge>{t('gates.signups.pending')}</Badge>
                  )}
                </td>
                <td>{new Date(signup.createdAt).toLocaleString(i18n.language)}</td>
                <td>
                  {signup.status === 'granted' ? (
                    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <CopyInviteLinkButton signupId={signup.id} />
                      <RevokeAccessButton signupId={signup.id} email={signup.email} onRevoked={() => void handleRevoked()} />
                    </div>
                  ) : (
                    <Button variant="safe" isPending={grantingId === signup.id} onPress={() => void grant(signup.id, signup.email)}>
                      {t('gates.signups.grantAccess')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}

function GateRow({ gate, onUpdated }: { gate: GateStat; onUpdated: () => void }) {
  const { t } = useTranslation('console')
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const seeded = gate.scheduledOpenAt ? splitFromISOString(gate.scheduledOpenAt) : null
  const [scheduleEnabled, setScheduleEnabled] = useState(gate.scheduledOpenAt !== null)
  const [scheduleDate, setScheduleDate] = useState<CalendarDate | null>(seeded?.date ?? null)
  const [scheduleTime, setScheduleTime] = useState<Time | null>(seeded?.time ?? null)
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
        <td>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Switch isSelected={gate.mode === 'open'} isDisabled={saving} onChange={(isSelected) => void setMode(isSelected ? 'open' : 'invite_only')}>
              {gate.mode === 'open' ? t('gates.openToEveryone') : t('gates.inviteOnly')}
            </Switch>
            <Button variant="ghost" onPress={() => setExpanded((e) => !e)}>
              {expanded ? t('gates.hideSignups') : t('gates.manageSignups')}
            </Button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-3) 0' }}>
              {error && <Alert variant="urgent">{error}</Alert>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                  <Switch isSelected={scheduleEnabled} isDisabled={saving} onChange={toggleSchedule}>
                    {t('gates.autoOpen')}
                  </Switch>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <DatePicker
                    aria-label={t('gates.autoOpenDate')}
                    value={scheduleDate}
                    onChange={setScheduleDate}
                    isDisabled={!scheduleEnabled}
                    style={{ flex: '1 1 200px' }}
                  />
                  <TimePicker
                    aria-label={t('gates.autoOpenTime')}
                    value={scheduleTime}
                    onChange={setScheduleTime}
                    isDisabled={!scheduleEnabled}
                    style={{ flex: '1 1 160px' }}
                  />
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
              <SignupsPanel gateKey={gate.key} onChanged={onUpdated} />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export function GatesTab() {
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {gates.map((gate) => (
              <GateRow key={gate.key} gate={gate} onUpdated={() => void load()} />
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  )
}
