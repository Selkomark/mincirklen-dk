import { afterAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, runMigrations } from '@mincirklen/shared'
import { getPostgresTurnState, writeBackAdvancedTurn, writeBackClaimedTurn } from './sessionStateRepository'

const pool = createPgPool(process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL, 'test')
const db = createDb(pool)

await runMigrations(db, 'test')

afterAll(async () => {
  await db.destroy()
})

describe('getPostgresTurnState', () => {
  test('returns null for a session that does not exist', async () => {
    expect(await getPostgresTurnState(db, crypto.randomUUID())).toBeNull()
  })

  test('returns the current turn holder and turn-ordered roster for a session with members', async () => {
    const alice = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const bob = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const session = await db
      .insertInto('sessions')
      .values({ status: 'active', current_turn_user_id: alice.id })
      .returningAll()
      .executeTakeFirstOrThrow()
    await db
      .insertInto('session_users')
      .values([
        { session_id: session.id, user_id: alice.id, turn_order: 0 },
        { session_id: session.id, user_id: bob.id, turn_order: 1 },
      ])
      .execute()

    const state = await getPostgresTurnState(db, session.id)

    expect(state).toEqual({
      currentTurnUserId: alice.id,
      roster: [
        { userId: alice.id, turnOrder: 0 },
        { userId: bob.id, turnOrder: 1 },
      ],
    })
  })

  test('returns an empty roster and null current turn for a session nobody has joined yet', async () => {
    const session = await db.insertInto('sessions').defaultValues().returningAll().executeTakeFirstOrThrow()

    const state = await getPostgresTurnState(db, session.id)

    expect(state).toEqual({ currentTurnUserId: null, roster: [] })
  })
})

describe('writeBackAdvancedTurn / writeBackClaimedTurn', () => {
  test('mirrors a new current turn holder and clears the claim', async () => {
    const alice = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const bob = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const session = await db
      .insertInto('sessions')
      .values({ status: 'active', current_turn_user_id: alice.id })
      .returningAll()
      .executeTakeFirstOrThrow()

    await writeBackAdvancedTurn(db, session.id, bob.id)

    const updated = await db
      .selectFrom('sessions')
      .select(['current_turn_user_id', 'turn_claimed_at'])
      .where('id', '=', session.id)
      .executeTakeFirstOrThrow()
    expect(updated.current_turn_user_id).toBe(bob.id)
    expect(updated.turn_claimed_at).toBeNull()
  })

  test('mirrors the turn going to nobody (empty roster) as a null current turn', async () => {
    const alice = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const session = await db
      .insertInto('sessions')
      .values({ status: 'active', current_turn_user_id: alice.id })
      .returningAll()
      .executeTakeFirstOrThrow()

    await writeBackAdvancedTurn(db, session.id, null)

    const updated = await db
      .selectFrom('sessions')
      .select(['current_turn_user_id'])
      .where('id', '=', session.id)
      .executeTakeFirstOrThrow()
    expect(updated.current_turn_user_id).toBeNull()
  })

  test('is a no-op, not a throw, for a session that no longer exists', async () => {
    await expect(writeBackAdvancedTurn(db, crypto.randomUUID(), null)).resolves.toBeUndefined()
  })

  test('writeBackClaimedTurn records the claim timestamp without touching the turn holder', async () => {
    const alice = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const session = await db
      .insertInto('sessions')
      .values({ status: 'active', current_turn_user_id: alice.id })
      .returningAll()
      .executeTakeFirstOrThrow()
    const claimedAt = new Date('2026-01-01T00:00:00Z')

    await writeBackClaimedTurn(db, session.id, claimedAt)

    const updated = await db
      .selectFrom('sessions')
      .select(['current_turn_user_id', 'turn_claimed_at'])
      .where('id', '=', session.id)
      .executeTakeFirstOrThrow()
    expect(updated.current_turn_user_id).toBe(alice.id)
    expect(updated.turn_claimed_at?.toISOString()).toBe(claimedAt.toISOString())
  })
})
