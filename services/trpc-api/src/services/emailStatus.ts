import type { EmailStatus } from '@mincirklen/shared'

// How a message's status moves as the provider's webhooks arrive. Events
// come out of order (an open can land before the delivery that enabled
// it) and are retried, so the status is not "whatever came last": it only
// moves forward along the happy path, and once it has gone wrong it stays
// wrong — a late `delivered` never papers over a bounce.

const RANK: Record<EmailStatus, number> = {
  queued: 0,
  sent: 1,
  accepted: 2,
  delayed: 3,
  delivered: 4,
  opened: 5,
  clicked: 6,
  // Terminal: compared by isTerminal, not rank.
  bounced: 100,
  failed: 100,
  suppressed: 100,
  complained: 100,
}

const TERMINAL: ReadonlySet<EmailStatus> = new Set(['bounced', 'failed', 'suppressed', 'complained'])

export function isTerminalEmailStatus(status: EmailStatus): boolean {
  return TERMINAL.has(status)
}

export function nextEmailStatus(current: EmailStatus, incoming: EmailStatus): EmailStatus {
  if (isTerminalEmailStatus(current)) return current
  if (isTerminalEmailStatus(incoming)) return incoming
  return RANK[incoming] > RANK[current] ? incoming : current
}

// AhaSend's `message.*` event types → the status each implies. Null for
// anything we don't map (an unknown or future event is still recorded in
// email_events, it just doesn't move the status).
const EVENT_STATUS: Record<string, EmailStatus> = {
  'message.reception': 'accepted',
  'message.sent': 'delivered',
  'message.delivered': 'delivered',
  'message.transient_error': 'delayed',
  'message.opened': 'opened',
  'message.clicked': 'clicked',
  'message.bounced': 'bounced',
  'message.failed': 'failed',
  'message.suppressed': 'suppressed',
  'message.complained': 'complained',
}

export function statusForWebhookEventType(type: string): EmailStatus | null {
  return EVENT_STATUS[type] ?? null
}

type EventData = Record<string, unknown>

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

// AhaSend's send API returns the RFC Message-ID as the message id, and
// the webhook payload carries that same header under message_id_header;
// older payload shapes nest it under message.id or put it at data.id.
export function providerMessageIdFromEventData(data: EventData): string | null {
  const nested = data.message
  return (
    str(data.message_id_header) ??
    (nested && typeof nested === 'object' ? str((nested as EventData).id) : null) ??
    str(data.id)
  )
}

// A one-line explanation for the message's `error` column when an event
// says delivery went wrong; null for the happy-path events.
export function errorFromEventData(type: string, data: EventData): string | null {
  switch (type) {
    case 'message.bounced': {
      const kind = str(data.type)
      const reason = str(data.reason) ?? str(data.summary)
      const description = str(data.description)
      return [kind, reason, description].filter((p): p is string => p !== null).join(': ') || 'bounced'
    }
    case 'message.failed':
    case 'message.transient_error':
      return str(data.reason) ?? str(data.error) ?? type.replace('message.', '')
    case 'message.suppressed':
      return str(data.reason) ?? 'suppressed'
    case 'message.complained':
      return str(data.feedback_type) ?? str(data.type) ?? 'complained'
    default:
      return null
  }
}

// What the webhook payload says about the recipient, if anything —
// stripped before the event is stored (we keep hash + mask on the
// message row instead) and used to key suppressions.
export function recipientFromEventData(data: EventData): string | null {
  const recipient = data.recipient
  if (recipient && typeof recipient === 'object') return str((recipient as EventData).email)
  const to = data.to
  if (to && typeof to === 'object') return str((to as EventData).email)
  return str(recipient) ?? str(to)
}

export function stripRecipientFromEventData(data: EventData): EventData {
  const { recipient: _recipient, to: _to, ...rest } = data
  return rest
}
