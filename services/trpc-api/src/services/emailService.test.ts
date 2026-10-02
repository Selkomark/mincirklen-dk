import { describe, expect, test } from 'bun:test'
import { renderEmail } from '@mincirklen/emails'
import type { OutboundEmail } from '../adapters/emailAdapter'
import { sendToAddress, sendToMember, type EmailServiceDeps } from './emailService'

interface Harness {
  deps: EmailServiceDeps
  sent: OutboundEmail[]
  inserted: Parameters<EmailServiceDeps['insertMessage']>[0][]
  marked: { sent: unknown[]; failed: unknown[] }
  logs: string[]
}

function harness(overrides: Partial<EmailServiceDeps> = {}): Harness {
  const sent: OutboundEmail[] = []
  const inserted: Parameters<EmailServiceDeps['insertMessage']>[0][] = []
  const marked = { sent: [] as unknown[], failed: [] as unknown[] }
  const logs: string[] = []
  const deps: EmailServiceDeps = {
    render: renderEmail,
    sender: {
      async sendEmail(message) {
        sent.push(message)
        return { providerMessageId: '<p@x>' }
      },
    },
    provider: 'ahasend',
    hashEmail: (e) => `hash(${e.toLowerCase()})`,
    maskEmail: (e) => `${e[0]}***`,
    insertMessage: async (params) => {
      inserted.push(params)
      return { id: `m${inserted.length}` }
    },
    markSent: async (id, result) => void marked.sent.push({ id, ...result }),
    markFailed: async (id, error) => void marked.failed.push({ id, error }),
    hasActiveSuppression: async () => false,
    findRecipientForUser: async () => ({ email: 'member@example.com', language: 'da' }),
    log: (line) => void logs.push(line),
    ...overrides,
  }
  return { deps, sent, inserted, marked, logs }
}

