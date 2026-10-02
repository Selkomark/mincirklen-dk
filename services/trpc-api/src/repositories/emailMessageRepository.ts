import { sql, type Kysely } from 'kysely'
import type { Database, EmailProvider, EmailStatus, EmailTemplateKey, EmailLanguage } from '@mincirklen/shared'

// The sent-email record (email_messages). Written by emailService.ts on
// every send, moved along by emailWebhookService.ts as the provider's
// events arrive, read by the /manage Emails section.

export interface EmailMessageSummary {
  id: string
  templateKey: string
  language: EmailLanguage
  toEmailMasked: string
  userId: string | null
  subject: string
  status: EmailStatus
  provider: EmailProvider
  providerMessageId: string | null
  error: string | null
  isTest: boolean
  createdAt: Date
  sentAt: Date | null
  lastEventAt: Date | null
}

export interface EmailMessageDetail extends EmailMessageSummary {
  variables: Record<string, unknown>
  toEmailHash: string
  updatedAt: Date
}

interface Row {
  id: string
  template_key: string
  language: EmailLanguage
  to_email_masked: string
  to_email_hash: string
  user_id: string | null
  subject: string
  variables: Record<string, unknown>
  status: EmailStatus
  provider: EmailProvider
  provider_message_id: string | null
  error: string | null
  is_test: boolean
  created_at: Date
  updated_at: Date
  sent_at: Date | null
  last_event_at: Date | null
}

function toSummary(row: Omit<Row, 'variables' | 'to_email_hash' | 'updated_at'>): EmailMessageSummary {
  return {
    id: row.id,
    templateKey: row.template_key,
    language: row.language,
    toEmailMasked: row.to_email_masked,
    userId: row.user_id,
    subject: row.subject,
    status: row.status,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    error: row.error,
    isTest: row.is_test,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    lastEventAt: row.last_event_at,
  }
}

function toDetail(row: Row): EmailMessageDetail {
  return { ...toSummary(row), variables: row.variables, toEmailHash: row.to_email_hash, updatedAt: row.updated_at }
}

