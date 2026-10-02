import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert } from '../../components/Alert'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { Checkbox } from '../../components/Checkbox'
import { Modal } from '../../components/Modal'
import { Radio, RadioGroup } from '../../components/RadioGroup'
import { Select, SelectItem } from '../../components/Select'
import { Skeleton } from '../../components/Skeleton'
import { Table } from '../../components/Table'
import { Tab, TabList, TabPanel, Tabs } from '../../components/Tabs'
import { Text } from '../../components/Text'
import { Textarea } from '../../components/Textarea'
import { useScrollShiftCompensation } from '../../hooks/useScrollShiftCompensation'
import type { ChatMessage, RosterEntry } from '../sessionShared'
import { JoinEventRow, memberFor, MemberAvatar, MessageRow } from '../sessionMessages'
import { getTrpc, postTrpc } from './manageShared'
import './ReportsTab.css'

type ReportStatus = 'open' | 'reviewed' | 'dismissed'
type Decision = Exclude<ReportStatus, 'open'>
type ReportAction = 'none' | 'note' | 'warn' | 'remove_from_session' | 'hide_messages' | 'ban'
type BanReason = 'predatory_contact' | 'harassment' | 'crisis_abuse' | 'illegal_content' | 'other'

const MEMBER_TARGETED: ReadonlySet<ReportAction> = new Set(['note', 'warn', 'remove_from_session', 'ban'])
const BAN_REASONS: BanReason[] = ['predatory_contact', 'harassment', 'crisis_abuse', 'illegal_content', 'other']

export interface SessionReport {
  id: string
  sessionId: string
  sessionName: string | null
  // Null once the reporter has deleted their account — the report
  // itself survives them (migrations/0001_init.ts).
  reporterUserId: string | null
  aboutUserIds: string[]
  messageIds: string[]
  body: string
  status: ReportStatus
  createdAt: string
  reviewedAt: string | null
  reviewedBy: string | null
  // The deciding moderator as the admin UI names people: masked email.
  reviewedByLabel: string | null
  decisionNote: string | null
  action: ReportAction | null
  actionTargetUserIds: string[]
}

interface SubjectHistory {
  subjects: {
    userId: string
    notes: { id: string; body: string; createdAt: string; createdByLabel: string | null; reportId: string | null }[]
    priorReports: {
      id: string
      sessionName: string | null
      status: ReportStatus
      action: ReportAction | null
      appliedToThisMember: boolean
      createdAt: string
      body: string
      reviewedByLabel: string | null
    }[]
  }[]
}

interface TranscriptPage {
  messages: ChatMessage[]
  olderCursor: string | null
  newerCursor: string | null
  roster: RosterEntry[]
  reportedAt: string
  aboutUserIds: string[]
  // The messages the member pointed at, if any — ringed and tagged in
  // the transcript wherever they fall.
  messageIds: string[]
}

const STATUSES: ReportStatus[] = ['open', 'reviewed', 'dismissed']
const PAGE_SIZE = 20
const TRANSCRIPT_PAGE_SIZE = 30
const COLUMNS = 4
// Where the "report filed" marker lands on open: this far above the
// bottom edge of the conversation panel — enough to show one or two
// messages after the report for context, with the lead-up above.
const MARKER_BOTTOM_MARGIN_PX = 120

// The reviewer's own browser zone — there's no per-admin preference
// here the way SessionPage has usePreferences, and the circle's times
// read naturally in the reviewer's local time.
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

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

function StatusBadge({ status }: { status: ReportStatus }) {
  const { t } = useTranslation('console')
  const variant = status === 'open' ? 'urgent' : status === 'reviewed' ? 'safe' : 'neutral'
  return <Badge variant={variant}>{t(`reports.status.${status}`)}</Badge>
}

// A circle member as the circle itself labels them — "Member 3", or a
// first name if they turned anonymity off (sessionMessages.tsx's
// memberFor). The reviewer never sees an id or a decrypted identity
// here; the Users tab is where an account is acted on.
function MemberChip({ userId, roster }: { userId: string; roster: RosterEntry[] }) {
  const member = memberFor(userId, roster, null)
  return (
    <span className="reports-member-chip">
      <MemberAvatar member={member} size={20} />
      {member.label}
    </span>
  )
}