describe('sendToAddress', () => {
  test('renders, records, sends, and marks the row sent with the provider id', async () => {
    const h = harness()
    const out = await sendToAddress(h.deps, { to: 'Ann@Example.com', templateKey: 'gate_invite', variables: { inviteUrl: 'https://x/?invite=t', gateName: 'Launch' } })
    expect(out).toEqual({ status: 'sent', messageId: 'm1' })
    expect(h.inserted[0]).toMatchObject({
      templateKey: 'gate_invite',
      language: 'en',
      toEmailMasked: 'A***',
      toEmailHash: 'hash(ann@example.com)',
      userId: null,
      subject: 'Your invitation to MinCirklen',
      variables: { inviteUrl: 'https://x/?invite=t', gateName: 'Launch' },
      provider: 'ahasend',
      isTest: false,
    })
    expect(h.inserted[0]?.status).toBeUndefined()
    expect(h.sent[0]).toMatchObject({ to: 'Ann@Example.com', subject: 'Your invitation to MinCirklen' })
    expect(h.sent[0]?.html).toContain('<!doctype html>')
    expect(h.sent[0]?.text).toContain('https://x/?invite=t')
    expect(h.marked.sent[0]).toMatchObject({ id: 'm1', providerMessageId: '<p@x>' })
    expect(h.logs).toEqual([])
  })

  test('a transport failure marks the row failed with the error and does not throw', async () => {
    const h = harness({
      sender: {
        async sendEmail() {
          throw new Error('AhaSend rejected the message (500)')
        },
      },
    })
    const out = await sendToAddress(h.deps, { to: 'a@b.c', templateKey: 'report_received', variables: {} })
    expect(out).toEqual({ status: 'failed', messageId: 'm1' })
    expect(h.marked.failed[0]).toEqual({ id: 'm1', error: 'AhaSend rejected the message (500)' })
    expect(h.logs[0]).toContain('send failed')
  })

  test('a non-Error throw is stringified, and a failing markFailed is logged rather than thrown', async () => {
    const h = harness({
      sender: {
        async sendEmail() {
          throw 'boom'
        },
      },
      markFailed: async () => {
        throw new Error('db down')
      },
    })
    const out = await sendToAddress(h.deps, { to: 'a@b.c', templateKey: 'report_received', variables: {} })
    expect(out.status).toBe('failed')
    expect(h.logs).toEqual(['[EMAIL] send failed', '[EMAIL] could not record the failure'])
  })

  test('a suppressed address is recorded as such and never reaches the transport', async () => {
    const h = harness({ hasActiveSuppression: async (hash) => hash === 'hash(gone@b.c)' })
    const out = await sendToAddress(h.deps, { to: 'gone@b.c', templateKey: 'report_received', variables: {} })
    expect(out).toEqual({ status: 'suppressed', messageId: 'm1' })
    expect(h.inserted[0]).toMatchObject({ status: 'suppressed', error: 'address is suppressed' })
    expect(h.sent).toEqual([])
  })

  test('variables the template rejects fail before anything is recorded', async () => {
    const h = harness()
    const out = await sendToAddress(h.deps, { to: 'a@b.c', templateKey: 'member_warned', variables: { message: '' } })
    expect(out).toEqual({ status: 'failed', messageId: null })
    expect(h.inserted).toEqual([])
    expect(h.logs[0]).toContain('did not render')
  })

  test('database failures around the record are logged and reported as failed', async () => {
    const a = harness({
      hasActiveSuppression: async () => {
        throw new Error('db')
      },
    })
    expect(await sendToAddress(a.deps, { to: 'a@b.c', templateKey: 'report_received', variables: {} })).toEqual({ status: 'failed', messageId: null })
    expect(a.logs[0]).toContain('suppression check failed')
    const b = harness({
      insertMessage: async () => {
        throw new Error('db')
      },
    })
    expect(await sendToAddress(b.deps, { to: 'a@b.c', templateKey: 'report_received', variables: {} })).toEqual({ status: 'failed', messageId: null })
    expect(b.logs[0]).toContain('could not record the message')
  })

  test('passes language, user and test flag through', async () => {
    const h = harness()
    await sendToAddress(h.deps, { to: 'a@b.c', templateKey: 'report_received', variables: {}, language: 'sv', userId: 'u1', isTest: true })
    expect(h.inserted[0]).toMatchObject({ language: 'sv', userId: 'u1', isTest: true })
  })
})

describe('sendToMember', () => {
  test('resolves the address and language and sends to it', async () => {
    const h = harness()
    const out = await sendToMember(h.deps, 'u1', 'report_decided', { status: 'reviewed' })
    expect(out).toEqual({ status: 'sent', messageId: 'm1' })
    expect(h.inserted[0]).toMatchObject({ language: 'da', userId: 'u1', toEmailHash: 'hash(member@example.com)' })
    expect(h.sent[0]?.to).toBe('member@example.com')
  })

  test('falls back to English for an unset or unknown language', async () => {
    const a = harness({ findRecipientForUser: async () => ({ email: 'm@x', language: null }) })
    await sendToMember(a.deps, 'u1', 'report_received', {})
    expect(a.inserted[0]?.language).toBe('en')
    const b = harness({ findRecipientForUser: async () => ({ email: 'm@x', language: 'xx' }) })
    await sendToMember(b.deps, 'u1', 'report_received', {})
    expect(b.inserted[0]?.language).toBe('en')
  })

  test('a member without an address is skipped; a lookup failure is logged', async () => {
    const a = harness({ findRecipientForUser: async () => null })
    expect(await sendToMember(a.deps, 'u1', 'report_received', {})).toEqual({ status: 'skipped', messageId: null })
    expect(a.sent).toEqual([])
    const b = harness({
      findRecipientForUser: async () => {
        throw new Error('kms')
      },
    })
    expect(await sendToMember(b.deps, 'u1', 'report_received', {})).toEqual({ status: 'failed', messageId: null })
    expect(b.logs[0]).toContain('could not resolve the member')
  })
})
