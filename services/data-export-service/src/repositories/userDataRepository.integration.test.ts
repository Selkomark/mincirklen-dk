import { afterAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, runMigrations } from '@mincirklen/shared'
import { sql } from 'kysely'
import { collectUserExportData } from './userDataRepository'

const pool = createPgPool(process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL, 'test')
const db = createDb(pool)
await runMigrations(db, 'test')

afterAll(async () => {
  await db.destroy()
})

// No profile rows are created here, so the KMS config is never consulted.
const kms = { provider: 'vault', vaultAddr: 'http://unused', vaultToken: 'unused' } as const

describe('collectUserExportData', () => {
  test('includes what moderation did to the user, and their own reports, without other people\'s reports about them', async () => {
    const me = await db.insertInto('users').defaultValues().returning('id').executeTakeFirstOrThrow()
    const other = await db.insertInto('users').defaultValues().returning('id').executeTakeFirstOrThrow()
    const moderator = await db.insertInto('users').defaultValues().returning('id').executeTakeFirstOrThrow()
    const session = await db.insertInto('sessions').values({ status: 'active', name: 'Export circle' }).returning('id').executeTakeFirstOrThrow()
    await db.insertInto('session_users').values({ session_id: session.id, user_id: me.id, turn_order: 0 }).execute()
    await db.insertInto('session_users').values({ session_id: session.id, user_id: other.id, turn_order: 1 }).execute()

    // A message of mine that a moderator later hid.
    const mine = await db
      .insertInto('messages')
      .values({ session_id: session.id, user_id: me.id, body: 'something I said', moderation_status: 'removed', removed_at: new Date(), removed_by: moderator.id })
      .returning('id')
      .executeTakeFirstOrThrow()

    // A report the other member filed about me, decided with two outcomes.
    const about = await db
      .insertInto('session_reports')
      .values({
        session_id: session.id,
        reporter_user_id: other.id,
        about_user_ids: sql`${JSON.stringify([me.id])}::jsonb`,
        message_ids: sql`${JSON.stringify([mine.id])}::jsonb`,
        body: 'the reporter\'s words — must not be exported to me',
        status: 'reviewed',
        reviewed_at: new Date(),
        reviewed_by: moderator.id,
        decision_note: 'Warned, and hid the message.',
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    await db
      .insertInto('session_report_actions')
      .values([
        { report_id: about.id, action: 'warn', target_user_ids: sql`${JSON.stringify([me.id])}::jsonb`, member_message: 'Please keep it kind.' },
        { report_id: about.id, action: 'hide_messages', target_user_ids: sql`'[]'::jsonb` },
      ])
      .execute()
    await db.insertInto('member_notes').values({ user_id: me.id, report_id: about.id, body: 'Watch for a repeat.', created_by: moderator.id }).execute()

    // A report I filed about the other member.
    await db
      .insertInto('session_reports')
      .values({
        session_id: session.id,
        reporter_user_id: me.id,
        about_user_ids: sql`${JSON.stringify([other.id])}::jsonb`,
        message_ids: sql`'[]'::jsonb`,
        body: 'my own report',
      })
      .execute()

    const data = await collectUserExportData(db, kms, me.id)

    expect(data.messages).toHaveLength(1)
    expect(data.messages[0]).toMatchObject({ id: mine.id, moderationStatus: 'removed' })
    expect(data.messages[0]!.removedAt).not.toBeNull()

    // Only the warn outcome names me; hide_messages has no targets. The
    // decision summary comes along; the report's text and reporter don't.
    expect(data.moderationOutcomes).toHaveLength(1)
    expect(data.moderationOutcomes[0]).toMatchObject({
      sessionId: session.id,
      action: 'warn',
      memberMessage: 'Please keep it kind.',
      banReasonCategory: null,
      decisionSummary: 'Warned, and hid the message.',
    })
    expect(JSON.stringify(data)).not.toContain('the reporter')
    expect(JSON.stringify(data)).not.toContain(other.id === me.id ? 'impossible' : `"reporterUserId"`)

    expect(data.moderatorNotes).toEqual([{ body: 'Watch for a repeat.', createdAt: expect.any(Date) }])

    expect(data.reportsFiled).toHaveLength(1)
    expect(data.reportsFiled[0]).toMatchObject({ body: 'my own report', status: 'open', decidedAt: null, aboutUserIds: [other.id], messageIds: [] })
  })
})
