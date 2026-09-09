import { afterAll, describe, expect, test } from 'bun:test'
import { createDb } from './kysely'
import { runMigrations } from './migrate'
import { DEFAULT_LOCAL_DATABASE_URL, createPgPool } from './pool'
import { SEED_USER_ID, SEED_SESSION_ID, seedTestDb } from './seed'

const pool = createPgPool(process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL, 'test')
const db = createDb(pool)

await runMigrations(db, 'test')

afterAll(async () => {
  await db.destroy()
})

describe('seedTestDb', () => {
  test('inserts the fixed seed rows and is safe to run again', async () => {
    await seedTestDb(db)
    await seedTestDb(db)

    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', SEED_USER_ID)
      .executeTakeFirstOrThrow()
    expect(user.id).toBe(SEED_USER_ID)

    const session = await db
      .selectFrom('sessions')
      .selectAll()
      .where('id', '=', SEED_SESSION_ID)
      .executeTakeFirstOrThrow()
    expect(session.id).toBe(SEED_SESSION_ID)
  })
})
