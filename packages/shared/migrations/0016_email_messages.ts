import { sql, type Kysely } from 'kysely'

// Outbound email gets a record. Until now every email went to the server
// log and nothing remembered it was sent. These three tables are what
// the /manage "Emails" section reads and what the provider's webhooks
// write into: one row per message (metadata, never the body — see
// EmailMessagesTable in src/db/types.ts), one row per delivery event the
// provider reports, and the addresses it has suppressed.

const STATUSES = ['queued', 'sent', 'accepted', 'delayed', 'delivered', 'opened', 'clicked', 'bounced', 'failed', 'suppressed', 'complained']

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('email_messages')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('template_key', 'text', (col) => col.notNull())
    .addColumn('language', 'text', (col) => col.notNull())
    .addColumn('to_email_masked', 'text', (col) => col.notNull())
    .addColumn('to_email_hash', 'text', (col) => col.notNull())
    // Survives the member deleting their account, as null — the send
    // still happened.
    .addColumn('user_id', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('subject', 'text', (col) => col.notNull())
    .addColumn('variables', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('queued'))
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('provider_message_id', 'text')
    .addColumn('error', 'text')
    .addColumn('is_test', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('sent_at', 'timestamptz')
    .addColumn('last_event_at', 'timestamptz')
    .execute()
  await sql`alter table email_messages add constraint email_messages_status_check check (status in (${sql.join(STATUSES.map((s) => sql.lit(s)))}))`.execute(db)
  await sql`alter table email_messages add constraint email_messages_language_check check (language in ('en','sv','da'))`.execute(db)
  await sql`alter table email_messages add constraint email_messages_provider_check check (provider in ('log','ahasend'))`.execute(db)
  // Webhooks look a message up by the provider's id; one row per id.
  // Postgres lets many rows be null here, which is what the log
  // provider needs.
  await db.schema.createIndex('email_messages_provider_message_id_key').unique().on('email_messages').column('provider_message_id').execute()
  // The admin list is newest first, optionally by status.
  await db.schema.createIndex('email_messages_created_at_id_idx').on('email_messages').columns(['created_at desc', 'id desc']).execute()
  await db.schema.createIndex('email_messages_status_created_at_idx').on('email_messages').columns(['status', 'created_at desc', 'id desc']).execute()
  await db.schema.createIndex('email_messages_user_id_idx').on('email_messages').column('user_id').execute()
  await db.schema.createIndex('email_messages_to_email_hash_idx').on('email_messages').column('to_email_hash').execute()

  await db.schema
    .createTable('email_events')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('message_id', 'uuid', (col) => col.references('email_messages.id').onDelete('cascade'))
    .addColumn('provider_message_id', 'text')
    .addColumn('webhook_id', 'text', (col) => col.notNull())
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('occurred_at', 'timestamptz', (col) => col.notNull())
    .addColumn('data', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()
  // A retried or replayed delivery inserts nothing.
  await db.schema.createIndex('email_events_webhook_id_key').unique().on('email_events').column('webhook_id').execute()
  await db.schema.createIndex('email_events_message_id_occurred_at_idx').on('email_events').columns(['message_id', 'occurred_at']).execute()
  await db.schema.createIndex('email_events_provider_message_id_idx').on('email_events').column('provider_message_id').execute()

  await db.schema
    .createTable('email_suppressions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('recipient_hash', 'text', (col) => col.notNull())
    .addColumn('recipient_masked', 'text', (col) => col.notNull())
    .addColumn('sending_domain', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('reason', 'text')
    .addColumn('expires_at', 'timestamptz')
    .addColumn('raw', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()
  await db.schema.createIndex('email_suppressions_recipient_hash_sending_domain_key').unique().on('email_suppressions').columns(['recipient_hash', 'sending_domain']).execute()
  await db.schema.createIndex('email_suppressions_created_at_idx').on('email_suppressions').columns(['created_at desc', 'id desc']).execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('email_suppressions').execute()
  await db.schema.dropTable('email_events').execute()
  await db.schema.dropTable('email_messages').execute()
}
