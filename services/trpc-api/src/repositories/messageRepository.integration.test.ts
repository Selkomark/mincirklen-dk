import { afterAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, runMigrations } from '@mincirklen/shared'
import { joinSession, createSession as createSessionRepo } from './sessionRepository'
import {
  applyHumanReviewOutcome,
  insertMessage,
  listMessages,
  recordCrisisMessage,
  recordFlaggedMessage,
  reportFalsePositive,
  recordPassedMessage,
} from './messageRepository'

const pool = createPgPool(
  process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL,
  'test',
)
const db = createDb(pool)

await runMigrations(db, 'test')

afterAll(async () => {
  await db.destroy()
})

async function seedSessionWithUsers(count: number) {
  const session = await createSessionRepo(db)
  const userIds: string[] = []

  for (let i = 0; i < count; i++) {
    const user = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    userIds.push(user.id)
    await joinSession(db, session.id, user.id)
  }

  return { sessionId: session.id, userIds }
}

describe('insertMessage / listMessages', () => {
  test('persists and lists messages in send order', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(1)

    await insertMessage(db, { sessionId, userId: userIds[0] as string, body: 'first' })
    await insertMessage(db, { sessionId, userId: userIds[0] as string, body: 'second' })

    const page = await listMessages(db, { sessionId, limit: 10, requestingUserId: userIds[0] as string })
    expect(page.messages.map((m) => m.body)).toEqual(['first', 'second'])
  })

  test('defaults to type "user" when omitted', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(1)

    const message = await insertMessage(db, { sessionId, userId: userIds[0] as string, body: 'hi' })
    expect(message.type).toBe('user')

    const page = await listMessages(db, { sessionId, limit: 10, requestingUserId: userIds[0] as string })
    expect(page.messages[0]?.type).toBe('user')
  })

  test('defaults to moderation_status "pass" when omitted', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(1)

    const message = await insertMessage(db, { sessionId, userId: userIds[0] as string, body: 'hi' })
    expect(message.moderationStatus).toBe('pass')
    expect(message.falsePositiveReportedAt).toBeNull()
  })

  test('persists a "system" row when type is passed explicitly, interleaved by timestamp', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(1)

    await insertMessage(db, { sessionId, userId: userIds[0] as string, body: 'first' })
    const joinMessage = await insertMessage(db, { sessionId, userId: userIds[0] as string, body: 'joined', type: 'system' })
    await insertMessage(db, { sessionId, userId: userIds[0] as string, body: 'second' })

    expect(joinMessage.type).toBe('system')

    const page = await listMessages(db, { sessionId, limit: 10, requestingUserId: userIds[0] as string })
    expect(page.messages.map((m) => ({ body: m.body, type: m.type }))).toEqual([
      { body: 'first', type: 'user' },
      { body: 'joined', type: 'system' },
      { body: 'second', type: 'user' },
    ])
  })
})

describe('recordPassedMessage', () => {
  // Turn advancement is no longer this function's concern — it's now
  // owned by websocket-service (see messageService.ts's explicit
  // advanceTurn dep call) — this only verifies the message itself
  // persists atomically with its moderation event.
  test('persists the message', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(2)

    const message = await recordPassedMessage(db, {
      sessionId,
      userId: userIds[0] as string,
      body: 'hello room',
    })

    expect(message.body).toBe('hello room')
    expect(message.moderationStatus).toBe('pass')

    const page = await listMessages(db, { sessionId, limit: 10, requestingUserId: userIds[0] as string })
    expect(page.messages).toHaveLength(1)
    expect(page.messages[0]?.body).toBe('hello room')
  })
})

describe('recordFlaggedMessage', () => {
  test('persists the message with moderation_status "flag", visible to its own author only', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(2)
    const [author, other] = userIds as [string, string]

    const message = await recordFlaggedMessage(db, { sessionId, userId: author, body: 'flagged text' })
    expect(message.moderationStatus).toBe('flag')

    const ownPage = await listMessages(db, { sessionId, limit: 10, requestingUserId: author })
    expect(ownPage.messages.map((m) => m.body)).toEqual(['flagged text'])

    const othersPage = await listMessages(db, { sessionId, limit: 10, requestingUserId: other })
    expect(othersPage.messages).toHaveLength(0)
  })
})

