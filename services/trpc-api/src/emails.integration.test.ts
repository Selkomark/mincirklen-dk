import { afterAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, createSessionToken, runMigrations } from '@mincirklen/shared'
import { createApp } from './app'
import type { OutboundEmail } from './adapters/emailAdapter'
import { encryptField } from './adapters/kmsAdapter'
import { hashEmail } from './auth/emailHash'
import { upsertState } from './repositories/featureGateStateRepository'
import { assignRoleToUser, findRoleByName } from './repositories/rbacRepository'
import { linkIdentity } from './repositories/userIdentityRepository'
import { insertUser, setEmail } from './repositories/userRepository'
import { insertEmailMessage, markEmailMessageSent } from './repositories/emailMessageRepository'
import { insertEmailEvent } from './repositories/emailEventRepository'
import { upsertEmailSuppression } from './repositories/emailSuppressionRepository'

const pool = createPgPool(process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL, 'test')
const db = createDb(pool)
await runMigrations(db, 'test')
await upsertState(db, 'platform_launch', { mode: 'open', scheduledOpenAt: null, updatedBy: 'test-setup' })

const AUTH_SECRET = 'emails-integration-test-secret'
const EMAIL_HASH_KEY = 'emails-integration-test-hash-key'
const VAULT = {
  provider: 'vault' as const,
  vaultAddr: process.env.TEST_VAULT_ADDR ?? 'http://localhost:8200',
  vaultToken: process.env.TEST_VAULT_TOKEN ?? 'dev-only-not-for-production',
}

// A recording transport: what the router hands the provider is asserted
// on directly, not inferred from a log line.
const outbound: OutboundEmail[] = []
const app = createApp({
  db,
  authSecret: AUTH_SECRET,
  moderationServiceUrl: 'http://unused.invalid',
  websocketServiceUrl: 'http://unused.invalid',
  internalServiceSecret: 'unused-in-this-test',
  publicBaseUrl: 'https://dev-mincirklen.dk',
  vault: VAULT,
  pubsub: { provider: 'emulator', emulatorUrl: 'http://unused.invalid', projectId: 'unused', topic: 'unused' },
  identityHashKey: 'unused-in-this-test',
  gcs: { provider: 'emulator', apiEndpoint: 'http://unused.invalid', bucket: 'unused' },
  downloadTokenSecret: 'unused-in-this-test',
  trpcPublicBaseUrl: 'https://trpc.dev-mincirklen.dk',
  gateInviteSecret: 'unused-in-this-test',
  emailSender: {
    async sendEmail(message) {
      outbound.push(message)
      return { providerMessageId: `<${crypto.randomUUID()}@test>` }
    },
  },
  emailProvider: 'ahasend',
  emailHashKey: EMAIL_HASH_KEY,
})

afterAll(async () => {
  await db.destroy()
})

async function verifiedUser(roleName: string | null): Promise<{ cookie: string; userId: string }> {
  const user = await insertUser(db)
  const cookie = `mc_session=${createSessionToken(user.id, AUTH_SECRET)}`
  await linkIdentity(db, user.id, 'google', `test-subject-${user.id}`)
  const profileRes = await app.request('/trpc/auth.completeProfile', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ firstName: 'Mod', lastName: 'Test', gender: 'other', country: 'GB', mobileNumber: '+44 20 7946 0958', stayAnonymous: true }),
  })
  expect(profileRes.status).toBe(200)
  if (roleName) {
    const role = await findRoleByName(db, roleName)
    if (!role) throw new Error(`seeded ${roleName} role not found`)
    await assignRoleToUser(db, user.id, role.id)
  }
  return { cookie, userId: user.id }
}

const query = (path: string, input: unknown, cookie: string) =>
  app.request(`/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`, { headers: { cookie } })
