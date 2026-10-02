import { afterAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, runMigrations } from '@mincirklen/shared'
import { createApp } from './app'
import { createLoggingEmailSender } from './adapters/emailAdapter'
import { signStandardWebhook } from './auth/standardWebhookSignature'
import { hashEmail } from './auth/emailHash'
import { insertEmailMessage, markEmailMessageSent, findEmailMessageById } from './repositories/emailMessageRepository'
import { listEmailEventsForMessage } from './repositories/emailEventRepository'
import { hasActiveSuppression } from './repositories/emailSuppressionRepository'

const pool = createPgPool(process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL, 'test')
const db = createDb(pool)
await runMigrations(db, 'test')

const SECRET = 'whsec_' + Buffer.from('email-webhook-integration-test-secret').toString('base64')
const EMAIL_HASH_KEY = 'email-webhook-integration-test-hash-key'

function env(overrides: Partial<Parameters<typeof createApp>[0]> = {}): Parameters<typeof createApp>[0] {
  return {
    db,
    authSecret: 'unused-in-this-test',
    moderationServiceUrl: 'http://unused.invalid',
    websocketServiceUrl: 'http://unused.invalid',
    internalServiceSecret: 'unused-in-this-test',
    publicBaseUrl: 'https://dev-mincirklen.dk',
    vault: { provider: 'vault', vaultAddr: process.env.TEST_VAULT_ADDR ?? 'http://localhost:8200', vaultToken: process.env.TEST_VAULT_TOKEN ?? 'dev-only-not-for-production' },
    pubsub: { provider: 'emulator', emulatorUrl: 'http://unused.invalid', projectId: 'unused', topic: 'unused' },
    identityHashKey: 'unused-in-this-test',
    gcs: { provider: 'emulator', apiEndpoint: 'http://unused.invalid', bucket: 'unused' },
    downloadTokenSecret: 'unused-in-this-test',
    trpcPublicBaseUrl: 'https://trpc.dev-mincirklen.dk',
    gateInviteSecret: 'unused-in-this-test',
    emailSender: createLoggingEmailSender(() => {}),
    emailProvider: 'ahasend',
    emailHashKey: EMAIL_HASH_KEY,
    emailWebhookSecret: SECRET,
    ...overrides,
  }
}

const app = createApp(env())

afterAll(async () => {
  await db.destroy()
})

async function post(body: string, opts: { webhookId?: string; secret?: string; timestamp?: string; app?: ReturnType<typeof createApp>; unsigned?: boolean } = {}) {
  const webhookId = opts.webhookId ?? `wh-${crypto.randomUUID()}`
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000))
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (!opts.unsigned) {
    headers['webhook-id'] = webhookId
    headers['webhook-timestamp'] = timestamp
    headers['webhook-signature'] = signStandardWebhook(webhookId, timestamp, body, opts.secret ?? SECRET)
  }
  return (opts.app ?? app).request('/webhooks/ahasend', { method: 'POST', headers, body })
}

async function seedSentMessage(): Promise<{ id: string; providerMessageId: string }> {
  const providerMessageId = `<${crypto.randomUUID()}@send.ahasend.com>`
  const { id } = await insertEmailMessage(db, {
    templateKey: 'report_received', language: 'en', toEmailMasked: 'm***@example.com', toEmailHash: hashEmail('member@example.com', EMAIL_HASH_KEY),
    userId: null, subject: 'We received your report', variables: {}, provider: 'ahasend', isTest: false,
  })
  await markEmailMessageSent(db, id, { providerMessageId, sentAt: new Date() })
  return { id, providerMessageId }
}

describe('POST /webhooks/ahasend', () => {
  test('a signed delivery event updates the message and is recorded once, even when replayed', async () => {
    const { id, providerMessageId } = await seedSentMessage()
    const body = JSON.stringify({ type: 'message.delivered', timestamp: new Date().toISOString(), data: { message_id_header: providerMessageId, recipient: { email: 'member@example.com' } } })
    const webhookId = `wh-${crypto.randomUUID()}`

    const first = await post(body, { webhookId })
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ ok: true, result: 'applied' })
    expect((await findEmailMessageById(db, id))?.status).toBe('delivered')

    const replay = await post(body, { webhookId })
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual({ ok: true, result: 'duplicate' })

    const events = await listEmailEventsForMessage(db, id)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('message.delivered')
    expect(JSON.stringify(events[0]?.data)).not.toContain('member@example.com')
  })

  test('a bounce after delivery sticks; a later open does not undo it', async () => {
    const { id, providerMessageId } = await seedSentMessage()
    await post(JSON.stringify({ type: 'message.delivered', data: { id: providerMessageId } }))
    await post(JSON.stringify({ type: 'message.bounced', data: { id: providerMessageId, type: 'hard', reason: 'mailbox does not exist' } }))
    expect(await findEmailMessageById(db, id)).toMatchObject({ status: 'bounced', error: 'hard: mailbox does not exist' })
    await post(JSON.stringify({ type: 'message.opened', data: { id: providerMessageId } }))
    expect((await findEmailMessageById(db, id))?.status).toBe('bounced')
    expect((await listEmailEventsForMessage(db, id)).map((e) => e.type)).toEqual(['message.delivered', 'message.bounced', 'message.opened'])
  })

  test('suppression.created records a suppression that the send path then honours', async () => {
    const address = `gone-${crypto.randomUUID()}@example.com`
    const res = await post(JSON.stringify({ type: 'suppression.created', data: { recipient: address, sending_domain: 'send.mincirklen.dk', reason: 'hard bounce' } }))
    expect(await res.json()).toEqual({ ok: true, result: 'recorded' })
    expect(await hasActiveSuppression(db, hashEmail(address, EMAIL_HASH_KEY))).toBe(true)
  })

  test('an event for a message we never sent is stored as unmatched', async () => {
    const res = await post(JSON.stringify({ type: 'message.opened', data: { id: `<${crypto.randomUUID()}@elsewhere>` } }))
    expect(await res.json()).toEqual({ ok: true, result: 'unmatched' })
  })

  test('rejects an unsigned, wrongly signed, or stale delivery with 401', async () => {
    const body = JSON.stringify({ type: 'message.delivered', data: {} })
    expect((await post(body, { unsigned: true })).status).toBe(401)
    expect((await post(body, { secret: 'whsec_' + Buffer.from('someone-else').toString('base64') })).status).toBe(401)
    expect((await post(body, { timestamp: String(Math.floor(Date.now() / 1000) - 3600) })).status).toBe(401)
  })

  test('rejects a signed body that is not an event with 400', async () => {
    expect((await post('not json {')).status).toBe(400)
    expect((await post(JSON.stringify({ data: {} }))).status).toBe(400)
  })

  test('answers 503 when no webhook secret is configured', async () => {
    const unconfigured = createApp(env({ emailWebhookSecret: undefined }))
    const res = await post(JSON.stringify({ type: 'message.delivered', data: {} }), { app: unconfigured })
    expect(res.status).toBe(503)
  })

  test('answers 500 when the event cannot be stored, so the provider retries', async () => {
    const broken = createApp(env({ db: { ...db, insertInto: () => { throw new Error('db down') } } as unknown as typeof db }))
    const original = console.error
    console.error = () => {}
    try {
      const res = await post(JSON.stringify({ type: 'message.delivered', data: { id: '<x@y>' } }), { app: broken })
      expect(res.status).toBe(500)
    } finally {
      console.error = original
    }
  })
})