describe('recordCrisisMessage', () => {
  test('persists the message with moderation_status "crisis", visible to its own author only', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(2)
    const [author, other] = userIds as [string, string]

    await recordCrisisMessage(db, { sessionId, userId: author, body: 'crisis text' })

    const ownPage = await listMessages(db, { sessionId, limit: 10, requestingUserId: author })
    expect(ownPage.messages).toHaveLength(1)
    expect(ownPage.messages[0]?.moderationStatus).toBe('crisis')

    const othersPage = await listMessages(db, { sessionId, limit: 10, requestingUserId: other })
    expect(othersPage.messages).toHaveLength(0)
  })
})

describe('reportFalsePositive', () => {
  test('sets false_positive_reported_at on the caller\'s own flagged message', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(1)
    const author = userIds[0] as string

    const message = await recordFlaggedMessage(db, { sessionId, userId: author, body: 'disputed' })
    expect(message.falsePositiveReportedAt).toBeNull()

    await reportFalsePositive(db, { messageId: message.id, userId: author })

    const page = await listMessages(db, { sessionId, limit: 10, requestingUserId: author })
    expect(page.messages[0]?.falsePositiveReportedAt).not.toBeNull()
  })

  test('is a no-op when the caller does not own the message', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(2)
    const [author, other] = userIds as [string, string]

    const message = await recordFlaggedMessage(db, { sessionId, userId: author, body: 'disputed' })
    await reportFalsePositive(db, { messageId: message.id, userId: other })

    const page = await listMessages(db, { sessionId, limit: 10, requestingUserId: author })
    expect(page.messages[0]?.falsePositiveReportedAt).toBeNull()
  })

  test('is a no-op on a "pass" message — nothing to dispute', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(1)
    const author = userIds[0] as string

    const message = await recordPassedMessage(db, { sessionId, userId: author, body: 'ordinary' })
    await reportFalsePositive(db, { messageId: message.id, userId: author })

    const page = await listMessages(db, { sessionId, limit: 10, requestingUserId: author })
    expect(page.messages[0]?.falsePositiveReportedAt).toBeNull()
  })
})

describe('applyHumanReviewOutcome', () => {
  test('marks moderation_status "reviewed_pass" (not "pass") when the outcome is false_positive', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(1)
    const author = userIds[0] as string

    const message = await recordFlaggedMessage(db, { sessionId, userId: author, body: 'actually fine' })
    const event = await db
      .selectFrom('moderation_events')
      .select('id')
      .where('message_id', '=', message.id)
      .executeTakeFirstOrThrow()

    await applyHumanReviewOutcome(db, { moderationEventId: event.id, outcome: 'false_positive', reviewedBy: author })

    const page = await listMessages(db, { sessionId, limit: 10, requestingUserId: author })
    expect(page.messages[0]?.moderationStatus).toBe('reviewed_pass')

    const reviewedEvent = await db
      .selectFrom('moderation_events')
      .select(['human_reviewed', 'human_review_outcome', 'reviewed_by'])
      .where('id', '=', event.id)
      .executeTakeFirstOrThrow()
    expect(reviewedEvent.human_reviewed).toBe(true)
    expect(reviewedEvent.human_review_outcome).toBe('false_positive')
    expect(reviewedEvent.reviewed_by).toBe(author)
  })

  test('leaves moderation_status untouched when the outcome is true_positive', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(1)
    const author = userIds[0] as string

    const message = await recordFlaggedMessage(db, { sessionId, userId: author, body: 'rightly flagged' })
    const event = await db
      .selectFrom('moderation_events')
      .select('id')
      .where('message_id', '=', message.id)
      .executeTakeFirstOrThrow()

    await applyHumanReviewOutcome(db, { moderationEventId: event.id, outcome: 'true_positive', reviewedBy: author })

    const page = await listMessages(db, { sessionId, limit: 10, requestingUserId: author })
    expect(page.messages[0]?.moderationStatus).toBe('flag')
  })
})

