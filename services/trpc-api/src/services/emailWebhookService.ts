import { z } from 'zod'
import type { Kysely } from 'kysely'
import type { Database, EmailStatus } from '@mincirklen/shared'
import type { AppEnv } from '../context'
import { hashEmail } from '../auth/emailHash'
import { maskEmail } from '../repositories/rbacRepository'
import { insertEmailEvent } from '../repositories/emailEventRepository'
import { findEmailMessageByProviderMessageId, updateEmailMessageStatus } from '../repositories/emailMessageRepository'
import { upsertEmailSuppression } from '../repositories/emailSuppressionRepository'
import {
  errorFromEventData,
  nextEmailStatus,
  providerMessageIdFromEventData,
  recipientFromEventData,
  statusForWebhookEventType,
  stripRecipientFromEventData,
} from './emailStatus'

// What one verified webhook delivery from the provider does to our
// records: it is stored (always, exactly once), and if it is about a
// message we sent it moves that message's status by the rules in
// emailStatus.ts. Account-level events (a new suppression, a DNS problem
// on the sending domain) are stored and acted on without a message.

// Loose on purpose — only `type` and `data` are needed, and the
// provider may add fields.
export const ahasendWebhookEventSchema = z.object({
  type: z.string().min(1),
  timestamp: z.string().optional(),
  data: z.record(z.unknown()).default({}),
})
export type AhaSendWebhookEvent = z.infer<typeof ahasendWebhookEventSchema>

export type ApplyWebhookEventResult =
  // This webhook id was already stored; nothing changed.
  | 'duplicate'
  // A message event matched one of our rows; its status may have moved.
  | 'applied'
  // A message event we have no row for (sent before this existed, or
  // from another system on the same account). Stored, nothing to move.
  | 'unmatched'
  // An account-level event, stored and handled.
  | 'recorded'

export interface ApplyWebhookEventDeps {
  insertEvent: (params: { webhookId: string; type: string; occurredAt: Date; data: Record<string, unknown>; messageId: string | null; providerMessageId: string | null }) => Promise<{ inserted: boolean }>
  findMessageByProviderId: (providerMessageId: string) => Promise<{ id: string; status: EmailStatus } | null>
  updateMessageStatus: (id: string, params: { status: EmailStatus; lastEventAt: Date; error?: string | null }) => Promise<void>
  upsertSuppression: (params: { recipientHash: string; recipientMasked: string; sendingDomain: string | null; reason: string | null; expiresAt: Date | null; raw: Record<string, unknown> }) => Promise<void>
  hashEmail: (email: string) => string
  maskEmail: (email: string) => string
  warn: (line: string, meta?: unknown) => void
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function applyWebhookEvent(
  deps: ApplyWebhookEventDeps,
  params: { webhookId: string; event: AhaSendWebhookEvent; receivedAt?: Date },
): Promise<ApplyWebhookEventResult> {
  const { webhookId, event } = params
  const occurredAt = parseDate(event.timestamp) ?? params.receivedAt ?? new Date()
  const isMessageEvent = event.type.startsWith('message.')
  const providerMessageId = isMessageEvent ? providerMessageIdFromEventData(event.data) : null
  const message = providerMessageId ? await deps.findMessageByProviderId(providerMessageId) : null

  // Stored first, with the recipient address taken out: the message row
  // already holds it masked and hashed, and the event log shouldn't be a
  // second place the address lives.
  const { inserted } = await deps.insertEvent({
    webhookId,
    type: event.type,
    occurredAt,
    data: stripRecipientFromEventData(event.data),
    messageId: message?.id ?? null,
    providerMessageId,
  })
  if (!inserted) return 'duplicate'

  if (event.type === 'suppression.created') {
    const recipient = recipientFromEventData(event.data)
    if (!recipient) {
      deps.warn('[EMAIL] suppression.created without a recipient', { webhookId })
      return 'recorded'
    }
    await deps.upsertSuppression({
      recipientHash: deps.hashEmail(recipient),
      recipientMasked: deps.maskEmail(recipient),
      sendingDomain: str(event.data.sending_domain),
      reason: str(event.data.reason),
      expiresAt: parseDate(event.data.expires_at),
      raw: stripRecipientFromEventData(event.data),
    })
    return 'recorded'
  }

  if (event.type === 'domain.dns_error') {
    // Nothing to do in-app — the sending domain's DNS is an operator
    // matter — but it should be loud.
    deps.warn('[EMAIL] provider reports a DNS problem on the sending domain', { domain: str(event.data.domain) ?? str(event.data.sending_domain), reason: str(event.data.reason) ?? str(event.data.error) })
    return 'recorded'
  }

  if (!isMessageEvent) return 'recorded'
  if (!message) return 'unmatched'

  const incoming = statusForWebhookEventType(event.type)
  if (!incoming) return 'applied'
  const next = nextEmailStatus(message.status, incoming)
  if (next !== message.status) {
    await deps.updateMessageStatus(message.id, { status: next, lastEventAt: occurredAt, error: errorFromEventData(event.type, event.data) })
  } else {
    await deps.updateMessageStatus(message.id, { status: next, lastEventAt: occurredAt })
  }
  return 'applied'
}

export function createWebhookDeps(env: Pick<AppEnv, 'db' | 'emailHashKey'>): ApplyWebhookEventDeps {
  const db: Kysely<Database> = env.db
  return {
    insertEvent: (params) => insertEmailEvent(db, params),
    findMessageByProviderId: (id) => findEmailMessageByProviderMessageId(db, id),
    updateMessageStatus: (id, params) => updateEmailMessageStatus(db, id, params),
    upsertSuppression: (params) => upsertEmailSuppression(db, params),
    hashEmail: (email) => hashEmail(email, env.emailHashKey),
    maskEmail,
    warn: (line, meta) => console.warn(line, meta),
  }
}
