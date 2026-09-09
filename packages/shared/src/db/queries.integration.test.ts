import { afterAll, describe, expect, test } from 'bun:test'
import { createDb } from './kysely'
import { runMigrations } from './migrate'
import { DEFAULT_LOCAL_DATABASE_URL, createPgPool } from './pool'
import { isSessionMember } from './queries'

const pool = createPgPool(process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL, 'test')
const db = createDb(pool)

await runMigrations(db, 'test')

afterAll(async () => {
  await db.destroy()
})

describe('isSessionMember', () => {
  test('reflects membership accurately', async () => {
    const session = await db.insertInto('sessions').defaultValues().returningAll().executeTakeFirstOrThrow()
    const member = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const outsider = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()

    await db
      .insertInto('session_users')
      .values({ session_id: session.id, user_id: member.id, turn_order: 0 })
      .execute()

    expect(await isSessionMember(db, session.id, member.id)).toBe(true)
    expect(await isSessionMember(db, session.id, outsider.id)).toBe(false)
  })
})
