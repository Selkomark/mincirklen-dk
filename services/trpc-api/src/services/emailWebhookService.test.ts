import { describe, expect, test } from 'bun:test'
import type { EmailStatus } from '@mincirklen/shared'
import { ahasendWebhookEventSchema, applyWebhookEvent, type ApplyWebhookEventDeps } from './emailWebhookService'

interface Harness {
  deps: ApplyWebhookEventDeps
  events: Parameters<ApplyWebhookEventDeps['insertEvent']>[0][]
  updates: { id: string; status: EmailStatus; lastEventAt: Date; error?: string | null }[]
  suppressions: Parameters<ApplyWebhookEventDeps['upsertSuppression']>[0][]
  warnings: string[]
}

function harness(opts: { message?: { id: string; status: EmailStatus } | null; duplicate?: boolean } = {}): Harness {
  const events: Harness['events'] = []
  const updates: Harness['updates'] = []
  const suppressions: Harness['suppressions'] = []
  const warnings: string[] = []
  const deps: ApplyWebhookEventDeps = {
    insertEvent: async (params) => {
      events.push(params)
      return { inserted: !opts.duplicate }
    },
    findMessageByProviderId: async (id) => (id === '<m1@x>' ? (opts.message === undefined ? { id: 'msg-1', status: 'sent' } : opts.message) : null),
    updateMessageStatus: async (id, params) => void updates.push({ id, ...params }),
    upsertSuppression: async (params) => void suppressions.push(params),
    hashEmail: (e) => `hash(${e})`,
    maskEmail: (e) => `${e[0]}***`,
    warn: (line) => void warnings.push(line),
  }
  return { deps, events, updates, suppressions, warnings }
}

const AT = '2026-10-03T12:00:00.000Z'

describe('applyWebhookEvent', () => {
  test('a delivery for a message we sent is stored (without the recipient) and moves the status', async () => {
    const h = harness()
    const result = await applyWebhookEvent(h.deps, {
      webhookId: 'wh-1',
      event: { type: 'message.delivered', timestamp: AT, data: { message_id_header: '<m1@x>', recipient: { email: 'a@b.c' }, to: 'a@b.c', smtp_code: 250 } },
    })
    expect(result).toBe('applied')
    expect(h.events[0]).toEqual({ webhookId: 'wh-1', type: 'message.delivered', occurredAt: new Date(AT), data: { message_id_header: '<m1@x>', smtp_code: 250 }, messageId: 'msg-1', providerMessageId: '<m1@x>' })
    expect(h.updates).toEqual([{ id: 'msg-1', status: 'delivered', lastEventAt: new Date(AT), error: null }])
  })

  test('a replayed webhook id changes nothing', async () => {
    const h = harness({ duplicate: true })
    expect(await applyWebhookEvent(h.deps, { webhookId: 'wh-1', event: { type: 'message.delivered', data: { id: '<m1@x>' } } })).toBe('duplicate')
    expect(h.updates).toEqual([])
  })

  test('a status that would move backwards only refreshes the last-event time', async () => {
    const h = harness({ message: { id: 'msg-1', status: 'opened' } })
    await applyWebhookEvent(h.deps, { webhookId: 'wh-2', event: { type: 'message.delivered', timestamp: AT, data: { id: '<m1@x>' } } })
    expect(h.updates).toEqual([{ id: 'msg-1', status: 'opened', lastEventAt: new Date(AT) }])
  })

  test('a bounce becomes terminal and carries its reason into the error column', async () => {
    const h = harness({ message: { id: 'msg-1', status: 'delivered' } })
    await applyWebhookEvent(h.deps, { webhookId: 'wh-3', event: { type: 'message.bounced', data: { id: '<m1@x>', type: 'hard', reason: 'no such user' } } })
    expect(h.updates[0]).toMatchObject({ status: 'bounced', error: 'hard: no such user' })
  })

  test('an unmapped message event is stored and leaves the status alone', async () => {
    const h = harness()
    expect(await applyWebhookEvent(h.deps, { webhookId: 'wh-4', event: { type: 'message.something_new', data: { id: '<m1@x>' } } })).toBe('applied')
    expect(h.updates).toEqual([])
  })

  test('a message event we have no row for is stored as unmatched', async () => {
    const h = harness()
    expect(await applyWebhookEvent(h.deps, { webhookId: 'wh-5', event: { type: 'message.opened', data: { id: '<unknown@x>' } } })).toBe('unmatched')
    expect(h.events[0]?.messageId).toBeNull()
    expect(h.events[0]?.providerMessageId).toBe('<unknown@x>')
    expect(await applyWebhookEvent(h.deps, { webhookId: 'wh-6', event: { type: 'message.opened', data: {} } })).toBe('unmatched')
    expect(h.updates).toEqual([])
  })

  test('suppression.created upserts a hashed, masked suppression', async () => {
    const h = harness()
    const result = await applyWebhookEvent(h.deps, {
      webhookId: 'wh-7',
      event: { type: 'suppression.created', data: { recipient: 'gone@b.c', sending_domain: 'mail.x', reason: 'hard bounce', expires_at: AT } },
    })
    expect(result).toBe('recorded')
    expect(h.suppressions[0]).toEqual({ recipientHash: 'hash(gone@b.c)', recipientMasked: 'g***', sendingDomain: 'mail.x', reason: 'hard bounce', expiresAt: new Date(AT), raw: { sending_domain: 'mail.x', reason: 'hard bounce', expires_at: AT } })
    expect(h.events[0]?.data).not.toHaveProperty('recipient')
    expect(h.events[0]?.messageId).toBeNull()
  })

  test('suppression.created without a recipient is recorded and warned about', async () => {
    const h = harness()
    expect(await applyWebhookEvent(h.deps, { webhookId: 'wh-8', event: { type: 'suppression.created', data: { reason: 'x', expires_at: 'not a date' } } })).toBe('recorded')
    expect(h.suppressions).toEqual([])
    expect(h.warnings[0]).toContain('without a recipient')
  })

  test('domain.dns_error is recorded and warned about; other account events are just recorded', async () => {
    const h = harness()
    expect(await applyWebhookEvent(h.deps, { webhookId: 'wh-9', event: { type: 'domain.dns_error', data: { domain: 'mail.x', error: 'SPF missing' } } })).toBe('recorded')
    expect(h.warnings[0]).toContain('DNS problem')
    expect(await applyWebhookEvent(h.deps, { webhookId: 'wh-10', event: { type: 'account.something', data: {} } })).toBe('recorded')
  })

  test('falls back to the receipt time when the event carries no usable timestamp', async () => {
    const h = harness()
    const receivedAt = new Date('2026-10-03T13:00:00Z')
    await applyWebhookEvent(h.deps, { webhookId: 'wh-11', event: { type: 'message.opened', timestamp: 'garbage', data: { id: '<m1@x>' } }, receivedAt })
    expect(h.events[0]?.occurredAt).toEqual(receivedAt)
    await applyWebhookEvent(h.deps, { webhookId: 'wh-12', event: { type: 'message.opened', data: { id: '<m1@x>' } } })
    expect(h.events[1]?.occurredAt).toBeInstanceOf(Date)
  })
})

describe('ahasendWebhookEventSchema', () => {
  test('requires a type and defaults data to an empty object', () => {
    expect(ahasendWebhookEventSchema.parse({ type: 'message.sent' })).toEqual({ type: 'message.sent', data: {} })
    expect(ahasendWebhookEventSchema.safeParse({ data: {} }).success).toBe(false)
    expect(ahasendWebhookEventSchema.safeParse({ type: '', data: {} }).success).toBe(false)
  })
})