const call = (path: string, input: unknown, cookie: string) =>
  app.request(`/trpc/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(input) })
const data = async <T,>(res: Response): Promise<T> => ((await res.json()) as { result: { data: T } }).result.data

describe('emails.* permissions', () => {
  test('every read is forbidden without emails.read; the test send without emails.send_test', async () => {
    const nobody = await verifiedUser('MODERATOR')
    expect((await query('emails.stats', undefined, nobody.cookie)).status).toBe(403)
    expect((await query('emails.list', { limit: 10 }, nobody.cookie)).status).toBe(403)
    expect((await query('emails.get', { id: crypto.randomUUID() }, nobody.cookie)).status).toBe(403)
    expect((await query('emails.suppressions.list', { limit: 10 }, nobody.cookie)).status).toBe(403)
    expect((await query('emails.templates.list', undefined, nobody.cookie)).status).toBe(403)
    expect((await query('emails.templates.preview', { templateKey: 'report_received' }, nobody.cookie)).status).toBe(403)
    expect((await call('emails.sendTest', { templateKey: 'report_received', to: 'x@y.z' }, nobody.cookie)).status).toBe(403)

    // AUDITOR reads but cannot send.
    const auditor = await verifiedUser('AUDITOR')
    expect((await query('emails.templates.list', undefined, auditor.cookie)).status).toBe(200)
    expect((await call('emails.sendTest', { templateKey: 'report_received', to: 'x@y.z' }, auditor.cookie)).status).toBe(403)
  })
})

describe('emails.list / emails.get', () => {
  test('the recipient is masked for everyone and unmasked only for users.read_pii holders with a member row', async () => {
    const member = await insertUser(db)
    const address = `member-${member.id}@example.com`
    await setEmail(db, member.id, await encryptField(VAULT, address))
    const { id } = await insertEmailMessage(db, {
      templateKey: 'report_received', language: 'da', toEmailMasked: 'm***@example.com', toEmailHash: hashEmail(address, EMAIL_HASH_KEY),
      userId: member.id, subject: 'We received your report', variables: {}, provider: 'ahasend', isTest: false,
    })
    await markEmailMessageSent(db, id, { providerMessageId: `<${crypto.randomUUID()}@test>`, sentAt: new Date() })
    await insertEmailEvent(db, { webhookId: crypto.randomUUID(), type: 'message.delivered', occurredAt: new Date(), data: { smtp_code: 250 }, messageId: id, providerMessageId: null })
    const orphan = await insertEmailMessage(db, {
      templateKey: 'gate_invite', language: 'en', toEmailMasked: 'g***@example.com', toEmailHash: hashEmail('g@example.com', EMAIL_HASH_KEY),
      userId: null, subject: 'Your invitation to MinCirklen', variables: { inviteUrl: 'https://x/?invite=t', gateName: 'Platform launch' }, provider: 'ahasend', isTest: false,
    })

    type Msg = { id: string; toEmailMasked: string; toEmail: string | null; status: string; templateKey: string }
    const auditor = await verifiedUser('AUDITOR')
    const auditorList = await data<{ messages: Msg[] }>(await query('emails.list', { limit: 100 }, auditor.cookie))
    const auditorRow = auditorList.messages.find((m) => m.id === id)
    expect(auditorRow).toMatchObject({ toEmailMasked: 'm***@example.com', toEmail: null, status: 'sent', templateKey: 'report_received' })

    const admin = await verifiedUser('ADMIN')
    const adminGet = await data<{ message: Msg & { variables: Record<string, unknown>; language: string }; events: { type: string; data: Record<string, unknown> }[] }>(
      await query('emails.get', { id }, admin.cookie),
    )
    expect(adminGet.message).toMatchObject({ toEmailMasked: 'm***@example.com', toEmail: address, language: 'da' })
    expect(adminGet.events.map((e) => e.type)).toEqual(['message.delivered'])
    expect(adminGet.events[0]?.data).toEqual({ smtp_code: 250 })

    // No member row to decrypt from: masked even for an admin.
    const orphanGet = await data<{ message: Msg }>(await query('emails.get', { id: orphan.id }, admin.cookie))
    expect(orphanGet.message.toEmail).toBeNull()
    expect(orphanGet.message.toEmailMasked).toBe('g***@example.com')

    const filtered = await data<{ messages: Msg[] }>(await query('emails.list', { templateKey: 'gate_invite', limit: 100 }, admin.cookie))
    expect(filtered.messages.every((m) => m.templateKey === 'gate_invite')).toBe(true)
    expect(filtered.messages.some((m) => m.id === orphan.id)).toBe(true)

    expect((await query('emails.get', { id: crypto.randomUUID() }, admin.cookie)).status).toBe(404)
  })

  test('stats and suppressions are readable', async () => {
    const admin = await verifiedUser('ADMIN')
    const stats = await data<{ windowDays: number; sent: number; delivered: number; bounced: number; opened: number; complained: number }>(await query('emails.stats', undefined, admin.cookie))
    expect(stats.windowDays).toBe(30)
    for (const key of ['sent', 'delivered', 'bounced', 'opened', 'complained'] as const) expect(typeof stats[key]).toBe('number')

    await upsertEmailSuppression(db, { recipientHash: crypto.randomUUID(), recipientMasked: 's***@example.com', sendingDomain: 'send.x', reason: 'hard bounce', expiresAt: null, raw: {} })
    const sup = await data<{ suppressions: { recipientMasked: string; reason: string | null }[] }>(await query('emails.suppressions.list', { limit: 100 }, admin.cookie))
    expect(sup.suppressions.some((s) => s.recipientMasked === 's***@example.com' && s.reason === 'hard bounce')).toBe(true)
    expect(JSON.stringify(sup)).not.toContain('recipientHash')
  })
})

describe('emails.templates.* and emails.sendTest', () => {
  test('the catalog lists every template; preview renders with sample or given variables; bad variables are a 400', async () => {
    const admin = await verifiedUser('ADMIN')
    const catalog = await data<{ templates: { key: string; description: string; sampleVariables: Record<string, unknown> }[]; languages: string[] }>(await query('emails.templates.list', undefined, admin.cookie))
    expect(catalog.templates.map((t) => t.key)).toContain('gate_invite')
    expect(catalog.languages).toEqual(['en', 'sv', 'da'])

    const sample = await data<{ subject: string; html: string; text: string }>(await query('emails.templates.preview', { templateKey: 'member_warned' }, admin.cookie))
    expect(sample.subject).toBe('A note from the MinCirklen moderators')
    expect(sample.html).toStartWith('<!doctype html>')

    const custom = await data<{ text: string }>(await query('emails.templates.preview', { templateKey: 'member_warned', language: 'da', variables: { message: 'Custom words.' } }, admin.cookie))
    expect(custom.text).toContain('Custom words.')

    expect((await query('emails.templates.preview', { templateKey: 'member_warned', variables: { message: '' } }, admin.cookie)).status).toBe(400)
    expect((await query('emails.templates.preview', { templateKey: 'not_a_template' }, admin.cookie)).status).toBe(400)
  })

  test('a test send goes through the transport, is recorded as a test, and never stores the address', async () => {
    const admin = await verifiedUser('ADMIN')
    const to = `Tester-${crypto.randomUUID()}@Example.com`
    const before = outbound.length
    const res = await call('emails.sendTest', { templateKey: 'gate_invite', to, language: 'sv' }, admin.cookie)
    expect(res.status).toBe(200)
    const outcome = await data<{ status: string; messageId: string | null }>(res)
    expect(outcome.status).toBe('sent')
    expect(outbound.length).toBe(before + 1)
    expect(outbound[before]).toMatchObject({ to: to.toLowerCase(), subject: 'Your invitation to MinCirklen' })
    expect(outbound[before]?.text).toContain('Platform launch')

    const row = await db.selectFrom('email_messages').selectAll().where('id', '=', outcome.messageId as string).executeTakeFirstOrThrow()
    expect(row).toMatchObject({ is_test: true, status: 'sent', language: 'sv', user_id: null, template_key: 'gate_invite' })
    expect(row.to_email_hash).toBe(hashEmail(to, EMAIL_HASH_KEY))
    expect(JSON.stringify(row)).not.toContain(to.toLowerCase())

    expect((await call('emails.sendTest', { templateKey: 'member_warned', to, variables: { message: '' } }, admin.cookie)).status).toBe(400)
    expect((await call('emails.sendTest', { templateKey: 'gate_invite', to: 'not-an-email' }, admin.cookie)).status).toBe(400)
  })
})