export async function insertEmailMessage(
  db: Kysely<Database>,
  params: {
    templateKey: EmailTemplateKey
    language: EmailLanguage
    toEmailMasked: string
    toEmailHash: string
    userId: string | null
    subject: string
    variables: Record<string, unknown>
    provider: EmailProvider
    isTest: boolean
    // 'queued' unless the send was short-circuited (a suppressed address).
    status?: EmailStatus
    error?: string | null
  },
): Promise<{ id: string }> {
  return db
    .insertInto('email_messages')
    .values({
      template_key: params.templateKey,
      language: params.language,
      to_email_masked: params.toEmailMasked,
      to_email_hash: params.toEmailHash,
      user_id: params.userId,
      subject: params.subject,
      variables: params.variables,
      provider: params.provider,
      is_test: params.isTest,
      ...(params.status ? { status: params.status } : {}),
      error: params.error ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow()
}

export async function markEmailMessageSent(db: Kysely<Database>, id: string, params: { providerMessageId: string | null; sentAt: Date }): Promise<void> {
  await db
    .updateTable('email_messages')
    .set({ status: 'sent', provider_message_id: params.providerMessageId, sent_at: params.sentAt, updated_at: sql`now()` })
    .where('id', '=', id)
    .execute()
}

export async function markEmailMessageFailed(db: Kysely<Database>, id: string, error: string): Promise<void> {
  await db.updateTable('email_messages').set({ status: 'failed', error, updated_at: sql`now()` }).where('id', '=', id).execute()
}

export async function findEmailMessageByProviderMessageId(db: Kysely<Database>, providerMessageId: string): Promise<{ id: string; status: EmailStatus } | null> {
  const row = await db.selectFrom('email_messages').select(['id', 'status']).where('provider_message_id', '=', providerMessageId).executeTakeFirst()
  return row ?? null
}

export async function updateEmailMessageStatus(
  db: Kysely<Database>,
  id: string,
  params: { status: EmailStatus; lastEventAt: Date; error?: string | null },
): Promise<void> {
  await db
    .updateTable('email_messages')
    .set({
      status: params.status,
      last_event_at: params.lastEventAt,
      updated_at: sql`now()`,
      ...(params.error !== undefined ? { error: params.error } : {}),
    })
    .where('id', '=', id)
    .execute()
}

// Same keyset cursor as gateSignupRepository.ts: "<created_at::text>|<id>",
// newest first.
function encodeCursor(createdAtText: string, id: string): string {
  return `${createdAtText}|${id}`
}

function decodeCursor(cursor: string): { createdAtText: string; id: string } {
  const [createdAtText, id] = cursor.split('|')
  if (!createdAtText || !id) throw new Error(`invalid cursor: ${cursor}`)
  return { createdAtText, id }
}

const SUMMARY_COLUMNS = [
  'id',
  'template_key',
  'language',
  'to_email_masked',
  'user_id',
  'subject',
  'status',
  'provider',
  'provider_message_id',
  'error',
  'is_test',
  'created_at',
  'sent_at',
  'last_event_at',
] as const

export async function listEmailMessages(
  db: Kysely<Database>,
  params: { status?: EmailStatus; templateKey?: EmailTemplateKey; cursor?: string; limit: number },
): Promise<{ messages: EmailMessageSummary[]; nextCursor: string | null }> {
  let query = db
    .selectFrom('email_messages')
    .select([...SUMMARY_COLUMNS, sql<string>`created_at::text`.as('created_at_cursor')])
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(params.limit + 1)

  if (params.status) query = query.where('status', '=', params.status)
  if (params.templateKey) query = query.where('template_key', '=', params.templateKey)
  if (params.cursor) {
    const { createdAtText, id } = decodeCursor(params.cursor)
    query = query.where((eb) =>
      eb.or([sql<boolean>`created_at::text < ${createdAtText}`, eb.and([sql<boolean>`created_at::text = ${createdAtText}`, eb('id', '<', id)])]),
    )
  }

  const rows = await query.execute()
  const hasMore = rows.length > params.limit
  const page = hasMore ? rows.slice(0, params.limit) : rows
  const last = page[page.length - 1]
  return {
    messages: page.map((row) => toSummary(row as Omit<Row, 'variables' | 'to_email_hash' | 'updated_at'>)),
    nextCursor: hasMore && last ? encodeCursor(last.created_at_cursor, last.id) : null,
  }
}

export async function findEmailMessageById(db: Kysely<Database>, id: string): Promise<EmailMessageDetail | null> {
  const row = await db.selectFrom('email_messages').selectAll().where('id', '=', id).executeTakeFirst()
  return row ? toDetail(row as Row) : null
}

export interface EmailStats {
  sent: number
  delivered: number
  bounced: number
  opened: number
  complained: number
}

// Counts for the admin header. `sent` is messages the provider accepted
// since `since`; the rest count distinct messages with at least one event
// of that type since `since`. Test sends are left out of all five.
export async function getEmailStats(db: Kysely<Database>, since: Date): Promise<EmailStats> {
  const sentRow = await db
    .selectFrom('email_messages')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('is_test', '=', false)
    .where('sent_at', 'is not', null)
    .where('sent_at', '>=', since)
    .executeTakeFirstOrThrow()

  const eventRows = await db
    .selectFrom('email_events')
    .innerJoin('email_messages', 'email_messages.id', 'email_events.message_id')
    .select(['email_events.type as type', sql<string>`count(distinct email_events.message_id)`.as('n')])
    .where('email_messages.is_test', '=', false)
    .where('email_events.occurred_at', '>=', since)
    .where('email_events.type', 'in', ['message.delivered', 'message.bounced', 'message.opened', 'message.complained'])
    .groupBy('email_events.type')
    .execute()

  const byType = new Map(eventRows.map((r) => [r.type, Number(r.n)]))
  return {
    sent: Number(sentRow.n),
    delivered: byType.get('message.delivered') ?? 0,
    bounced: byType.get('message.bounced') ?? 0,
    opened: byType.get('message.opened') ?? 0,
    complained: byType.get('message.complained') ?? 0,
  }
}
