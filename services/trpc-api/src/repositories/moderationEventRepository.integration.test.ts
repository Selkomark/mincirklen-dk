import { afterAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, runMigrations } from '@mincirklen/shared'
import { createSession, joinSession } from './sessionRepository'
import { insertModerationEvent } from './moderationEventRepository'

const pool = createPgPool(
  process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL,
  'test',
)
const db = createDb(pool)

await runMigrations(db, 'test')

afterAll(async () => {
  await db.destroy()
})

describe('insertModerationEvent', () => {
  test('records a crisis classification with no associated message', async () => {
    const session = await createSession(db)
    const user = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    await joinSession(db, session.id, user.id)

    await insertModerationEvent(db, {
      sessionId: session.id,
      userId: user.id,
      messageId: null,
      classification: 'crisis',
    })

    const row = await db
      .selectFrom('moderation_events')
      .selectAll()
      .where('session_id', '=', session.id)
      .executeTakeFirstOrThrow()

    expect(row.classification).toBe('crisis')
    expect(row.message_id).toBeNull()
    expect(row.human_reviewed).toBe(false)
  })
})
