import { useCallback, useEffect, useState } from 'react'
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
      {state === 'copied' ? 'Copied!' : state === 'error' ? 'Failed — retry' : 'Copy invite link'}
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
      setError('Failed to revoke access.')
      setIsRevoking(false)
    }
  }

  return (
    <>
      <Button variant="urgent" onPress={() => setIsOpen(true)}>
        Revoke
      </Button>
      <Modal isOpen={isOpen} onOpenChange={setIsOpen} title="Revoke access?">
        {(close) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <Alert variant="urgent">
              {email} won't be able to use their invite link anymore. You can grant them access again later if you change your mind.
            </Alert>
            {error && <Alert variant="urgent">{error}</Alert>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button variant="secondary" onPress={close}>
                Cancel
              </Button>
              <Button variant="urgent" isPending={isRevoking} onPress={() => void revoke(close)}>
                Revoke access
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

function CopyTextButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button variant="ghost" onPress={() => void copy()}>
      {copied ? 'Copied!' : 'Copy'}
    </Button>
  )
}

function SignupsPanel({ gateKey, onChanged }: { gateKey: string; onChanged: () => void }) {
  const [signups, setSignups] = useState<GateSignup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [grantingId, setGrantingId] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const page = await getTrpc<{ signups: GateSignup[] }>('gates.listSignups', { gateKey, limit: 50 })
      setSignups(page.signups)
    } catch {
      setError('Failed to load signups.')
    }
  }, [gateKey])

  useEffect(() => {
    void load()
  }, [load])

  async function grant(id: string) {
    setGrantingId(id)
    setInviteUrl(null)
    setError(null)
    try {
      const result = await postTrpc<{ inviteUrl: string }>('gates.grantSignup', { signupId: id })
      setInviteUrl(result.inviteUrl)
      await load()
      onChanged()
    } catch {
      setError('Failed to grant access.')
    } finally {
      setGrantingId(null)
    }
  }

  async function handleRevoked() {
    setInviteUrl(null)
    await load()
    onChanged()
  }

  if (signups === null) {
    return <div style={{ color: 'var(--text-secondary)' }}>Loading…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {error && <Alert variant="urgent">{error}</Alert>}
      {inviteUrl && (
        <Alert variant="safe">
          Invite link — copy and send this to them directly, there's no automated email:
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginTop: 'var(--space-2)' }}>
            <code style={{ wordBreak: 'break-all', flex: 1 }}>{inviteUrl}</code>
            <CopyTextButton text={inviteUrl} />
          </div>
        </Alert>
      )}
      {signups.length === 0 ? (
        <span style={{ color: 'var(--text-secondary)' }}>No signups yet.</span>
      ) : (
        <Table striped>
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Signed up</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {signups.map((signup) => (
              <tr key={signup.id}>
                <td>{signup.email}</td>
                <td>
                  {signup.status === 'granted' ? (
                    <Badge variant="safe">Granted</Badge>
                  ) : signup.status === 'revoked' ? (
                    <Badge variant="urgent">Revoked</Badge>
                  ) : (
                    <Badge>Pending</Badge>
                  )}
                </td>
                <td>{new Date(signup.createdAt).toLocaleString()}</td>
                <td>
                  {signup.status === 'granted' ? (
                    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <CopyInviteLinkButton signupId={signup.id} />
                      <RevokeAccessButton signupId={signup.id} email={signup.email} onRevoked={() => void handleRevoked()} />
                    </div>
                  ) : (
                    <Button variant="safe" isPending={grantingId === signup.id} onPress={() => void grant(signup.id)}>
                      Grant access
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
      setError('Failed to update.')
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
      setError('Failed to update schedule.')
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
        <td>{gate.open ? <Badge variant="safe">Open</Badge> : <Badge variant="urgent">Invite-only</Badge>}</td>
        <td>{gate.pendingCount}</td>
        <td>{gate.grantedCount}</td>
        <td>{gate.revokedCount}</td>
        <td>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Switch isSelected={gate.mode === 'open'} isDisabled={saving} onChange={(isSelected) => void setMode(isSelected ? 'open' : 'invite_only')}>
              {gate.mode === 'open' ? 'Open to everyone' : 'Invite-only'}
            </Switch>
            <Button variant="ghost" onPress={() => setExpanded((e) => !e)}>
              {expanded ? 'Hide signups' : 'Manage signups'}
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
                    Auto-open on a schedule (opens regardless of the switch above once due)
                  </Switch>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <DatePicker
                    aria-label="Auto-open date"
                    value={scheduleDate}
                    onChange={setScheduleDate}
                    isDisabled={!scheduleEnabled}
                    style={{ flex: '1 1 200px' }}
                  />
                  <TimePicker
                    aria-label="Auto-open time"
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
                    Save schedule
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
  const [gates, setGates] = useState<GateStat[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setGates(await getTrpc<GateStat[]>('gates.list', undefined))
    } catch {
      setError('Failed to load gates.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (gates === null) {
    return <div style={{ color: 'var(--text-secondary)' }}>Loading…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && <Alert variant="urgent">{error}</Alert>}
      <div style={{ overflowX: 'auto' }}>
        <Table striped>
          <thead>
            <tr>
              <th>Gate</th>
              <th>Status</th>
              <th>Pending</th>
              <th>Granted</th>
              <th>Revoked</th>
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