// ---- Transcript ----
//
// Windowed around the report's filing moment and paged in both
// directions — scrolling up loads older messages (with the same
// scroll-position compensation SessionPage uses so the prepend doesn't
// jump the view), scrolling down loads newer ones. No live updates: a
// reviewer reads a record, they don't watch a stream.
function useTranscript(reportId: string) {
  const { t } = useTranslation('console')
  const [page, setPage] = useState<TranscriptPage | null>(null)
  const [olderCursor, setOlderCursor] = useState<string | null>(null)
  const [newerCursor, setNewerCursor] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadingNewer, setLoadingNewer] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Bumped only when a page is prepended — the signal
  // useScrollShiftCompensation keys its scrollTop fix on.
  const [topShiftVersion, setTopShiftVersion] = useState(0)
  const busyRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const initial = await getTrpc<TranscriptPage>('sessionReports.transcript', {
          reportId,
          direction: 'around',
          limit: TRANSCRIPT_PAGE_SIZE,
        })
        if (cancelled) return
        setPage(initial)
        setOlderCursor(initial.olderCursor)
        setNewerCursor(initial.newerCursor)
      } catch {
        if (!cancelled) setError(t('reports.transcriptLoadFailed'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reportId, t])

  const loadOlder = useCallback(async () => {
    if (!olderCursor || busyRef.current) return
    busyRef.current = true
    setLoadingOlder(true)
    try {
      const older = await getTrpc<TranscriptPage>('sessionReports.transcript', {
        reportId,
        direction: 'before',
        cursor: olderCursor,
        limit: TRANSCRIPT_PAGE_SIZE,
      })
      setPage((prev) => (prev ? { ...prev, messages: [...older.messages, ...prev.messages] } : prev))
      setOlderCursor(older.olderCursor)
      setTopShiftVersion((v) => v + 1)
    } catch {
      setError(t('reports.transcriptLoadFailed'))
    } finally {
      setLoadingOlder(false)
      busyRef.current = false
    }
  }, [reportId, olderCursor, t])

  const loadNewer = useCallback(async () => {
    if (!newerCursor || busyRef.current) return
    busyRef.current = true
    setLoadingNewer(true)
    try {
      const newer = await getTrpc<TranscriptPage>('sessionReports.transcript', {
        reportId,
        direction: 'after',
        cursor: newerCursor,
        limit: TRANSCRIPT_PAGE_SIZE,
      })
      setPage((prev) => (prev ? { ...prev, messages: [...prev.messages, ...newer.messages] } : prev))
      setNewerCursor(newer.newerCursor)
    } catch {
      setError(t('reports.transcriptLoadFailed'))
    } finally {
      setLoadingNewer(false)
      busyRef.current = false
    }
  }, [reportId, newerCursor, t])

  return {
    page,
    error,
    hasOlder: olderCursor !== null,
    hasNewer: newerCursor !== null,
    loadingOlder,
    loadingNewer,
    loadOlder,
    loadNewer,
    topShiftVersion,
  }
}

function MessageSkeleton() {
  return (
    <div style={{ display: 'flex', gap: 10, maxWidth: 560 }}>
      <Skeleton width={32} height={32} radius="var(--radius-full)" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        <Skeleton width={72} height={12} />
        <Skeleton width="80%" height={40} radius="var(--radius-md)" />
      </div>
    </div>
  )
}

