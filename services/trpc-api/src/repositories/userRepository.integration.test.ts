import { afterAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, runMigrations } from '@mincirklen/shared'
import { insertUser, touchUser } from './userRepository'

const pool = createPgPool(
  process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL,
  'test',
)
const db = createDb(pool)

await runMigrations(db, 'test')

afterAll(async () => {
  await db.destroy()
})

describe('userRepository', () => {
  test('insertUser creates a new row with a generated id', async () => {
    const user = await insertUser(db)
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('touchUser returns true and updates last_seen_at for an existing user', async () => {
    const user = await insertUser(db)

    const touched = await touchUser(db, user.id)
    expect(touched).toBe(true)

    const row = await db
      .selectFrom('users')
      .select('last_seen_at')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow()
    expect(row.last_seen_at).not.toBeNull()
  })

  test('touchUser returns false for a user that does not exist', async () => {
    const touched = await touchUser(db, crypto.randomUUID())
    expect(touched).toBe(false)
  })
})
