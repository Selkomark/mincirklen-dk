import { afterAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, runMigrations } from '@mincirklen/shared'
import { listActiveTopics } from './topicRepository'

const pool = createPgPool(
  process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL,
  'test',
)
const db = createDb(pool)

await runMigrations(db, 'test')

afterAll(async () => {
  await db.destroy()
})

const SEEDED_SLUGS = ['grief', 'anxiety', 'parenting', 'chronic', 'career', 'sleep']

describe('listActiveTopics', () => {
  test('returns the seeded topics ordered by sort_order', async () => {
    const topics = await listActiveTopics(db)

    const seeded = topics.filter((t) => SEEDED_SLUGS.includes(t.slug))
    expect(seeded.map((t) => t.slug)).toEqual(SEEDED_SLUGS)
    expect(seeded[0]).toEqual({ id: expect.any(String), slug: 'grief', label: 'Grief' })
  })

  test('excludes inactive topics', async () => {
    const inactive = await db
      .insertInto('topics')
      .values({ slug: `test-inactive-topic-${crypto.randomUUID()}`, label: 'Inactive test topic', is_active: false })
      .returningAll()
      .executeTakeFirstOrThrow()

    const topics = await listActiveTopics(db)

    expect(topics.some((t) => t.id === inactive.id)).toBe(false)
  })
})
