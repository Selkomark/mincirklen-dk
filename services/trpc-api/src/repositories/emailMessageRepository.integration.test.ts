import { afterAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, runMigrations } from '@mincirklen/shared'
import { insertUser } from './userRepository'
import { insertEmailEvent } from './emailEventRepository'
import {
  findEmailMessageById,
  findEmailMessageByProviderMessageId,
  getEmailStats,
  insertEmailMessage,
  listEmailMessages,
  markEmailMessageFailed,
  markEmailMessageSent,
  updateEmailMessageStatus,
} from './emailMessageRepository'

const pool = createPgPool(process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL, 'test')
const db = createDb(pool)

await runMigrations(db, 'test')

afterAll(async () => {
  await db.destroy()
})

function params(overrides: Partial<Parameters<typeof insertEmailMessage>[1]> = {}): Parameters<typeof insertEmailMessage>[1] {
  return {
    templateKey: 'report_received',
    language: 'en',
    toEmailMasked: 'a***@example.com',
    toEmailHash: crypto.randomUUID(),
    userId: null,
    subject: 'We received your report',
    variables: {},
    provider: 'log',
    isTest: false,
    ...overrides,
  }
}

describe('emailMessageRepository', () => {
  test('a message starts queued, becomes sent with the provider id, and is found by it', async () => {
    const user = await insertUser(db)
    const { id } = await insertEmailMessage(db, params({ userId: user.id, variables: { status: 'reviewed' }, templateKey: 'report_decided' }))
    let detail = await findEmailMessageById(db, id)
    expect(detail?.status).toBe('queued')
    expect(detail?.userId).toBe(user.id)
    expect(detail?.variables).toEqual({ status: 'reviewed' })
    expect(detail?.sentAt).toBeNull()

    const providerId = `<${crypto.randomUUID()}@x>`
    await markEmailMessageSent(db, id, { providerMessageId: providerId, sentAt: new Date() })
    detail = await findEmailMessageById(db, id)
    expect(detail?.status).toBe('sent')
    expect(detail?.providerMessageId).toBe(providerId)
    expect(detail?.sentAt).not.toBeNull()
    expect(await findEmailMessageByProviderMessageId(db, providerId)).toEqual({ id, status: 'sent' })
    expect(await findEmailMessageByProviderMessageId(db, 'nope')).toBeNull()

    await updateEmailMessageStatus(db, id, { status: 'delivered', lastEventAt: new Date() })
    expect((await findEmailMessageById(db, id))?.status).toBe('delivered')
    await updateEmailMessageStatus(db, id, { status: 'bounced', lastEventAt: new Date(), error: 'hard: gone' })
    detail = await findEmailMessageById(db, id)
    expect(detail?.status).toBe('bounced')
    expect(detail?.error).toBe('hard: gone')
    expect(detail?.lastEventAt).not.toBeNull()
  })

  test('a failed send keeps the error; a suppressed send can be inserted already-terminal', async () => {
    const { id } = await insertEmailMessage(db, params())
    await markEmailMessageFailed(db, id, 'AhaSend 500')
    expect(await findEmailMessageById(db, id)).toMatchObject({ status: 'failed', error: 'AhaSend 500' })

    const sup = await insertEmailMessage(db, params({ status: 'suppressed', error: 'address suppressed' }))
    expect(await findEmailMessageById(db, sup.id)).toMatchObject({ status: 'suppressed', error: 'address suppressed' })
    expect(await findEmailMessageById(db, crypto.randomUUID())).toBeNull()
  })

  test('lists newest first with a stable cursor, filtered by status and template', async () => {
    const hash = crypto.randomUUID()
    const ids: string[] = []
    for (let i = 0; i < 3; i++) ids.push((await insertEmailMessage(db, params({ toEmailHash: hash, templateKey: 'gate_invite' }))).id)
    await markEmailMessageFailed(db, ids[1] as string, 'x')

    const page1 = await listEmailMessages(db, { templateKey: 'gate_invite', limit: 2 })
    expect(page1.messages.length).toBe(2)
    expect(page1.nextCursor).not.toBeNull()
    const page2 = await listEmailMessages(db, { templateKey: 'gate_invite', cursor: page1.nextCursor as string, limit: 2 })
    const seen = [...page1.messages, ...page2.messages].map((m) => m.id)
    expect(new Set(seen).size).toBe(seen.length)
    for (const id of ids) expect(seen).toContain(id)
    expect(page1.messages[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(page1.messages[1]?.createdAt.getTime() as number)

    const failed = await listEmailMessages(db, { status: 'failed', templateKey: 'gate_invite', limit: 50 })
    expect(failed.messages.some((m) => m.id === ids[1])).toBe(true)
    expect(failed.messages.every((m) => m.status === 'failed')).toBe(true)
    expect(() => listEmailMessages(db, { cursor: 'bad', limit: 1 })).toThrow('invalid cursor')
  })

  test('stats count accepted sends and distinct event types inside the window, excluding tests', async () => {
    const since = new Date(Date.now() - 60_000)
    const before = await getEmailStats(db, since)

    const a = await insertEmailMessage(db, params())
    await markEmailMessageSent(db, a.id, { providerMessageId: `<${crypto.randomUUID()}@x>`, sentAt: new Date() })
    const b = await insertEmailMessage(db, params({ isTest: true }))
    await markEmailMessageSent(db, b.id, { providerMessageId: `<${crypto.randomUUID()}@x>`, sentAt: new Date() })
    const old = await insertEmailMessage(db, params())
    await markEmailMessageSent(db, old.id, { providerMessageId: null, sentAt: new Date(Date.now() - 86_400_000) })

    const ev = (messageId: string, type: string, occurredAt = new Date()) =>
      insertEmailEvent(db, { webhookId: crypto.randomUUID(), type, occurredAt, data: {}, messageId, providerMessageId: null })
    await ev(a.id, 'message.delivered')
    await ev(a.id, 'message.opened')
    await ev(a.id, 'message.opened')
    await ev(b.id, 'message.delivered')
    await ev(a.id, 'message.bounced', new Date(Date.now() - 86_400_000))

    const after = await getEmailStats(db, since)
    expect(after.sent - before.sent).toBe(1)
    expect(after.delivered - before.delivered).toBe(1)
    expect(after.opened - before.opened).toBe(1)
    expect(after.bounced - before.bounced).toBe(0)
    expect(after.complained - before.complained).toBe(0)
  })
})
