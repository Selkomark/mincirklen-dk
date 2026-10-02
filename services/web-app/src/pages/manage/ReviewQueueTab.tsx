import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { CopyText } from '../../components/CopyText'
import { Alert } from '../../components/Alert'
import { Modal } from '../../components/Modal'
import { Select, SelectItem } from '../../components/Select'
import { Table } from '../../components/Table'
import { Tab, TabList, TabPanel, Tabs } from '../../components/Tabs'
import { Text } from '../../components/Text'
import { getTrpc, postTrpc } from './manageShared'
import './ReportsTab.css'

interface ReviewEvent {
  id: string
  sessionId: string
  userId: string
  classification: 'flag' | 'crisis'
  createdAt: string
  message: { body: string; createdAt: string } | null
  humanReviewOutcome: Outcome | null
  reviewedAt: string | null
  reviewedByLabel: string | null
}

type Outcome = 'true_positive' | 'false_positive' | 'true_negative' | 'false_negative'
type ListStatus = 'pending' | 'decided'

const OUTCOMES: Outcome[] = ['true_positive', 'false_positive', 'true_negative', 'false_negative']
const STATUSES: ListStatus[] = ['pending', 'decided']
const PAGE_SIZE = 20

function ClassificationBadge({ classification }: { classification: ReviewEvent['classification'] }) {
  const { t } = useTranslation('console')
  return <Badge variant={classification === 'crisis' ? 'urgent' : 'safe'}>{t(`review.classification.${classification}`)}</Badge>
}

// The event in full plus, while pending, one dropdown of outcomes and a
// confirm — the four verdicts used to sit in the table as four buttons,
// which read as noise and invited a mis-click. Decided events open the
// same dialog read-only, showing what was ruled, when and by whom.
function ReviewModal({ event, canDecide, onClose, onDecided }: { event: ReviewEvent; canDecide: boolean; onClose: () => void; onDecided: () => void }) {
  const { t, i18n } = useTranslation('console')
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const decided = event.humanReviewOutcome !== null

  const submit = async () => {
    if (!outcome) return
    setPending(true)
    setError(null)
    try {
      await postTrpc('moderation.submitReviewDecision', { moderationEventId: event.id, outcome })
      onDecided()
    } catch {
      setError(t('review.submitFailed'))
      setPending(false)
    }
  }

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} title={t('review.modalTitle')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <ClassificationBadge classification={event.classification} />
          <Text variant="muted" as="span" style={{ margin: 0 }}>
            {t('review.flaggedAt', { when: new Date(event.createdAt).toLocaleString(i18n.language) })}
          </Text>
        </div>
        <blockquote className="reports-review__quote">
          <div className="reports-review__label">{t('review.columns.message')}</div>
          {event.message ? event.message.body : <span style={{ color: 'var(--text-secondary)' }}>{t('review.messageRemoved')}</span>}
        </blockquote>
        {error && <Alert variant="urgent">{error}</Alert>}

        {decided ? (
          <Alert variant="info">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <strong>
                {event.reviewedByLabel
                  ? t('review.decidedBy', { when: event.reviewedAt ? new Date(event.reviewedAt).toLocaleString(i18n.language) : '—', who: event.reviewedByLabel })
                  : t('review.decided', { when: event.reviewedAt ? new Date(event.reviewedAt).toLocaleString(i18n.language) : '—' })}
              </strong>
              <span>{t(`review.outcome.${event.humanReviewOutcome!}`)}</span>
            </div>
          </Alert>
        ) : canDecide ? (
          <>
            <Select label={t('review.decisionLabel')} placeholder={t('review.decisionPlaceholder')} selectedKey={outcome} onSelectionChange={(key) => setOutcome(key as Outcome)}>
              {OUTCOMES.map((value) => (
                <SelectItem key={value} id={value}>
                  {t(`review.outcome.${value}`)}
                </SelectItem>
              ))}
            </Select>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              <Button variant="ghost" onPress={onClose} isDisabled={pending}>
                {t('common.cancel')}
              </Button>
              <Button variant="safe" isPending={pending} isDisabled={outcome === null} onPress={() => void submit()}>
                {t('review.confirm')}
              </Button>
            </div>
          </>
        ) : (
          <Text variant="muted" style={{ margin: 0 }}>
            {t('review.readOnly')}
          </Text>
        )}
      </div>
    </Modal>
  )
}

