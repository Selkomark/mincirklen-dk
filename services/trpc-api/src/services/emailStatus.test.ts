import { describe, expect, test } from 'bun:test'
import { EMAIL_STATUSES } from '@mincirklen/shared'
import {
  errorFromEventData,
  isTerminalEmailStatus,
  nextEmailStatus,
  providerMessageIdFromEventData,
  recipientFromEventData,
  statusForWebhookEventType,
  stripRecipientFromEventData,
} from './emailStatus'

describe('nextEmailStatus', () => {
  test('moves forward along the happy path and never backwards', () => {
    expect(nextEmailStatus('queued', 'sent')).toBe('sent')
    expect(nextEmailStatus('sent', 'accepted')).toBe('accepted')
    expect(nextEmailStatus('accepted', 'delivered')).toBe('delivered')
    expect(nextEmailStatus('delivered', 'opened')).toBe('opened')
    expect(nextEmailStatus('opened', 'clicked')).toBe('clicked')
    expect(nextEmailStatus('clicked', 'opened')).toBe('clicked')
    expect(nextEmailStatus('delivered', 'accepted')).toBe('delivered')
    expect(nextEmailStatus('delivered', 'delayed')).toBe('delivered')
    expect(nextEmailStatus('delivered', 'delivered')).toBe('delivered')
  })

  test('a failure wins over any progress, and sticks', () => {
    for (const terminal of ['bounced', 'failed', 'suppressed', 'complained'] as const) {
      expect(isTerminalEmailStatus(terminal)).toBe(true)
      expect(nextEmailStatus('clicked', terminal)).toBe(terminal)
      expect(nextEmailStatus(terminal, 'delivered')).toBe(terminal)
      expect(nextEmailStatus(terminal, 'opened')).toBe(terminal)
    }
    expect(nextEmailStatus('bounced', 'complained')).toBe('bounced')
    expect(isTerminalEmailStatus('delivered')).toBe(false)
  })

  test('every status has a rank', () => {
    for (const s of EMAIL_STATUSES) expect(nextEmailStatus(s, s)).toBe(s)
  })
})

describe('statusForWebhookEventType', () => {
  test('maps the provider event types and ignores the rest', () => {
    expect(statusForWebhookEventType('message.reception')).toBe('accepted')
    expect(statusForWebhookEventType('message.sent')).toBe('delivered')
    expect(statusForWebhookEventType('message.delivered')).toBe('delivered')
    expect(statusForWebhookEventType('message.transient_error')).toBe('delayed')
    expect(statusForWebhookEventType('message.opened')).toBe('opened')
    expect(statusForWebhookEventType('message.clicked')).toBe('clicked')
    expect(statusForWebhookEventType('message.bounced')).toBe('bounced')
    expect(statusForWebhookEventType('message.failed')).toBe('failed')
    expect(statusForWebhookEventType('message.suppressed')).toBe('suppressed')
    expect(statusForWebhookEventType('message.complained')).toBe('complained')
    expect(statusForWebhookEventType('suppression.created')).toBeNull()
    expect(statusForWebhookEventType('message.future_thing')).toBeNull()
  })
})

describe('event data helpers', () => {
  test('finds the provider message id in each payload shape, preferring the header', () => {
    expect(providerMessageIdFromEventData({ message_id_header: '<h@x>', message: { id: 'n' }, id: 'i' })).toBe('<h@x>')
    expect(providerMessageIdFromEventData({ message: { id: 'n' }, id: 'i' })).toBe('n')
    expect(providerMessageIdFromEventData({ message: 'not-an-object', id: 'i' })).toBe('i')
    expect(providerMessageIdFromEventData({ message: { id: '' }, id: 'i' })).toBe('i')
    expect(providerMessageIdFromEventData({})).toBeNull()
  })

  test('summarises a failure for the error column', () => {
    expect(errorFromEventData('message.bounced', { type: 'hard', reason: 'mailbox full', description: 'd' })).toBe('hard: mailbox full: d')
    expect(errorFromEventData('message.bounced', { summary: 'no such user' })).toBe('no such user')
    expect(errorFromEventData('message.bounced', {})).toBe('bounced')
    expect(errorFromEventData('message.failed', { error: 'dns' })).toBe('dns')
    expect(errorFromEventData('message.failed', { reason: 'r' })).toBe('r')
    expect(errorFromEventData('message.transient_error', {})).toBe('transient_error')
    expect(errorFromEventData('message.suppressed', { reason: 'bounced before' })).toBe('bounced before')
    expect(errorFromEventData('message.suppressed', {})).toBe('suppressed')
    expect(errorFromEventData('message.complained', { feedback_type: 'abuse' })).toBe('abuse')
    expect(errorFromEventData('message.complained', { type: 'spam' })).toBe('spam')
    expect(errorFromEventData('message.complained', {})).toBe('complained')
    expect(errorFromEventData('message.delivered', {})).toBeNull()
  })

  test('extracts and strips the recipient', () => {
    expect(recipientFromEventData({ recipient: { email: 'a@b.c' } })).toBe('a@b.c')
    expect(recipientFromEventData({ to: { email: 'a@b.c' } })).toBe('a@b.c')
    expect(recipientFromEventData({ recipient: 'a@b.c' })).toBe('a@b.c')
    expect(recipientFromEventData({ to: 'a@b.c' })).toBe('a@b.c')
    expect(recipientFromEventData({ recipient: { name: 'x' } })).toBeNull()
    expect(recipientFromEventData({})).toBeNull()
    expect(stripRecipientFromEventData({ recipient: 'a@b.c', to: { email: 'a@b.c' }, id: 'i' })).toEqual({ id: 'i' })
  })
})
