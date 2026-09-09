import { afterAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, runMigrations } from '@mincirklen/shared'
import { sql } from 'kysely'
import {
  CIRCLE_GUIDELINE_AGREEMENT_KEYS,
  SessionFullError,
  SessionNotFoundError,
  checkAndSyncGuidelines,
  createSession,
  getRoster,
  getSessionStatus,
  getSessionSummary,
  isSessionMember,
  joinSession,
  listOpenSessions,
  listRecentSessionVisits,
  recordGuidelinesAgreement,
} from './sessionRepository'

const pool = createPgPool(
  process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL,
  'test',
)
const db = createDb(pool)

await runMigrations(db, 'test')

afterAll(async () => {
  await db.destroy()
})

// sort_order is pushed high so this never interleaves with the seeded
// product topics' ordering assumptions in topicRepository.integration.test.ts.
async function seedTopic() {
  return db
    .insertInto('topics')
    .values({ slug: `test-topic-${crypto.randomUUID()}`, label: 'Test topic', sort_order: 999 })
    .returningAll()
    .executeTakeFirstOrThrow()
}

async function seedSessionWithUsers(count: number) {
  const session = await createSession(db)
  const userIds: string[] = []

  for (let i = 0; i < count; i++) {
    const user = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    userIds.push(user.id)
    await joinSession(db, session.id, user.id)
  }

  return { sessionId: session.id, userIds }
}

describe('createSession', () => {
  test('creates a session in forming status with no current turn and an empty roster', async () => {
    const { id } = await createSession(db)

    const status = await getSessionStatus(db, id)
    expect(status?.status).toBe('forming')

    const row = await db.selectFrom('sessions').select('current_turn_user_id').where('id', '=', id).executeTakeFirstOrThrow()
    expect(row.current_turn_user_id).toBeNull()

    expect(await getRoster(db, id)).toEqual([])
  })

  test('leaves scheduling columns null when no params are given', async () => {
    const { id } = await createSession(db)
    const row = await db
      .selectFrom('sessions')
      .select(['topic_id', 'name', 'scheduled_at', 'duration_minutes', 'capacity'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow()

    expect(row).toEqual({ topic_id: null, name: null, scheduled_at: null, duration_minutes: null, capacity: null })
  })

  test('persists scheduling columns when params are given', async () => {
    const topic = await seedTopic()
    const scheduledAt = new Date('2026-09-01T18:00:00.000Z')

    const { id } = await createSession(db, {
      topicId: topic.id,
      name: 'Weekly grief circle',
      scheduledAt,
      durationMinutes: 45,
      capacity: 6,
    })

    const row = await db
      .selectFrom('sessions')
      .select(['topic_id', 'name', 'scheduled_at', 'duration_minutes', 'capacity'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow()

    expect(row.topic_id).toBe(topic.id)
    expect(row.name).toBe('Weekly grief circle')
    expect(row.scheduled_at).toEqual(scheduledAt)
    expect(row.duration_minutes).toBe(45)
    expect(row.capacity).toBe(6)
  })
})

describe('joinSession', () => {
  test('assigns sequential turn order and activates on the first join', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(2)

    const roster = await getRoster(db, sessionId)
    expect(roster).toEqual([
      { userId: userIds[0], turnOrder: 0 },
      { userId: userIds[1], turnOrder: 1 },
    ])

    const status = await getSessionStatus(db, sessionId)
    expect(status?.status).toBe('active')

    const row = await db
      .selectFrom('sessions')
      .select('current_turn_user_id')
      .where('id', '=', sessionId)
      .executeTakeFirstOrThrow()
    expect(row.current_turn_user_id).toBe(userIds[0])
  })

  test('is idempotent for a user who has already joined, and reports it as not a new join', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(1)

    const rejoin = await joinSession(db, sessionId, userIds[0] as string)
    expect(rejoin).toEqual({ entry: { userId: userIds[0], turnOrder: 0 }, isNewJoin: false })

    const roster = await getRoster(db, sessionId)
    expect(roster).toHaveLength(1)
  })

  test('reports a first-time join as a new join', async () => {
    const { sessionId } = await seedSessionWithUsers(0)
    const user = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()

    const result = await joinSession(db, sessionId, user.id)
    expect(result).toEqual({ entry: { userId: user.id, turnOrder: 0 }, isNewJoin: true })
  })

  test('rejects a join once the session is full', async () => {
    const { sessionId } = await seedSessionWithUsers(8)

    const extra = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    await expect(joinSession(db, sessionId, extra.id)).rejects.toBeInstanceOf(SessionFullError)
  })

  test('rejects joining a session that does not exist', async () => {
    const user = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    await expect(
      joinSession(db, '00000000-0000-0000-0000-000000000000', user.id),
    ).rejects.toBeInstanceOf(SessionNotFoundError)
  })

  test('bumps last_visited_at when an existing member revisits', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(1)
    const userId = userIds[0] as string
    const before = await db
      .selectFrom('session_users')
      .select('last_visited_at')
      .where('session_id', '=', sessionId)
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow()

    await new Promise((resolve) => setTimeout(resolve, 10))
    await joinSession(db, sessionId, userId)

    const after = await db
      .selectFrom('session_users')
      .select('last_visited_at')
      .where('session_id', '=', sessionId)
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow()
    expect(after.last_visited_at.getTime()).toBeGreaterThan(before.last_visited_at.getTime())
  })

  test('enforces a scheduled circle\'s own capacity instead of the global max', async () => {
    const topic = await seedTopic()
    const { id: sessionId } = await createSession(db, {
      topicId: topic.id,
      name: 'Small grief circle',
      scheduledAt: new Date(),
      durationMinutes: 30,
      capacity: 2,
    })

    const userA = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const userB = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const userC = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()

    await joinSession(db, sessionId, userA.id)
    await joinSession(db, sessionId, userB.id)

    await expect(joinSession(db, sessionId, userC.id)).rejects.toBeInstanceOf(SessionFullError)
  })
})

describe('isSessionMember', () => {
  test('reflects membership accurately', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(1)
    const outsider = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()

    expect(await isSessionMember(db, sessionId, userIds[0] as string)).toBe(true)
    expect(await isSessionMember(db, sessionId, outsider.id)).toBe(false)
  })
})

