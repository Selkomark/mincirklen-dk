import { sql, type Kysely } from 'kysely'
import type { Database } from '@mincirklen/shared'

// Addresses the provider has stopped delivering to (email_suppressions),
// written from its suppression.created webhook and consulted before a
// send so we don't keep queueing mail the provider will refuse.

export interface EmailSuppression {
  id: string
  recipientMasked: string
  sendingDomain: string
  reason: string | null
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export async function upsertEmailSuppression(
  db: Kysely<Database>,
  params: { recipientHash: string; recipientMasked: string; sendingDomain: string | null; reason: string | null; expiresAt: Date | null; raw: Record<string, unknown> },
): Promise<void> {
  await db
    .insertInto('email_suppressions')
    .values({
      recipient_hash: params.recipientHash,
      recipient_masked: params.recipientMasked,
      sending_domain: params.sendingDomain ?? '',
      reason: params.reason,
      expires_at: params.expiresAt,
      raw: params.raw,
    })
    .onConflict((oc) =>
      oc.columns(['recipient_hash', 'sending_domain']).doUpdateSet({
        reason: params.reason,
        expires_at: params.expiresAt,
        raw: params.raw,
        updated_at: sql`now()`,
      }),
    )
    .execute()
}

export async function hasActiveSuppression(db: Kysely<Database>, recipientHash: string): Promise<boolean> {
  const row = await db
    .selectFrom('email_suppressions')
    .select('id')
    .where('recipient_hash', '=', recipientHash)
    .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', sql<Date>`now()`)]))
    .limit(1)
    .executeTakeFirst()
  return row !== undefined
}

function encodeCursor(createdAtText: string, id: string): string {
  return `${createdAtText}|${id}`
}

function decodeCursor(cursor: string): { createdAtText: string; id: string } {
  const [createdAtText, id] = cursor.split('|')
  if (!createdAtText || !id) throw new Error(`invalid cursor: ${cursor}`)
  return { createdAtText, id }
}

export async function listEmailSuppressions(
  db: Kysely<Database>,
  params: { cursor?: string; limit: number },
): Promise<{ suppressions: EmailSuppression[]; nextCursor: string | null }> {
  let query = db
    .selectFrom('email_suppressions')
    .select(['id', 'recipient_masked', 'sending_domain', 'reason', 'expires_at', 'created_at', 'updated_at', sql<string>`created_at::text`.as('created_at_cursor')])
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(params.limit + 1)
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
    suppressions: page.map((row) => ({
      id: row.id,
      recipientMasked: row.recipient_masked,
      sendingDomain: row.sending_domain,
      reason: row.reason,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    nextCursor: hasMore && last ? encodeCursor(last.created_at_cursor, last.id) : null,
  }
}