function Transcript({ reportId, onRoster }: { reportId: string; onRoster: (roster: RosterEntry[]) => void }) {
  const { t, i18n } = useTranslation('console')
  const { t: st } = useTranslation('session')
  const { page, error, hasOlder, hasNewer, loadingOlder, loadingNewer, loadOlder, loadNewer, topShiftVersion } = useTranscript(reportId)

  const containerRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const bottomSentinelRef = useRef<HTMLDivElement>(null)
  const dividerRef = useRef<HTMLDivElement>(null)
  const { snapshotBeforeShift } = useScrollShiftCompensation(containerRef, topShiftVersion)
  const centredRef = useRef(false)

  // The roster rides along with the first page; the dialog above uses it
  // to label the reporter and reported members the same way.
  useEffect(() => {
    if (page) onRoster(page.roster)
  }, [page, onRoster])

  // Open with the "report filed" marker near the bottom of the panel,
  // once, when the first page lands — the fixed point every review starts
  // from. What prompted a report is almost always the messages just
  // before it, so the view gives those the room: the marker sits a
  // healthy margin above the bottom edge, with the lead-up filling the
  // panel above it. Messages the report names are ringed wherever they
  // fall and reached by scrolling.
  useLayoutEffect(() => {
    if (!page || centredRef.current) return
    const target = dividerRef.current
    const container = containerRef.current
    if (target && container) {
      // Measured against the container's own box, not offsetTop — that
      // is relative to the nearest positioned ancestor (the modal), which
      // put the marker a few rows below the fold.
      const targetTop = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
      container.scrollTop = targetTop + target.clientHeight - container.clientHeight + MARKER_BOTTOM_MARGIN_PX
    }
    centredRef.current = true
  }, [page])

  // Both ends watched by IntersectionObservers rooted at the scroll
  // container — same technique as SessionPage's top sentinel, mirrored
  // for the bottom. Re-armed whenever a cursor or the message count
  // changes so a freshly loaded page can trigger the next.
  useEffect(() => {
    const root = containerRef.current
    if (!root || !page) return
    const observers: IntersectionObserver[] = []
    if (hasOlder && topSentinelRef.current) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            snapshotBeforeShift()
            void loadOlder()
          }
        },
        { root, rootMargin: '80px' },
      )
      observer.observe(topSentinelRef.current)
      observers.push(observer)
    }
    if (hasNewer && bottomSentinelRef.current) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) void loadNewer()
        },
        { root, rootMargin: '80px' },
      )
      observer.observe(bottomSentinelRef.current)
      observers.push(observer)
    }
    return () => observers.forEach((observer) => observer.disconnect())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshotBeforeShift/loadOlder/loadNewer read live state; re-arming is keyed on what actually changes the sentinels.
  }, [page, hasOlder, hasNewer, page?.messages.length])

  if (error) return <Alert variant="urgent">{error}</Alert>
  if (!page) {
    return (
      <div className="reports-transcript">
        <MessageSkeleton />
        <MessageSkeleton />
        <MessageSkeleton />
      </div>
    )
  }

  const reportedAtMs = new Date(page.reportedAt).getTime()
  const reportedMembers = new Set(page.aboutUserIds)
  const reportedMessages = new Set(page.messageIds)
  // The marker goes before the first message sent after the report — or
  // at the very end if nothing was said afterwards.
  const dividerIndex = page.messages.findIndex((m) => new Date(m.createdAt).getTime() > reportedAtMs)
  const before = dividerIndex === -1 ? page.messages : page.messages.slice(0, dividerIndex)
  const after = dividerIndex === -1 ? [] : page.messages.slice(dividerIndex)

  const renderMessage = (m: ChatMessage) => {
    const member = memberFor(m.userId, page.roster, null)
    if (m.type === 'system') return <JoinEventRow key={m.id} message={m} member={member} timeZone={TIME_ZONE} t={st} />
    const isReportedMessage = reportedMessages.has(m.id)
    return (
      <div key={m.id}>
        {m.moderationStatus !== 'pass' && (
          <div className="reports-transcript__withheld">{m.moderationStatus === 'removed' ? t('reports.removed') : t('reports.withheld')}</div>
        )}
        <MessageRow
          message={m}
          member={member}
          isOwn={false}
          timeZone={TIME_ZONE}
          // Ring only the messages the member actually pointed at; every
          // other message from a reported member gets the tag alone, so
          // the specific complaint stands out from the general context.
          highlight={isReportedMessage}
          highlightLabel={isReportedMessage ? t('reports.reportedMessage') : reportedMembers.has(m.userId) ? t('reports.reportedMember') : undefined}
          t={st}
        />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="reports-transcript">
      {hasOlder ? (
        <div ref={topSentinelRef} style={{ height: 1, flexShrink: 0 }} />
      ) : (
        <div className="reports-transcript__end">{t('reports.startOfConversation')}</div>
      )}
      {loadingOlder && <MessageSkeleton />}
      {page.messages.length === 0 && <div className="reports-transcript__end">{t('reports.noMessages')}</div>}
      {before.map(renderMessage)}
      <div ref={dividerRef} className="reports-transcript__divider" role="separator">
        {t('reports.reportFiledDivider', { when: new Date(page.reportedAt).toLocaleString(i18n.language) })}
      </div>
      {after.map(renderMessage)}
      {loadingNewer && <MessageSkeleton />}
      {hasNewer ? (
        <div ref={bottomSentinelRef} style={{ height: 1, flexShrink: 0 }} />
      ) : (
        <div className="reports-transcript__end">{t('reports.endOfConversation')}</div>
      )}
    </div>
  )
}