describe('getSessionSummary', () => {
  test('returns null for a session that does not exist', async () => {
    expect(await getSessionSummary(db, '00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  test('returns a topic-less summary for an ad-hoc session', async () => {
    const { id } = await createSession(db)
    expect(await getSessionSummary(db, id)).toMatchObject({
      id,
      status: 'forming',
      name: null,
      topic: null,
      joinedCount: 0,
    })
  })

  test('returns topic and live joinedCount for a scheduled circle', async () => {
    const topic = await seedTopic()
    const { id } = await createSession(db, {
      topicId: topic.id,
      name: 'Grief circle',
      scheduledAt: new Date(),
      durationMinutes: 30,
      capacity: 4,
    })
    const user = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    await joinSession(db, id, user.id)

    const summary = await getSessionSummary(db, id)
    expect(summary).toMatchObject({
      id,
      status: 'active',
      name: 'Grief circle',
      durationMinutes: 30,
      capacity: 4,
      joinedCount: 1,
      topic: { id: topic.id, slug: topic.slug, label: topic.label },
    })
    expect(summary?.scheduledAt).toBeInstanceOf(Date)
  })
})

describe('listRecentSessionVisits', () => {
  async function seedNamedVisit(userId: string, topicId: string, name: string) {
    const { id } = await createSession(db, { topicId, name, scheduledAt: new Date(), durationMinutes: 30, capacity: 8 })
    await joinSession(db, id, userId)
    return id
  }

  test('orders by most recently visited first', async () => {
    const user = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const first = await createSession(db)
    await joinSession(db, first.id, user.id)
    const second = await createSession(db)
    await joinSession(db, second.id, user.id)

    const { visits, nextCursor } = await listRecentSessionVisits(db, { userId: user.id, limit: 10 })
    expect(visits.map((v) => v.id)).toEqual([second.id, first.id])
    expect(nextCursor).toBeNull()
  })

  test('revisiting an already-joined session moves it back to the top', async () => {
    const user = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const first = await createSession(db)
    await joinSession(db, first.id, user.id)
    const second = await createSession(db)
    await joinSession(db, second.id, user.id)

    await joinSession(db, first.id, user.id) // revisit

    const { visits } = await listRecentSessionVisits(db, { userId: user.id, limit: 10 })
    expect(visits.map((v) => v.id)).toEqual([first.id, second.id])
  })

  test('paginates forward with a load-more cursor', async () => {
    const user = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const session = await createSession(db)
      await joinSession(db, session.id, user.id)
      ids.push(session.id)
    }

    const page1 = await listRecentSessionVisits(db, { userId: user.id, limit: 2 })
    expect(page1.visits.map((v) => v.id)).toEqual([ids[2], ids[1]])
    expect(page1.nextCursor).not.toBeNull()

    const page2 = await listRecentSessionVisits(db, { userId: user.id, limit: 2, cursor: page1.nextCursor as string })
    expect(page2.visits.map((v) => v.id)).toEqual([ids[0]])
    expect(page2.nextCursor).toBeNull()
  })

  test('only returns the requesting user\'s own visits', async () => {
    const userA = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const userB = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const sessionA = await createSession(db)
    await joinSession(db, sessionA.id, userA.id)
    const sessionB = await createSession(db)
    await joinSession(db, sessionB.id, userB.id)

    const { visits } = await listRecentSessionVisits(db, { userId: userB.id, limit: 10 })
    expect(visits.map((v) => v.id)).toEqual([sessionB.id])
  })

  test('search matches by name, same semantics as listOpenSessions', async () => {
    const user = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const topic = await seedTopic()
    const griefId = await seedNamedVisit(user.id, topic.id, 'Weekly grief circle')
    await seedNamedVisit(user.id, topic.id, 'Anxiety support circle')

    const { visits } = await listRecentSessionVisits(db, { userId: user.id, search: 'grief', limit: 10 })
    expect(visits.map((v) => v.id)).toEqual([griefId])
  })
})

// Turn claiming/advancing moved to websocket-service (Redis is now the
// live authority) — see
// services/websocket-service/src/adapters/redisTurnStateAdapter.integration.test.ts
// and services/websocket-service/src/rpcServer.integration.test.ts
// for that coverage. Nothing in this repository claims/advances turns
// any more.

describe('listOpenSessions', () => {
  test('includes forming and active scheduled circles with room left, excludes the rest', async () => {
    const topic = await seedTopic()

    const open = await createSession(db, {
      topicId: topic.id,
      name: 'Weekly grief circle',
      scheduledAt: new Date('2026-09-01T18:00:00.000Z'),
      durationMinutes: 60,
      capacity: 4,
    })

    const full = await createSession(db, {
      topicId: topic.id,
      name: 'Full grief circle',
      scheduledAt: new Date('2026-09-02T18:00:00.000Z'),
      durationMinutes: 30,
      capacity: 1,
    })
    const fullUser = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    await joinSession(db, full.id, fullUser.id)

    // Ad-hoc, non-scheduled session — must never show up in the browse list.
    await createSession(db)

    const { sessions, nextCursor } = await listOpenSessions(db, { topicId: topic.id, limit: 50 })
    const ids = sessions.map((r) => r.id)

    expect(ids).toContain(open.id)
    expect(ids).not.toContain(full.id)
    expect(nextCursor).toBeNull()

    const openResult = sessions.find((r) => r.id === open.id)
    expect(openResult).toMatchObject({
      status: 'forming',
      name: 'Weekly grief circle',
      durationMinutes: 60,
      capacity: 4,
      joinedCount: 0,
      topic: { id: topic.id, slug: topic.slug, label: topic.label },
    })
  })

  // A row created between migration 0007 (topic_id) and 0008 (name) has a
  // topic but no name — createSession(db, params) can't produce this
  // shape any more (name is required), so it's inserted directly to
  // reproduce that historical state.
  test('surfaces a null name for a scheduled circle that predates circle naming', async () => {
    const topic = await seedTopic()
    const row = await db
      .insertInto('sessions')
      .values({
        status: 'forming',
        topic_id: topic.id,
        scheduled_at: new Date('2026-09-01T18:00:00.000Z'),
        duration_minutes: 60,
        capacity: 4,
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    const { sessions } = await listOpenSessions(db, { topicId: topic.id, limit: 50 })
    expect(sessions.find((r) => r.id === row.id)).toMatchObject({ name: null })
  })

  describe('filters', () => {
    test('search matches a literal substring of the real name', async () => {
      const topic = await seedTopic()
      const target = await createSession(db, {
        topicId: topic.id,
        name: `Unique Grief Night ${crypto.randomUUID()}`,
        scheduledAt: new Date('2026-09-01T18:00:00.000Z'),
        durationMinutes: 60,
        capacity: 4,
      })
      const other = await createSession(db, {
        topicId: topic.id,
        name: `Totally Different ${crypto.randomUUID()}`,
        scheduledAt: new Date('2026-09-01T18:00:00.000Z'),
        durationMinutes: 60,
        capacity: 4,
      })

      const { sessions } = await listOpenSessions(db, { search: 'Grief Night', limit: 50 })
      const ids = sessions.map((r) => r.id)
      expect(ids).toContain(target.id)
      expect(ids).not.toContain(other.id)
    })

    test('search matches a null-named row via its topic-derived display name', async () => {
      const topic = await seedTopic()
      const row = await db
        .insertInto('sessions')
        .values({
          status: 'forming',
          topic_id: topic.id,
          scheduled_at: new Date('2026-09-01T18:00:00.000Z'),
          duration_minutes: 60,
          capacity: 4,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      const { sessions } = await listOpenSessions(db, { search: topic.label, limit: 50 })
      expect(sessions.map((r) => r.id)).toContain(row.id)
    })

    test('a typo in the search term still matches via trigram similarity', async () => {
      const topic = await seedTopic()
      const marker = crypto.randomUUID().slice(0, 8)
      const target = await createSession(db, {
        topicId: topic.id,
        name: `Grief Night ${marker}`,
        scheduledAt: new Date('2026-09-01T18:00:00.000Z'),
        durationMinutes: 60,
        capacity: 4,
      })

      const { sessions } = await listOpenSessions(db, { search: `Greif Nite ${marker}`, limit: 50 })
      expect(sessions.map((r) => r.id)).toContain(target.id)
    })

    test('topicId isolates circles under that topic only', async () => {
      const topicA = await seedTopic()
      const topicB = await seedTopic()
      const a = await createSession(db, {
        topicId: topicA.id,
        name: 'Circle A',
        scheduledAt: new Date('2026-09-01T18:00:00.000Z'),
        durationMinutes: 60,
        capacity: 4,
      })
      const b = await createSession(db, {
        topicId: topicB.id,
        name: 'Circle B',
        scheduledAt: new Date('2026-09-01T18:00:00.000Z'),
        durationMinutes: 60,
        capacity: 4,
      })

      const { sessions } = await listOpenSessions(db, { topicId: topicA.id, limit: 50 })
      const ids = sessions.map((r) => r.id)
      expect(ids).toContain(a.id)
      expect(ids).not.toContain(b.id)
    })

    test('capacity isolates circles of that exact group size', async () => {
      const topic = await seedTopic()
      const small = await createSession(db, {
        topicId: topic.id,
        name: 'Small circle',
        scheduledAt: new Date('2026-09-01T18:00:00.000Z'),
        durationMinutes: 60,
        capacity: 6,
      })
      const large = await createSession(db, {
        topicId: topic.id,
        name: 'Large circle',
        scheduledAt: new Date('2026-09-01T18:00:00.000Z'),
        durationMinutes: 60,
        capacity: 12,
      })

      const { sessions } = await listOpenSessions(db, { capacity: 6, limit: 50 })
      const ids = sessions.map((r) => r.id)
      expect(ids).toContain(small.id)
      expect(ids).not.toContain(large.id)
    })

    test('durationMinutes: a number isolates that exact duration', async () => {
      const topic = await seedTopic()
      const thirty = await createSession(db, {
        topicId: topic.id,
        name: 'Thirty min circle',
        scheduledAt: new Date('2026-09-01T18:00:00.000Z'),
        durationMinutes: 30,
        capacity: 8,
      })
      const sixty = await createSession(db, {
        topicId: topic.id,
        name: 'Sixty min circle',
        scheduledAt: new Date('2026-09-01T18:00:00.000Z'),
        durationMinutes: 60,
        capacity: 8,
      })

      const { sessions } = await listOpenSessions(db, { durationMinutes: 30, limit: 50 })
      const ids = sessions.map((r) => r.id)
      expect(ids).toContain(thirty.id)
      expect(ids).not.toContain(sixty.id)
    })

    test('durationMinutes: null isolates open-ended circles only', async () => {
      const topic = await seedTopic()
      const openEnded = await createSession(db, {
        topicId: topic.id,
        name: 'Open-ended circle',
        scheduledAt: new Date('2026-09-01T18:00:00.000Z'),
        durationMinutes: null,
        capacity: 8,
      })
      const timed = await createSession(db, {
        topicId: topic.id,
        name: 'Timed circle',
        scheduledAt: new Date('2026-09-01T18:00:00.000Z'),
        durationMinutes: 45,
        capacity: 8,
      })

      const { sessions } = await listOpenSessions(db, { durationMinutes: null, limit: 50 })
      const ids = sessions.map((r) => r.id)
      expect(ids).toContain(openEnded.id)
      expect(ids).not.toContain(timed.id)
    })

    test('date isolates circles scheduled that calendar day', async () => {
      const topic = await seedTopic()
      const onDate = await createSession(db, {
        topicId: topic.id,
        name: 'On date circle',
        scheduledAt: new Date('2026-10-05T12:00:00.000Z'),
        durationMinutes: 60,
        capacity: 8,
      })
      const otherDate = await createSession(db, {
        topicId: topic.id,
        name: 'Other date circle',
        scheduledAt: new Date('2026-10-06T12:00:00.000Z'),
        durationMinutes: 60,
        capacity: 8,
      })

      const { sessions } = await listOpenSessions(db, { date: '2026-10-05', limit: 50 })
      const ids = sessions.map((r) => r.id)
      expect(ids).toContain(onDate.id)
      expect(ids).not.toContain(otherDate.id)
    })

    test('a full circle never occupies a page slot alongside open ones', async () => {
      const topic = await seedTopic()
      const full = await createSession(db, {
        topicId: topic.id,
        name: 'Full page-slot circle',
        scheduledAt: new Date('2026-09-01T18:00:00.000Z'),
        durationMinutes: 60,
        capacity: 1,
      })
      const fullUser = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
      await joinSession(db, full.id, fullUser.id)

      const open1 = await createSession(db, {
        topicId: topic.id,
        name: 'Open page-slot circle 1',
        scheduledAt: new Date('2026-09-01T19:00:00.000Z'),
        durationMinutes: 60,
        capacity: 4,
      })
      const open2 = await createSession(db, {
        topicId: topic.id,
        name: 'Open page-slot circle 2',
        scheduledAt: new Date('2026-09-01T20:00:00.000Z'),
        durationMinutes: 60,
        capacity: 4,
      })

      // Schedule mode is newest-first — open2 (20:00) sorts ahead of
      // open1 (19:00).
      const { sessions } = await listOpenSessions(db, { topicId: topic.id, limit: 2 })
      expect(sessions.map((r) => r.id)).toEqual([open2.id, open1.id])
    })
  })

  describe('cursor pagination', () => {
    test('schedule-order pages (no search) are disjoint, newest-first, and terminate', async () => {
      const topic = await seedTopic()
      const created = []
      for (let i = 0; i < 5; i++) {
        created.push(
          await createSession(db, {
            topicId: topic.id,
            name: `Paged circle ${i}`,
            scheduledAt: new Date(2026, 10, 10 + i, 12, 0, 0),
            durationMinutes: 60,
            capacity: 8,
          }),
        )
      }

      const seen: string[] = []
      let cursor: string | undefined
      for (let page = 0; page < 10; page++) {
        const result = await listOpenSessions(db, { topicId: topic.id, limit: 2, cursor })
        seen.push(...result.sessions.map((s) => s.id))
        if (!result.nextCursor) break
        cursor = result.nextCursor
      }

      // Newest-scheduled first — see the listOpenSessions doc comment.
      expect(seen).toEqual(
        created
          .map((c) => c.id)
          .slice()
          .reverse(),
      )
    })

    // Regression test: `pg` converts timestamptz to a JS Date, which only
    // has millisecond resolution, while Postgres itself has microsecond
    // resolution. These four rows share the same millisecond but differ
    // in microseconds — sorted correctly by Postgres, but if the cursor
    // were built from a JS `Date#toISOString()` (millisecond-truncated)
    // instead of Postgres's own exact text representation, a page
    // boundary row would satisfy `> cursor` again on the next page and
    // come back twice.
    test('schedule-order pages never repeat a row when timestamps differ only in microseconds', async () => {
      const topic = await seedTopic()
      const microsecondSuffixes = ['100001', '100002', '100003', '100004']
      const created = []
      for (const suffix of microsecondSuffixes) {
        created.push(
          await createSession(db, {
            topicId: topic.id,
            name: `Microsecond circle ${suffix}`,
            scheduledAt: `2026-11-20T12:00:00.${suffix}Z`,
            durationMinutes: 60,
            capacity: 8,
          }),
        )
      }

      const seen: string[] = []
      let cursor: string | undefined
      for (let page = 0; page < 10; page++) {
        const result = await listOpenSessions(db, { topicId: topic.id, limit: 2, cursor })
        seen.push(...result.sessions.map((s) => s.id))
        if (!result.nextCursor) break
        cursor = result.nextCursor
      }

      expect(seen).toEqual(
        created
          .map((c) => c.id)
          .slice()
          .reverse(),
      )
      expect(new Set(seen).size).toBe(seen.length)
    })

    test('relevance-order pages (search active) are disjoint and terminate', async () => {
      const topic = await seedTopic()
      const marker = crypto.randomUUID().slice(0, 8)
      const created = []
      for (let i = 0; i < 5; i++) {
        created.push(
          await createSession(db, {
            topicId: topic.id,
            name: `Relevance circle ${marker} ${i}`,
            scheduledAt: new Date('2026-09-01T18:00:00.000Z'),
            durationMinutes: 60,
            capacity: 8,
          }),
        )
      }

      const seen = new Set<string>()
      let cursor: string | undefined
      let pages = 0
      for (let page = 0; page < 10; page++) {
        const result = await listOpenSessions(db, { search: marker, limit: 2, cursor })
        result.sessions.forEach((s) => seen.add(s.id))
        pages++
        if (!result.nextCursor) break
        cursor = result.nextCursor
      }

      expect(seen.size).toBe(created.length)
      expect(pages).toBeGreaterThan(1)
    })

    test('direction "before" fetches the page immediately preceding a mid-sequence cursor', async () => {
      const topic = await seedTopic()
      const created = []
      for (let i = 0; i < 6; i++) {
        created.push(
          await createSession(db, {
            topicId: topic.id,
            name: `Before circle ${i}`,
            scheduledAt: new Date(2026, 11, 1 + i, 12, 0, 0),
            durationMinutes: 60,
            capacity: 8,
          }),
        )
      }

      // Newest-first: the first page is rows 5-4, then 3-2 — cursor now
      // points at row 2 (index 2).
      const first = await listOpenSessions(db, { topicId: topic.id, limit: 2 })
      const second = await listOpenSessions(db, { topicId: topic.id, limit: 2, cursor: first.nextCursor! })

      const before = await listOpenSessions(db, {
        topicId: topic.id,
        limit: 2,
        cursor: second.prevCursor!,
        direction: 'before',
      })

      expect(before.sessions.map((s) => s.id)).toEqual([created[5]!.id, created[4]!.id])
      // Backed all the way up to the true start (newest end): nothing
      // precedes it.
      expect(before.prevCursor).toBeNull()
      // But there's still more after (rows 3 onward, into the past) —
      // paging back doesn't lose track of the direction the user came
      // from.
      expect(before.nextCursor).not.toBeNull()
    })

    test('walking forward to the end and back to the start visits every row exactly once each way', async () => {
      const topic = await seedTopic()
      const created = []
      for (let i = 0; i < 7; i++) {
        created.push(
          await createSession(db, {
            topicId: topic.id,
            name: `Walk circle ${i}`,
            scheduledAt: new Date(2026, 11, 10 + i, 9, 0, 0),
            durationMinutes: 60,
            capacity: 8,
          }),
        )
      }
      // Newest-first: the forward walk visits row 6 before row 0.
      const expectedIds = created
        .map((c) => c.id)
        .slice()
        .reverse()

      const forward: string[] = []
      let cursor: string | undefined
      let lastPage = await listOpenSessions(db, { topicId: topic.id, limit: 3, cursor })
      forward.push(...lastPage.sessions.map((s) => s.id))
      while (lastPage.nextCursor) {
        lastPage = await listOpenSessions(db, { topicId: topic.id, limit: 3, cursor: lastPage.nextCursor })
        forward.push(...lastPage.sessions.map((s) => s.id))
      }
      expect(forward).toEqual(expectedIds)
      expect(lastPage.nextCursor).toBeNull()

      // Walk backward from wherever forward paging ended, using prevCursor.
      const backward: string[] = []
      let backCursor = lastPage.prevCursor
      // The last forward page's own rows aren't re-fetched — walking
      // "back to the first marker" means everything *before* that page.
      backward.unshift(...lastPage.sessions.map((s) => s.id))
      while (backCursor) {
        const page = await listOpenSessions(db, { topicId: topic.id, limit: 3, cursor: backCursor, direction: 'before' })
        backward.unshift(...page.sessions.map((s) => s.id))
        backCursor = page.prevCursor
      }

      expect(backward).toEqual(expectedIds)
      expect(new Set(backward).size).toBe(expectedIds.length)
    })

    // The frontend's initial fetch (useOpenSessions in shared.tsx)
    // doesn't pass an empty cursor — it synthesizes a schedule cursor for
    // "now" so the browse list opens anchored at the present rather than
    // at the single furthest-future circle in the dataset. This is a
    // plain schedule cursor like any other; nothing in listOpenSessions
    // needs to know it's synthetic.
    test('a synthetic "now" cursor anchors the browse list at the present', async () => {
      const topic = await seedTopic()
      const past = await createSession(db, {
        topicId: topic.id,
        name: 'Already past',
        scheduledAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        durationMinutes: 60,
        capacity: 8,
      })
      const future = await createSession(db, {
        topicId: topic.id,
        name: 'Still upcoming',
        scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        durationMinutes: 60,
        capacity: 8,
      })

      const nowCursor = `schedule|${new Date().toISOString()}|00000000-0000-0000-0000-000000000000`
      const initial = await listOpenSessions(db, { topicId: topic.id, limit: 50, cursor: nowCursor, direction: 'after' })

      expect(initial.sessions.map((s) => s.id)).toEqual([past.id])
      expect(initial.prevCursor).not.toBeNull()

      const upward = await listOpenSessions(db, {
        topicId: topic.id,
        limit: 50,
        cursor: initial.prevCursor!,
        direction: 'before',
      })
      expect(upward.sessions.map((s) => s.id)).toEqual([future.id])
    })

    test('backward relevance-mode paging round-trips the same way', async () => {
      const topic = await seedTopic()
      const marker = crypto.randomUUID().slice(0, 8)
      const created = []
      for (let i = 0; i < 6; i++) {
        created.push(
          await createSession(db, {
            topicId: topic.id,
            name: `Relevance walk ${marker} ${i}`,
            scheduledAt: new Date('2026-09-01T18:00:00.000Z'),
            durationMinutes: 60,
            capacity: 8,
          }),
        )
      }
      // Relevance order isn't creation order — each row's trigram
      // similarity to `marker` can differ slightly even though they're
      // all near-identical strings — so the ground truth here is
      // whatever order the forward walk itself establishes, not
      // insertion order. What backward paging must reproduce is exactly
      // that established order, and exactly that set of rows.
      const forward: string[] = []
      let lastPage = await listOpenSessions(db, { search: marker, limit: 2 })
      forward.push(...lastPage.sessions.map((s) => s.id))
      while (lastPage.nextCursor) {
        lastPage = await listOpenSessions(db, { search: marker, limit: 2, cursor: lastPage.nextCursor })
        forward.push(...lastPage.sessions.map((s) => s.id))
      }
      expect(new Set(forward)).toEqual(new Set(created.map((c) => c.id)))

      const backward: string[] = [...lastPage.sessions.map((s) => s.id)]
      let backCursor = lastPage.prevCursor
      while (backCursor) {
        const page = await listOpenSessions(db, { search: marker, limit: 2, cursor: backCursor, direction: 'before' })
        backward.unshift(...page.sessions.map((s) => s.id))
        backCursor = page.prevCursor
      }

      expect(backward).toEqual(forward)
    })
  })
})

describe('checkAndSyncGuidelines / recordGuidelinesAgreement', () => {
  test('not agreed with no agreedKeys before agreeing, fully agreed with every key after', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(1)
    const userId = userIds[0] as string

    const before = await checkAndSyncGuidelines(db, sessionId, userId)
    expect(before).toEqual({ agreed: false, agreedKeys: [] })

    await recordGuidelinesAgreement(db, sessionId, userId)

    const after = await checkAndSyncGuidelines(db, sessionId, userId)
    expect(after.agreed).toBe(true)
    expect([...after.agreedKeys].sort()).toEqual([...CIRCLE_GUIDELINE_AGREEMENT_KEYS].sort())
  })

  test('records a real ISO8601 timestamp per key on the session_users row', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(1)
    const userId = userIds[0] as string

    await recordGuidelinesAgreement(db, sessionId, userId)

    const row = await db
      .selectFrom('session_users')
      .select('agreements')
      .where('session_id', '=', sessionId)
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow()
    for (const key of CIRCLE_GUIDELINE_AGREEMENT_KEYS) {
      expect(row.agreements[key]).toBeDefined()
      expect(new Date(row.agreements[key] as string).toISOString()).toBe(row.agreements[key])
    }
  })

  test('is idempotent — a later call never overwrites an already-recorded timestamp', async () => {
    const { sessionId, userIds } = await seedSessionWithUsers(1)
    const userId = userIds[0] as string

    await recordGuidelinesAgreement(db, sessionId, userId)
    const first = await db
      .selectFrom('session_users')
      .select('agreements')
      .where('session_id', '=', sessionId)
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow()

    await new Promise((resolve) => setTimeout(resolve, 10))
    await recordGuidelinesAgreement(db, sessionId, userId)
    const second = await db
      .selectFrom('session_users')
      .select('agreements')
      .where('session_id', '=', sessionId)
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow()

    expect(second.agreements).toEqual(first.agreements)
  })

  test('agreeing on one session is still found on another — checkAndSyncGuidelines looks across every session this user has joined', async () => {
    const sessionA = await seedSessionWithUsers(1)
    const sessionB = await createSession(db)
    const userId = sessionA.userIds[0] as string
    await joinSession(db, sessionB.id, userId)

    await recordGuidelinesAgreement(db, sessionA.sessionId, userId)

    expect((await checkAndSyncGuidelines(db, sessionA.sessionId, userId)).agreed).toBe(true)
    // Never explicitly agreed on session B — still reports agreed,
    // because it looks at every session this user has joined, and syncs
    // the finding onto B's own row too.
    expect((await checkAndSyncGuidelines(db, sessionB.id, userId)).agreed).toBe(true)

    const rowB = await db
      .selectFrom('session_users')
      .select('agreements')
      .where('session_id', '=', sessionB.id)
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow()
    for (const key of CIRCLE_GUIDELINE_AGREEMENT_KEYS) {
      expect(rowB.agreements[key]).toBeDefined()
    }
  })

  // Simulates "a new checkbox was added to CIRCLE_GUIDELINE_AGREEMENT_KEYS
  // after this user already agreed to the old set" by writing a partial
  // agreements object directly — recordGuidelinesAgreement always writes
  // the *current* full set, so it can't reproduce a stale/partial one.
  test('a returning user missing a newly-added required key sees only that key as not-yet-agreed, and it gets synced', async () => {
    const sessionA = await seedSessionWithUsers(1)
    const userId = sessionA.userIds[0] as string

    const partialKeys = CIRCLE_GUIDELINE_AGREEMENT_KEYS.slice(0, -1)
    const originalTimestamp = new Date().toISOString()
    const partialAgreements: Record<string, string> = {}
    for (const key of partialKeys) partialAgreements[key] = originalTimestamp
    await db
      .updateTable('session_users')
      .set({ agreements: sql`${JSON.stringify(partialAgreements)}::jsonb` })
      .where('session_id', '=', sessionA.sessionId)
      .where('user_id', '=', userId)
      .execute()

    const sessionB = await createSession(db)
    await joinSession(db, sessionB.id, userId)

    const status = await checkAndSyncGuidelines(db, sessionB.id, userId)
    expect(status.agreed).toBe(false)
    expect([...status.agreedKeys].sort()).toEqual([...partialKeys].sort())

    // The already-agreed keys synced onto session B's row too, with
    // their *original* timestamp — the new key is genuinely absent.
    const rowB = await db
      .selectFrom('session_users')
      .select('agreements')
      .where('session_id', '=', sessionB.id)
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow()
    for (const key of partialKeys) {
      expect(rowB.agreements[key]).toBe(originalTimestamp)
    }
    const newKey = CIRCLE_GUIDELINE_AGREEMENT_KEYS[CIRCLE_GUIDELINE_AGREEMENT_KEYS.length - 1] as string
    expect(rowB.agreements[newKey]).toBeUndefined()
  })

  test('agreeing to the newly-added key afterward never disturbs the earlier keys\' original timestamps', async () => {
    const sessionA = await seedSessionWithUsers(1)
    const userId = sessionA.userIds[0] as string

    const partialKeys = CIRCLE_GUIDELINE_AGREEMENT_KEYS.slice(0, -1)
    const originalTimestamp = new Date(Date.now() - 60_000).toISOString()
    const partialAgreements: Record<string, string> = {}
    for (const key of partialKeys) partialAgreements[key] = originalTimestamp
    await db
      .updateTable('session_users')
      .set({ agreements: sql`${JSON.stringify(partialAgreements)}::jsonb` })
      .where('session_id', '=', sessionA.sessionId)
      .where('user_id', '=', userId)
      .execute()

    // The user is shown the modal with the old keys pre-checked, checks
    // the new one too, and "Agree and continue" re-submits the full
    // current set — same as recordGuidelinesAgreement always does.
    await recordGuidelinesAgreement(db, sessionA.sessionId, userId)

    const row = await db
      .selectFrom('session_users')
      .select('agreements')
      .where('session_id', '=', sessionA.sessionId)
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow()

    for (const key of partialKeys) {
      expect(row.agreements[key]).toBe(originalTimestamp)
    }
    const newKey = CIRCLE_GUIDELINE_AGREEMENT_KEYS[CIRCLE_GUIDELINE_AGREEMENT_KEYS.length - 1] as string
    expect(row.agreements[newKey]).toBeDefined()
    expect(row.agreements[newKey]).not.toBe(originalTimestamp)
  })
})
