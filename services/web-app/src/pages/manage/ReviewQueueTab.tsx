import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
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

const OUTCOME_LABELS: Record<Outcome, string> = {
  true_positive: 'Correctly flagged',
  false_positive: 'False positive',
  true_negative: 'Correctly passed',
  false_negative: 'Missed (should have flagged)',
}

export function ReviewQueueTab() {
  const [events, setEvents] = useState<PendingReviewEvent[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (afterCursor?: string) => {
    try {
      const page = await getTrpc<{ events: PendingReviewEvent[]; nextCursor: string | null }>(
        'moderation.listPendingReview',
        { cursor: afterCursor, limit: 20 },
      )
      setEvents((prev) => (afterCursor ? [...(prev ?? []), ...page.events] : page.events))
      setCursor(page.nextCursor)
    } catch {
      setError('Failed to load the review queue.')
    }
  }, [])

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
      setError('Failed to submit the decision — try again.')
    } finally {
      setSubmittingId(null)
    }
  }

  if (events === null) {
    return <div style={{ color: 'var(--text-secondary)' }}>Loading…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && <Alert variant="urgent">{error}</Alert>}

      {events.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)' }}>Nothing awaiting review.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <Table striped>
            <thead>
              <tr>
                <th>Flagged</th>
                <th>Classification</th>
                <th>Message</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(event.createdAt).toLocaleString()}</td>
                  <td>
                    <Badge variant={event.classification === 'crisis' ? 'urgent' : 'safe'}>{event.classification}</Badge>
                  </td>
                  <td style={{ maxWidth: 360 }}>{event.message?.body ?? '(message removed)'}</td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                      {(Object.keys(OUTCOME_LABELS) as Outcome[]).map((outcome) => (
                        <Button
                          key={outcome}
                          variant="secondary"
                          isPending={submittingId === event.id}
                          isDisabled={submittingId !== null && submittingId !== event.id}
                          onPress={() => void submit(event.id, outcome)}
                        >
                          {OUTCOME_LABELS[outcome]}
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
          Load more
        </Button>
      )}
    </div>
  )
}
