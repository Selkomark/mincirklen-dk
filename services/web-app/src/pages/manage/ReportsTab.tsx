import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert } from '../../components/Alert'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { Skeleton } from '../../components/Skeleton'
import { Table } from '../../components/Table'
import { Tab, TabList, TabPanel, Tabs } from '../../components/Tabs'
import { Text } from '../../components/Text'
import { getTrpc, postTrpc } from './manageShared'

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
}

const STATUSES: ReportStatus[] = ['open', 'reviewed', 'dismissed']
const PAGE_SIZE = 20
const COLUMNS = 6

// Raw ids, monospace, same as UsersTab's User column — a reviewer
// correlates patterns by id and looks a person up in Users when they
// need to act; this tab never shows decrypted identity (CHARTER.md §4).
function UserId({ id }: { id: string | null }) {
  if (!id) return <span style={{ color: 'var(--text-secondary)' }}>—</span>
  return <span style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-xs)' }}>{id}</span>
}

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

// One status at a time. A decision drops the row from this list right
// away; the other status panels aren't kept mounted (DS Tabs renders only
// the selected panel), so switching to Reviewed/Dismissed fetches fresh
// and shows the moved report there.
function ReportsPanel({ status }: { status: ReportStatus }) {
  const { t, i18n } = useTranslation('console')
  const [reports, setReports] = useState<SessionReport[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [decidingId, setDecidingId] = useState<string | null>(null)
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

  const decide = async (reportId: string, decision: Decision) => {
    setDecidingId(reportId)
    setError(null)
    try {
      await postTrpc('sessionReports.review', { reportId, status: decision })
      setReports((prev) => (prev ?? []).filter((r) => r.id !== reportId))
    } catch {
      setError(t('reports.decideFailed'))
    } finally {
      setDecidingId(null)
    }
  }

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
              <th>{t('reports.columns.reporter')}</th>
              <th>{t('reports.columns.about')}</th>
              <th>{t('reports.columns.report')}</th>
              <th>{status === 'open' ? t('reports.columns.decision') : t('reports.columns.decidedBy')}</th>
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
                <td>
                  <div>{report.sessionName ?? <span style={{ color: 'var(--text-secondary)' }}>{t('reports.unnamedSession')}</span>}</div>
                  <UserId id={report.sessionId} />
                </td>
                <td>
                  <UserId id={report.reporterUserId} />
                </td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {report.aboutUserIds.length === 0 ? (
                      <Badge>{t('reports.wholeSession')}</Badge>
                    ) : (
                      report.aboutUserIds.map((id) => <UserId key={id} id={id} />)
                    )}
                  </div>
                </td>
                <td style={{ maxWidth: 360, whiteSpace: 'pre-wrap' }}>{report.body}</td>
                <td>
                  {status === 'open' ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                      <Button
                        variant="safe"
                        isPending={decidingId === report.id}
                        isDisabled={decidingId !== null && decidingId !== report.id}
                        onPress={() => void decide(report.id, 'reviewed')}
                      >
                        {t('reports.markReviewed')}
                      </Button>
                      <Button
                        variant="secondary"
                        isPending={decidingId === report.id}
                        isDisabled={decidingId !== null && decidingId !== report.id}
                        onPress={() => void decide(report.id, 'dismissed')}
                      >
                        {t('reports.dismiss')}
                      </Button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ whiteSpace: 'nowrap' }}>
                        {report.reviewedAt ? new Date(report.reviewedAt).toLocaleString(i18n.language) : '—'}
                      </span>
                      <UserId id={report.reviewedBy} />
                    </div>
                  )}
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
