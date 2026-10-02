import type { Kysely } from 'kysely'

import type { Database } from '@mincirklen/shared'

// Provider webhook events (email_events). One row per delivery, keyed by
// the provider's webhook id, so a retry or replay inserts nothing and
// says so.

export interface EmailEvent {
  id: string
  messageId: string | null
  providerMessageId: string | null
  webhookId: string
  type: string
  occurredAt: Date
  data: Record<string, unknown>
  createdAt: Date
}

export async function insertEmailEvent(
  db: Kysely<Database>,
  params: { webhookId: string; type: string; occurredAt: Date; data: Record<string, unknown>; messageId: string | null; providerMessageId: string | null },
): Promise<{ inserted: boolean }> {
  const row = await db
    .insertInto('email_events')
    .values({
      webhook_id: params.webhookId,
      type: params.type,
      occurred_at: params.occurredAt,
      data: params.data,
      message_id: params.messageId,
      provider_message_id: params.providerMessageId,
    })
    .onConflict((oc) => oc.column('webhook_id').doNothing())
    .returning('id')
    .executeTakeFirst()
  return { inserted: row !== undefined }
}

export async function listEmailEventsForMessage(db: Kysely<Database>, messageId: string): Promise<EmailEvent[]> {
  const rows = await db.selectFrom('email_events').selectAll().where('message_id', '=', messageId).orderBy('occurred_at', 'asc').orderBy('created_at', 'asc').execute()
  return rows.map((row) => ({
    id: row.id,
    messageId: row.message_id,
    providerMessageId: row.provider_message_id,
    webhookId: row.webhook_id,
    type: row.type,
    occurredAt: row.occurred_at,
    data: row.data,
    createdAt: row.created_at,
  }))
}