describe('listMessages cursor pagination', () => {
  test('returns the most recent N messages, oldest-first, when no cursor is given', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(1)
    for (const body of ['one', 'two', 'three', 'four', 'five']) {
      await insertMessage(db, { sessionId, userId: userIds[0] as string, body })
    }

    const page = await listMessages(db, { sessionId, limit: 3, requestingUserId: userIds[0] as string })
    expect(page.messages.map((m) => m.body)).toEqual(['three', 'four', 'five'])
    expect(page.nextCursor).not.toBeNull()
  })

  test('nextCursor pages strictly further into the past, with no gaps or duplicates', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(1)
    const bodies = ['one', 'two', 'three', 'four', 'five']
    for (const body of bodies) {
      await insertMessage(db, { sessionId, userId: userIds[0] as string, body })
    }

    const collected: string[] = []
    let cursor: string | undefined
    for (let guard = 0; guard < 10; guard++) {
      const page = await listMessages(db, { sessionId, cursor, limit: 2, requestingUserId: userIds[0] as string })
      collected.unshift(...page.messages.map((m) => m.body))
      if (page.nextCursor === null) break
      cursor = page.nextCursor
    }

    expect(collected).toEqual(bodies)
  })

  test('nextCursor is null once the oldest message has been returned', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(1)
    await insertMessage(db, { sessionId, userId: userIds[0] as string, body: 'only one' })

    const page = await listMessages(db, { sessionId, limit: 10, requestingUserId: userIds[0] as string })
    expect(page.nextCursor).toBeNull()
  })

  test('only returns messages for the given session', async () => {
    const a = await seedSessionWithUsers(1)
    const b = await seedSessionWithUsers(1)
    await insertMessage(db, { sessionId: a.sessionId, userId: a.userIds[0] as string, body: 'in a' })
    await insertMessage(db, { sessionId: b.sessionId, userId: b.userIds[0] as string, body: 'in b' })

    const page = await listMessages(db, { sessionId: a.sessionId, limit: 10, requestingUserId: a.userIds[0] as string })
    expect(page.messages.map((m) => m.body)).toEqual(['in a'])
  })

  test('a non-"pass" row is withheld from other session members but shown to its own author', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(2)
    const [author, other] = userIds as [string, string]
    await insertMessage(db, { sessionId, userId: author, body: 'visible to all' })
    await recordFlaggedMessage(db, { sessionId, userId: author, body: 'author-only' })

    const authorPage = await listMessages(db, { sessionId, limit: 10, requestingUserId: author })
    expect(authorPage.messages.map((m) => m.body)).toEqual(['visible to all', 'author-only'])

    const otherPage = await listMessages(db, { sessionId, limit: 10, requestingUserId: other })
    expect(otherPage.messages.map((m) => m.body)).toEqual(['visible to all'])
  })

  test('a cursor is never duplicated or skipped when two messages share the same millisecond', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(1)
    // Two inserts in the same statement land at the exact same
    // millisecond-resolution created_at more often than sequential
    // inserts would — exercising the (created_at, id) tie-break.
    await db
      .insertInto('messages')
      .values([
        { session_id: sessionId, user_id: userIds[0] as string, body: 'tie a' },
        { session_id: sessionId, user_id: userIds[0] as string, body: 'tie b' },
      ])
      .execute()
    await insertMessage(db, { sessionId, userId: userIds[0] as string, body: 'after' })

    const collected: string[] = []
    let cursor: string | undefined
    for (let guard = 0; guard < 10; guard++) {
      const page = await listMessages(db, { sessionId, cursor, limit: 1, requestingUserId: userIds[0] as string })
      collected.unshift(...page.messages.map((m) => m.body))
      if (page.nextCursor === null) break
      cursor = page.nextCursor
    }

    expect(collected).toHaveLength(3)
    expect(new Set(collected).size).toBe(3)
  })
})