// ---- Decision ----
//
// The note comes first, deliberately: nothing below it is enabled until
// the reviewer has written why. The reasoning is the record
// (sessionReportService.ts refuses a decision without it), and asking
// for it before offering outcomes makes that the natural order rather
// than an afterthought. Then one action — none, a note on the member, a
// warning, removal from this circle, hiding the named messages, or a ban
// (only offered to holders of users.ban; the server checks too) — and
// finally the decision itself. Dismissing is only possible with no
// action, since dismissing means there was nothing to act on.
function DecisionModal({
  report,
  roster,
  canBan,
  onClose,
  onDecided,
}: {
  report: SessionReport
  roster: RosterEntry[]
  canBan: boolean
  onClose: () => void
  onDecided: () => void
}) {
  const { t } = useTranslation('console')
  const [note, setNote] = useState('')
  const [action, setAction] = useState<ReportAction>('none')
  const [targets, setTargets] = useState<Set<string>>(() => new Set(report.aboutUserIds))
  const [memberMessage, setMemberMessage] = useState('')
  const [banReason, setBanReason] = useState<BanReason | null>(null)
  const [pending, setPending] = useState<Decision | null>(null)
  const [error, setError] = useState<string | null>(null)

  const noteReady = note.trim().length > 0
  const needsTargets = MEMBER_TARGETED.has(action)
  const actionReady =
    action === 'none' ||
    (action === 'hide_messages' && report.messageIds.length > 0) ||
    (needsTargets &&
      targets.size > 0 &&
      (action !== 'warn' || memberMessage.trim().length > 0) &&
      (action !== 'ban' || banReason !== null))
  const ready = noteReady && actionReady

  const actions: ReportAction[] = ['none', 'note', 'warn', 'remove_from_session', 'hide_messages', ...(canBan ? (['ban'] as const) : [])]

  const decide = async (status: Decision) => {
    if (!ready) return
    setPending(status)
    setError(null)
    try {
      await postTrpc('sessionReports.review', {
        reportId: report.id,
        status,
        note: note.trim(),
        action,
        targetUserIds: needsTargets ? [...targets] : [],
        memberMessage: action === 'warn' ? memberMessage.trim() : undefined,
        banReasonCategory: action === 'ban' ? banReason : undefined,
      })
      onDecided()
    } catch {
      setError(t('reports.decideFailed'))
      setPending(null)
    }
  }

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} title={t('reports.decisionTitle')} className="reports-decision-modal">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <Text variant="muted" style={{ margin: 0 }}>
          {t('reports.decisionIntro')}
        </Text>
        {error && <Alert variant="urgent">{error}</Alert>}
        <Textarea
          label={t('reports.noteLabel')}
          placeholder={t('reports.notePlaceholder')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          autoFocus
        />

        <fieldset className="reports-decision__step" disabled={!noteReady}>
          <RadioGroup label={t('reports.actionLabel')} value={action} onChange={(value) => setAction(value as ReportAction)} isDisabled={!noteReady}>
            {actions.map((value) => (
              <Radio key={value} value={value} isDisabled={value === 'hide_messages' && report.messageIds.length === 0}>
                <span className="reports-decision__option">
                  <span>{t(`reports.actions.${value}.label`)}</span>
                  <span className="reports-decision__hint">
                    {value === 'hide_messages' && report.messageIds.length === 0 ? t('reports.actions.hide_messages.unavailable') : t(`reports.actions.${value}.hint`)}
                  </span>
                </span>
              </Radio>
            ))}
          </RadioGroup>

          {needsTargets && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div className="reports-review__label">{t('reports.targetsLabel')}</div>
              <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                {report.aboutUserIds.map((id) => (
                  <Checkbox
                    key={id}
                    isSelected={targets.has(id)}
                    onChange={(isSelected) =>
                      setTargets((prev) => {
                        const next = new Set(prev)
                        if (isSelected) next.add(id)
                        else next.delete(id)
                        return next
                      })
                    }
                  >
                    <MemberChip userId={id} roster={roster} />
                  </Checkbox>
                ))}
              </div>
            </div>
          )}

          {action === 'warn' && (
            <Textarea
              label={t('reports.memberMessageLabel')}
              hint={t('reports.memberMessageHint')}
              placeholder={t('reports.memberMessagePlaceholder')}
              value={memberMessage}
              onChange={(e) => setMemberMessage(e.target.value)}
              rows={4}
            />
          )}

          {action === 'ban' && (
            <>
              <Select
                label={t('reports.banReasonLabel')}
                placeholder={t('reports.banReasonPlaceholder')}
                selectedKey={banReason}
                onSelectionChange={(key) => setBanReason(key as BanReason)}
              >
                {BAN_REASONS.map((reason) => (
                  <SelectItem key={reason} id={reason}>
                    {t(`reports.banReasons.${reason}`)}
                  </SelectItem>
                ))}
              </Select>
              <Alert variant="urgent">{t('reports.banWarning')}</Alert>
            </>
          )}
        </fieldset>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <Button variant={action === 'ban' ? 'urgent' : 'safe'} isDisabled={!ready || pending !== null} isPending={pending === 'reviewed'} onPress={() => void decide('reviewed')}>
            {action === 'none' ? t('reports.decisionReviewed') : t('reports.decisionReviewedWithAction', { action: t(`reports.actions.${action}.label`) })}
          </Button>
          <Button
            variant="secondary"
            isDisabled={!noteReady || action !== 'none' || pending !== null}
            isPending={pending === 'dismissed'}
            onPress={() => void decide('dismissed')}
          >
            {t('reports.decisionDismissed')}
          </Button>
          {action !== 'none' && (
            <Text variant="muted" style={{ margin: 0, fontSize: 'var(--font-size-xs)' }}>
              {t('reports.dismissUnavailable')}
            </Text>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onPress={onClose} isDisabled={pending !== null}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---- History ----
//
// What's already on file about the members this report is about — every
// moderator note on them and every other report naming them. This is
// where a decision note earns its keep: the next reviewer sees the
// pattern before deciding, instead of judging each report in isolation.
function SubjectHistoryPanel({ reportId, roster, canBan }: { reportId: string; roster: RosterEntry[]; canBan: boolean }) {
  const { t, i18n } = useTranslation('console')
  const [history, setHistory] = useState<SubjectHistory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openReportId, setOpenReportId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getTrpc<SubjectHistory>('sessionReports.subjectHistory', { reportId })
      .then((h) => {
        if (!cancelled) setHistory(h)
      })
      .catch(() => {
        if (!cancelled) setError(t('reports.history.loadFailed'))
      })
    return () => {
      cancelled = true
    }
  }, [reportId, t])

  if (error) return <Alert variant="urgent">{error}</Alert>
  if (!history) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <Skeleton width="50%" height={14} />
        <Skeleton width="70%" height={14} />
      </div>
    )
  }

  const hasAnything = history.subjects.some((s) => s.notes.length > 0 || s.priorReports.length > 0)
  if (!hasAnything) {
    return (
      <Text variant="muted" style={{ margin: 0 }}>
        {t('reports.history.none')}
      </Text>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {history.subjects
        .filter((s) => s.notes.length > 0 || s.priorReports.length > 0)
        .map((subject) => (
          <div key={subject.userId} className="reports-history__subject">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <MemberChip userId={subject.userId} roster={roster} />
              <Text variant="muted" as="span" style={{ margin: 0 }}>
                {t('reports.history.summary', { notes: subject.notes.length, reports: subject.priorReports.length })}
              </Text>
            </div>
            {subject.priorReports.map((prior) => (
              <div key={prior.id} className="reports-history__item">
                <div className="reports-history__meta">
                  <span>{new Date(prior.createdAt).toLocaleString(i18n.language)}</span>
                  <span>·</span>
                  <span>{prior.sessionName ?? t('reports.unnamedSession')}</span>
                  <StatusBadge status={prior.status} />
                  {prior.action && prior.action !== 'none' && (
                    <Badge variant={prior.appliedToThisMember ? (prior.action === 'ban' ? 'urgent' : 'info') : 'neutral'}>
                      {t(`reports.actions.${prior.action}.label`)}
                      {!prior.appliedToThisMember ? ` · ${t('reports.history.notThisMember')}` : ''}
                    </Badge>
                  )}
                  {prior.reviewedByLabel && <span>{t('reports.history.by', { who: prior.reviewedByLabel })}</span>}
                </div>
                <div className="reports-history__row">
                  <span className="reports-excerpt" style={{ flex: 1 }}>
                    {prior.body}
                  </span>
                  <Button variant="ghost" onPress={() => setOpenReportId(prior.id)}>
                    {t('reports.view')}
                  </Button>
                </div>
              </div>
            ))}
            {subject.notes.map((note) => (
              <div key={note.id} className="reports-history__item">
                <div className="reports-history__meta">
                  <span>{new Date(note.createdAt).toLocaleString(i18n.language)}</span>
                  <Badge>{t('reports.history.note')}</Badge>
                  {note.createdByLabel && <span>{t('reports.history.by', { who: note.createdByLabel })}</span>}
                </div>
                <div className="reports-history__row">
                  <span style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{note.body}</span>
                  {note.reportId && (
                    <Button variant="ghost" onPress={() => setOpenReportId(note.reportId)}>
                      {t('reports.history.viewReport')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      {openReportId && <ReportByIdModal reportId={openReportId} canBan={canBan} onClose={() => setOpenReportId(null)} />}
    </div>
  )
}

// Opens the review dialog for a report known only by id — from a note's
// "view report" link or a history entry. Fetches the row first so the
// dialog itself can stay a pure function of a loaded report.
export function ReportByIdModal({ reportId, canBan, onClose }: { reportId: string; canBan: boolean; onClose: () => void }) {
  const { t } = useTranslation('console')
  const [report, setReport] = useState<SessionReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getTrpc<SessionReport>('sessionReports.get', { reportId })
      .then((r) => {
        if (!cancelled) setReport(r)
      })
      .catch(() => {
        if (!cancelled) setError(t('reports.loadFailed'))
      })
    return () => {
      cancelled = true
    }
  }, [reportId, t])

  if (error) {
    return (
      <Modal isOpen onOpenChange={(open) => !open && onClose()} title={t('reports.view')}>
        <Alert variant="urgent">{error}</Alert>
      </Modal>
    )
  }
  if (!report) return null
  return <ReviewReportModal report={report} canBan={canBan} onClose={onClose} onDecided={onClose} />
}

// ---- Review dialog ----
export function ReviewReportModal({
  report,
  canBan,
  onClose,
  onDecided,
}: {
  report: SessionReport
  canBan: boolean
  onClose: () => void
  onDecided: () => void
}) {
  const { t, i18n } = useTranslation('console')
  const [deciding, setDeciding] = useState(false)
  // Filled in by the transcript's first page; until then the chips show
  // the anonymous fallback label.
  const [roster, setRoster] = useState<RosterEntry[]>([])

  const title = report.sessionName ?? t('reports.unnamedSession')

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} title={title} className="reports-review-modal">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <StatusBadge status={report.status} />
              <Text variant="muted" as="span" style={{ margin: 0 }}>
                {t('reports.filedAt', { when: new Date(report.createdAt).toLocaleString(i18n.language) })}
              </Text>
            </div>
            <div className="reports-review__facts">
              <span className="reports-review__label">{t('reports.reporter')}</span>
              <span>
                {report.reporterUserId ? (
                  <MemberChip userId={report.reporterUserId} roster={roster} />
                ) : (
                  <Text variant="muted" as="span" style={{ margin: 0 }}>
                    {t('reports.reporterGone')}
                  </Text>
                )}
              </span>
              <span className="reports-review__label">{t('reports.about')}</span>
              <span style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {report.aboutUserIds.map((id) => (
                  <MemberChip key={id} userId={id} roster={roster} />
                ))}
              </span>
              {report.messageIds.length > 0 && (
                <>
                  <span className="reports-review__label">{t('reports.messages')}</span>
                  <span>{t('reports.messagesReported', { count: report.messageIds.length })}</span>
                </>
              )}
            </div>
          </div>
          {report.status === 'open' && (
            <Button variant="safe" onPress={() => setDeciding(true)}>
              {t('reports.makeDecision')}
            </Button>
          )}
        </div>

        <blockquote className="reports-review__quote">
          <div className="reports-review__label">{t('reports.reportBody')}</div>
          {report.body}
        </blockquote>

        {report.status !== 'open' && (
          <Alert variant={report.status === 'reviewed' ? 'safe' : 'info'}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <strong>
                {report.reviewedByLabel
                  ? t('reports.decidedBy', { when: report.reviewedAt ? new Date(report.reviewedAt).toLocaleString(i18n.language) : '—', who: report.reviewedByLabel })
                  : t('reports.decided', { when: report.reviewedAt ? new Date(report.reviewedAt).toLocaleString(i18n.language) : '—' })}
              </strong>
              {report.action && report.action !== 'none' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <Badge variant={report.action === 'ban' ? 'urgent' : 'info'}>{t(`reports.actions.${report.action}.label`)}</Badge>
                  {report.actionTargetUserIds.map((id) => (
                    <MemberChip key={id} userId={id} roster={roster} />
                  ))}
                </span>
              )}
              <span style={{ whiteSpace: 'pre-wrap' }}>{report.decisionNote ?? t('reports.noNote')}</span>
            </div>
          </Alert>
        )}

        <div>
          <div className="reports-review__label" style={{ marginBottom: 'var(--space-2)' }}>
            {t('reports.history.title')}
          </div>
          <SubjectHistoryPanel reportId={report.id} roster={roster} canBan={canBan} />
        </div>

        <div>
          <div className="reports-review__label" style={{ marginBottom: 'var(--space-2)' }}>
            {t('reports.transcriptTitle')}
          </div>
          <Transcript reportId={report.id} onRoster={setRoster} />
        </div>
      </div>

      {deciding && (
        <DecisionModal
          report={report}
          roster={roster}
          canBan={canBan}
          onClose={() => setDeciding(false)}
          onDecided={() => {
            setDeciding(false)
            onDecided()
          }}
        />
      )}
    </Modal>
  )
}

// ---- List ----
function ReportsPanel({ status, canBan }: { status: ReportStatus; canBan: boolean }) {
  const { t, i18n } = useTranslation('console')
  const [reports, setReports] = useState<SessionReport[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<SessionReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (afterCursor?: string) => {
      try {
        const page = await getTrpc<{ reports: SessionReport[]; nextCursor: string | null }>('sessionReports.list', {
          status,
          cursor: afterCursor,
          limit: PAGE_SIZE,
        })
        setReports((prev) => (afterCursor ? [...(prev ?? []), ...page.reports] : page.reports))
        setCursor(page.nextCursor)
        setError(null)
      } catch {
        setError(t('reports.loadFailed'))
      }
    },
    [status, t],
  )

  useEffect(() => {
    void load()
  }, [load])

  if (reports === null) {
    return <TableSkeleton columns={COLUMNS} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && <Alert variant="urgent">{error}</Alert>}

      <div style={{ overflowX: 'auto' }}>
        <Table striped>
          <thead>
            <tr>
              <th>{t('reports.columns.filed')}</th>
              <th>{t('reports.columns.session')}</th>
              <th>{t('reports.columns.report')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {reports.length === 0 && (
              <tr>
                <td colSpan={COLUMNS} style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>
                  {t(`reports.empty.${status}`)}
                </td>
              </tr>
            )}
            {reports.map((report) => (
              <tr key={report.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(report.createdAt).toLocaleString(i18n.language)}</td>
                <td>{report.sessionName ?? <span style={{ color: 'var(--text-secondary)' }}>{t('reports.unnamedSession')}</span>}</td>
                <td className="reports-excerpt">{report.body}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Button variant={status === 'open' ? 'safe' : 'ghost'} onPress={() => setReviewing(report)}>
                    {status === 'open' ? t('reports.review') : t('reports.view')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {cursor && (
        <Button variant="ghost" onPress={() => void load(cursor)}>
          {t('common.loadMore')}
        </Button>
      )}

      {reviewing && (
        <ReviewReportModal
          key={reviewing.id}
          report={reviewing}
          canBan={canBan}
          onClose={() => setReviewing(null)}
          onDecided={() => {
            setReviewing(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

export function ReportsTab({ canBan }: { canBan: boolean }) {
  const { t } = useTranslation('console')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Text variant="muted" style={{ margin: 0 }}>
        {t('reports.intro')}
      </Text>
      <Tabs defaultSelectedKey="open">
        <TabList aria-label={t('reports.tabsLabel')}>
          {STATUSES.map((status) => (
            <Tab key={status} id={status}>
              {t(`reports.status.${status}`)}
            </Tab>
          ))}
        </TabList>
        {STATUSES.map((status) => (
          <TabPanel key={status} id={status}>
            <ReportsPanel status={status} canBan={canBan} />
          </TabPanel>
        ))}
      </Tabs>
    </div>
  )
}