// One status at a time, paged with Previous/Next over the API's cursor:
// going forward pushes the cursor that produced the current page, going
// back pops it, so a reviewer can step through a long backlog without an
// ever-growing list.
function ReviewList({ status, canDecide }: { status: ListStatus; canDecide: boolean }) {
  const { t, i18n } = useTranslation('console')
  const [events, setEvents] = useState<ReviewEvent[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined])
  const [reviewing, setReviewing] = useState<ReviewEvent | null>(null)
  const [error, setError] = useState<string | null>(null)

  const currentCursor = cursorStack[cursorStack.length - 1]

  const load = useCallback(async () => {
    try {
      const page = await getTrpc<{ events: ReviewEvent[]; nextCursor: string | null }>('moderation.listPendingReview', {
        status,
        cursor: currentCursor,
        limit: PAGE_SIZE,
      })
      setEvents(page.events)
      setNextCursor(page.nextCursor)
      setError(null)
    } catch {
      setError(t('review.loadFailed'))
    }
  }, [status, currentCursor, t])

  useEffect(() => {
    void load()
  }, [load])

  if (events === null) {
    return <div style={{ color: 'var(--text-secondary)' }}>{t('common.loading')}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && <Alert variant="urgent">{error}</Alert>}

      {events.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)' }}>{t(`review.emptyByStatus.${status}`)}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <Table striped>
            <thead>
              <tr>
                <th>{t('review.columns.flagged')}</th>
                <th>{t('review.columns.classification')}</th>
                <th>{t('review.columns.message')}</th>
                {status === 'decided' && <th>{t('review.columns.outcome')}</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <CopyText copyLabel={t('users.copy')} copiedLabel={t('users.copied')}>
                      {new Date(event.createdAt).toLocaleString(i18n.language)}
                    </CopyText>
                  </td>
                  <td>
                    <CopyText value={t(`review.classification.${event.classification}`)} copyLabel={t('users.copy')} copiedLabel={t('users.copied')}>
                      <ClassificationBadge classification={event.classification} />
                    </CopyText>
                  </td>
                  <td style={{ maxWidth: 360 }}>
                    {event.message ? (
                      <CopyText copyLabel={t('users.copy')} copiedLabel={t('users.copied')} style={{ whiteSpace: 'pre-wrap' }}>
                        {event.message.body}
                      </CopyText>
                    ) : (
                      <span style={{ color: 'var(--text-secondary)' }}>{t('review.messageRemoved')}</span>
                    )}
                  </td>
                  {status === 'decided' && <td>{event.humanReviewOutcome ? t(`review.outcome.${event.humanReviewOutcome}`) : '—'}</td>}
                  <td style={{ textAlign: 'right' }}>
                    <Button variant={status === 'pending' && canDecide ? 'safe' : 'ghost'} onPress={() => setReviewing(event)}>
                      {status === 'pending' && canDecide ? t('review.review') : t('common.view')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {(cursorStack.length > 1 || nextCursor) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
          <Text variant="muted" as="span" style={{ margin: 0 }}>
            {t('common.page', { n: cursorStack.length })}
          </Text>
          <Button variant="ghost" isDisabled={cursorStack.length <= 1} onPress={() => setCursorStack((s) => s.slice(0, -1))}>
            {t('common.previous')}
          </Button>
          <Button variant="ghost" isDisabled={!nextCursor} onPress={() => nextCursor && setCursorStack((s) => [...s, nextCursor])}>
            {t('common.next')}
          </Button>
        </div>
      )}

      {reviewing && (
        <ReviewModal
          key={reviewing.id}
          event={reviewing}
          canDecide={canDecide}
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

export function ReviewQueueTab({ canDecide }: { canDecide: boolean }) {
  const { t } = useTranslation('console')
  return (
    <Tabs defaultSelectedKey="pending">
      <TabList aria-label={t('review.tabsLabel')}>
        {STATUSES.map((status) => (
          <Tab key={status} id={status}>
            {t(`review.tabs.${status}`)}
          </Tab>
        ))}
      </TabList>
      {STATUSES.map((status) => (
        <TabPanel key={status} id={status}>
          <ReviewList status={status} canDecide={canDecide} />
        </TabPanel>
      ))}
    </Tabs>
  )
}
