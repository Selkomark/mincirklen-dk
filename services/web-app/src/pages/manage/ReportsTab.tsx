import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert } from '../../components/Alert'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
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

interface SessionReport {
  id: string
  sessionId: string
  sessionName: string | null
  // Null once the reporter has deleted their account — the report
  // itself survives them (migrations/0001_init.ts).
  reporterUserId: string | null
  aboutUserIds: string[]
  body: string
  status: ReportStatus
  createdAt: string
  reviewedAt: string | null
  reviewedBy: string | null
  decisionNote: string | null
}

interface TranscriptPage {
  messages: ChatMessage[]
  olderCursor: string | null
  newerCursor: string | null
  roster: RosterEntry[]
  reportedAt: string
  aboutUserIds: string[]
}

const STATUSES: ReportStatus[] = ['open', 'reviewed', 'dismissed']
const PAGE_SIZE = 20
const TRANSCRIPT_PAGE_SIZE = 30
const COLUMNS = 4

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

  // Open centred on the report marker, once, when the first page lands —
  // the reviewer starts at what prompted the report and reads outward.
  useLayoutEffect(() => {
    if (!page || centredRef.current) return
    const divider = dividerRef.current
    const container = containerRef.current
    if (divider && container) {
      container.scrollTop = divider.offsetTop - container.clientHeight / 2
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
  const reported = new Set(page.aboutUserIds)
  // The marker goes before the first message sent after the report — or
  // at the very end if nothing was said afterwards.
  const dividerIndex = page.messages.findIndex((m) => new Date(m.createdAt).getTime() > reportedAtMs)
  const before = dividerIndex === -1 ? page.messages : page.messages.slice(0, dividerIndex)
  const after = dividerIndex === -1 ? [] : page.messages.slice(dividerIndex)

  const renderMessage = (m: ChatMessage) => {
    const member = memberFor(m.userId, page.roster, null)
    if (m.type === 'system') return <JoinEventRow key={m.id} message={m} member={member} timeZone={TIME_ZONE} t={st} />
    return (
      <div key={m.id}>
        {m.moderationStatus !== 'pass' && <div className="reports-transcript__withheld">{t('reports.withheld')}</div>}
        <MessageRow
          message={m}
          member={member}
          isOwn={false}
          timeZone={TIME_ZONE}
          highlight={reported.has(m.userId)}
          highlightLabel={t('reports.reportedMember')}
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
// The note comes first, deliberately: the decision buttons stay disabled
// until the reviewer has written why. The reasoning is the record
// (sessionReportService.ts refuses a decision without it), and asking
// for it before offering the buttons makes that the natural order rather
// than an afterthought.
function DecisionModal({ reportId, onClose, onDecided }: { reportId: string; onClose: () => void; onDecided: () => void }) {
  const { t } = useTranslation('console')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState<Decision | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ready = note.trim().length > 0

  const decide = async (status: Decision) => {
    if (!ready) return
    setPending(status)
    setError(null)
    try {
      await postTrpc('sessionReports.review', { reportId, status, note: note.trim() })
      onDecided()
    } catch {
      setError(t('reports.decideFailed'))
      setPending(null)
    }
  }

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} title={t('reports.decisionTitle')}>
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
          rows={5}
          autoFocus
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <Button variant="safe" isDisabled={!ready || pending !== null} isPending={pending === 'reviewed'} onPress={() => void decide('reviewed')}>
            {t('reports.decisionReviewed')}
          </Button>
          <Button
            variant="secondary"
            isDisabled={!ready || pending !== null}
            isPending={pending === 'dismissed'}
            onPress={() => void decide('dismissed')}
          >
            {t('reports.decisionDismissed')}
          </Button>
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

// ---- Review dialog ----
function ReviewReportModal({ report, onClose, onDecided }: { report: SessionReport; onClose: () => void; onDecided: () => void }) {
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
                {t('reports.decided', { when: report.reviewedAt ? new Date(report.reviewedAt).toLocaleString(i18n.language) : '—' })}
              </strong>
              <span style={{ whiteSpace: 'pre-wrap' }}>{report.decisionNote ?? t('reports.noNote')}</span>
            </div>
          </Alert>
        )}

        <div>
          <div className="reports-review__label" style={{ marginBottom: 'var(--space-2)' }}>
            {t('reports.transcriptTitle')}
          </div>
          <Transcript reportId={report.id} onRoster={setRoster} />
        </div>
      </div>

      {deciding && (
        <DecisionModal
          reportId={report.id}
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
function ReportsPanel({ status }: { status: ReportStatus }) {
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

export function ReportsTab() {
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
            <ReportsPanel status={status} />
          </TabPanel>
        ))}
      </Tabs>
    </div>
  )
}
