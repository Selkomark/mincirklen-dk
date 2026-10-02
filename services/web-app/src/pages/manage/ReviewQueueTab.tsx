import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { CopyText } from '../../components/CopyText'
import { Alert } from '../../components/Alert'
import { Table } from '../../components/Table'
import { getTrpc, postTrpc } from './manageShared'

interface PendingReviewEvent {
  id: string
  sessionId: string
  userId: string
  classification: 'flag' | 'crisis'
  createdAt: string
  message: { body: string; createdAt: string } | null
}

type Outcome = 'true_positive' | 'false_positive' | 'true_negative' | 'false_negative'

const OUTCOMES: Outcome[] = ['true_positive', 'false_positive', 'true_negative', 'false_negative']

export function ReviewQueueTab() {
  const { t, i18n } = useTranslation('console')
  const [events, setEvents] = useState<PendingReviewEvent[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (afterCursor?: string) => {
      try {
        const page = await getTrpc<{ events: PendingReviewEvent[]; nextCursor: string | null }>(
          'moderation.listPendingReview',
          { cursor: afterCursor, limit: 20 },
        )
        setEvents((prev) => (afterCursor ? [...(prev ?? []), ...page.events] : page.events))
        setCursor(page.nextCursor)
      } catch {
        setError(t('review.loadFailed'))
      }
    },
    [t],
  )

  useEffect(() => {
    void load()
  }, [load])

  const submit = async (eventId: string, outcome: Outcome) => {
    setSubmittingId(eventId)
    setError(null)
    try {
      await postTrpc('moderation.submitReviewDecision', { moderationEventId: eventId, outcome })
      setEvents((prev) => (prev ?? []).filter((e) => e.id !== eventId))
    } catch {
      setError(t('review.submitFailed'))
    } finally {
      setSubmittingId(null)
    }
  }

  if (events === null) {
    return <div style={{ color: 'var(--text-secondary)' }}>{t('common.loading')}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && <Alert variant="urgent">{error}</Alert>}

      {events.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)' }}>{t('review.empty')}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <Table striped>
            <thead>
              <tr>
                <th>{t('review.columns.flagged')}</th>
                <th>{t('review.columns.classification')}</th>
                <th>{t('review.columns.message')}</th>
                <th>{t('review.columns.decision')}</th>
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
                      <Badge variant={event.classification === 'crisis' ? 'urgent' : 'safe'}>
                        {t(`review.classification.${event.classification}`)}
                      </Badge>
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
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                      {OUTCOMES.map((outcome) => (
                        <Button
                          key={outcome}
                          variant="secondary"
                          isPending={submittingId === event.id}
                          isDisabled={submittingId !== null && submittingId !== event.id}
                          onPress={() => void submit(event.id, outcome)}
                        >
                          {t(`review.outcome.${outcome}`)}
                        </Button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {cursor && (
        <Button variant="ghost" onPress={() => void load(cursor)}>
          {t('common.loadMore')}
        </Button>
      )}
    </div>
  )
}
