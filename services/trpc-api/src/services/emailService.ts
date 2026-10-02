import type { Kysely } from 'kysely'
import { emailLanguageSchema, type Database, type EmailLanguage, type EmailProvider, type EmailStatus, type EmailTemplateKey } from '@mincirklen/shared'
import { renderEmail, type EmailVariables, type RenderedEmail } from '@mincirklen/emails'
import type { EmailSender } from '../adapters/emailAdapter'
import type { AppEnv } from '../context'
import { hashEmail } from '../auth/emailHash'
import { maskEmail } from '../repositories/rbacRepository'
import { findEmailAndLanguageForUser } from '../repositories/userRepository'
import { insertEmailMessage, markEmailMessageFailed, markEmailMessageSent } from '../repositories/emailMessageRepository'
import { hasActiveSuppression } from '../repositories/emailSuppressionRepository'

// Sending one email: render the template, write the record, hand it to
// the transport, record how that went. Best-effort throughout — a
// report, a decision or a ban must not fail because an email didn't go
// out. The record is the source of truth; the email is a courtesy, and
// the record of the email (email_messages) is how a human finds out it
// didn't arrive.

export interface EmailServiceDeps {
  render: (templateKey: EmailTemplateKey, language: EmailLanguage, variables: unknown) => RenderedEmail
  sender: EmailSender
  provider: EmailProvider
  hashEmail: (email: string) => string
  maskEmail: (email: string) => string
  insertMessage: (params: {
    templateKey: EmailTemplateKey
    language: EmailLanguage
    toEmailMasked: string
    toEmailHash: string
    userId: string | null
    subject: string
    variables: Record<string, unknown>
    provider: EmailProvider
    isTest: boolean
    status?: EmailStatus
    error?: string | null
  }) => Promise<{ id: string }>
  markSent: (id: string, result: { providerMessageId: string | null; sentAt: Date }) => Promise<void>
  markFailed: (id: string, error: string) => Promise<void>
  hasActiveSuppression: (recipientHash: string) => Promise<boolean>
  findRecipientForUser: (userId: string) => Promise<{ email: string; language: string | null } | null>
  log: (line: string, meta?: unknown) => void
}

export interface SendOutcome {
  status: 'sent' | 'suppressed' | 'failed' | 'skipped'
  messageId: string | null
}

export interface SendToAddressParams<K extends EmailTemplateKey> {
  to: string
  templateKey: K
  variables: EmailVariables<K>
  language?: EmailLanguage
  userId?: string | null
  isTest?: boolean
}

export async function sendToAddress<K extends EmailTemplateKey>(deps: EmailServiceDeps, params: SendToAddressParams<K>): Promise<SendOutcome> {
  const language = params.language ?? 'en'
  const variables = params.variables as Record<string, unknown>
  let rendered: RenderedEmail
  try {
    rendered = deps.render(params.templateKey, language, variables)
  } catch (err) {
    // A call site passed variables the template rejects: a bug, not a
    // delivery problem. Nothing to record against a recipient yet.
    deps.log('[EMAIL] template did not render', { templateKey: params.templateKey, err })
    return { status: 'failed', messageId: null }
  }

  const base = {
    templateKey: params.templateKey,
    language,
    toEmailMasked: deps.maskEmail(params.to),
    toEmailHash: deps.hashEmail(params.to),
    userId: params.userId ?? null,
    subject: rendered.subject,
    variables,
    provider: deps.provider,
    isTest: params.isTest ?? false,
  }

  try {
    if (await deps.hasActiveSuppression(base.toEmailHash)) {
      // The provider has told us it won't deliver here; don't keep asking.
      const { id } = await deps.insertMessage({ ...base, status: 'suppressed', error: 'address is suppressed' })
      return { status: 'suppressed', messageId: id }
    }
  } catch (err) {
    deps.log('[EMAIL] suppression check failed', { templateKey: params.templateKey, err })
    return { status: 'failed', messageId: null }
  }

  let messageId: string
  try {
    messageId = (await deps.insertMessage(base)).id
  } catch (err) {
    deps.log('[EMAIL] could not record the message', { templateKey: params.templateKey, err })
    return { status: 'failed', messageId: null }
  }

  try {
    const result = await deps.sender.sendEmail({ to: params.to, subject: rendered.subject, html: rendered.html, text: rendered.text })
    await deps.markSent(messageId, { providerMessageId: result.providerMessageId, sentAt: new Date() })
    return { status: 'sent', messageId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.log('[EMAIL] send failed', { templateKey: params.templateKey, messageId, err })
    await deps.markFailed(messageId, message).catch((markErr: unknown) => deps.log('[EMAIL] could not record the failure', { messageId, markErr }))
    return { status: 'failed', messageId }
  }
}

// To a member, in their own language where they've set one. A member
// with no address on file (fully anonymous accounts, legacy rows) is
// skipped — there's nobody to write to.
export async function sendToMember<K extends EmailTemplateKey>(
  deps: EmailServiceDeps,
  userId: string,
  templateKey: K,
  variables: EmailVariables<K>,
): Promise<SendOutcome> {
  let recipient: { email: string; language: string | null } | null
  try {
    recipient = await deps.findRecipientForUser(userId)
  } catch (err) {
    deps.log('[EMAIL] could not resolve the member', { userId, templateKey, err })
    return { status: 'failed', messageId: null }
  }
  if (!recipient) return { status: 'skipped', messageId: null }
  const parsedLanguage = emailLanguageSchema.safeParse(recipient.language)
  return sendToAddress(deps, {
    to: recipient.email,
    templateKey,
    variables,
    language: parsedLanguage.success ? parsedLanguage.data : 'en',
    userId,
  })
}

// The real wiring, for routers: everything above bound to the app's
// database, KMS and configured transport.
export function createEmailServiceDeps(env: Pick<AppEnv, 'db' | 'vault' | 'emailSender' | 'emailProvider' | 'emailHashKey'>): EmailServiceDeps {
  const db: Kysely<Database> = env.db
  return {
    render: renderEmail,
    sender: env.emailSender,
    provider: env.emailProvider,
    hashEmail: (email) => hashEmail(email, env.emailHashKey),
    maskEmail,
    insertMessage: (params) => insertEmailMessage(db, params),
    markSent: (id, result) => markEmailMessageSent(db, id, result),
    markFailed: (id, error) => markEmailMessageFailed(db, id, error),
    hasActiveSuppression: (hash) => hasActiveSuppression(db, hash),
    findRecipientForUser: (userId) => findEmailAndLanguageForUser(db, env.vault, userId),
    log: (line, meta) => console.error(line, meta),
  }
}
