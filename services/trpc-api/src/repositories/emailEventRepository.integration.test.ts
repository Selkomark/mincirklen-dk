import { afterAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, runMigrations } from '@mincirklen/shared'
import { insertEmailMessage } from './emailMessageRepository'
import { insertEmailEvent, listEmailEventsForMessage } from './emailEventRepository'

const pool = createPgPool(process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL, 'test')
const db = createDb(pool)

await runMigrations(db, 'test')

afterAll(async () => {
  await db.destroy()
})

describe('emailEventRepository', () => {
  test('inserts once per webhook id and lists a message\'s events in time order', async () => {
    const { id } = await insertEmailMessage(db, {
      templateKey: 'report_received', language: 'en', toEmailMasked: 'a***@x', toEmailHash: crypto.randomUUID(), userId: null,
      subject: 's', variables: {}, provider: 'ahasend', isTest: false,
    })
    const webhookId = crypto.randomUUID()
    const t1 = new Date('2026-10-03T10:00:00Z')
    const t0 = new Date('2026-10-03T09:00:00Z')
    expect(await insertEmailEvent(db, { webhookId, type: 'message.opened', occurredAt: t1, data: { ip: '1.2.3.4' }, messageId: id, providerMessageId: '<p@x>' })).toEqual({ inserted: true })
    expect(await insertEmailEvent(db, { webhookId, type: 'message.opened', occurredAt: t1, data: {}, messageId: id, providerMessageId: '<p@x>' })).toEqual({ inserted: false })
    expect(await insertEmailEvent(db, { webhookId: crypto.randomUUID(), type: 'message.delivered', occurredAt: t0, data: {}, messageId: id, providerMessageId: '<p@x>' })).toEqual({ inserted: true })
    // An account-level event with no message still records.
    expect(await insertEmailEvent(db, { webhookId: crypto.randomUUID(), type: 'domain.dns_error', occurredAt: t0, data: { domain: 'x' }, messageId: null, providerMessageId: null })).toEqual({ inserted: true })

    const events = await listEmailEventsForMessage(db, id)
    expect(events.map((e) => e.type)).toEqual(['message.delivered', 'message.opened'])
    expect(events[1]).toMatchObject({ messageId: id, providerMessageId: '<p@x>', webhookId, data: { ip: '1.2.3.4' } })
    expect(events[1]?.occurredAt.toISOString()).toBe(t1.toISOString())
  })
})
