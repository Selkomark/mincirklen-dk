import { afterAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, runMigrations } from '@mincirklen/shared'
import { findState, listStates, upsertState } from './featureGateStateRepository'

const pool = createPgPool(
  process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL,
  'test',
)
const db = createDb(pool)

await runMigrations(db, 'test')

afterAll(async () => {
  await db.destroy()
})

describe('findState', () => {
  test('null when no override has ever been written for this key', async () => {
    expect(await findState(db, `gate-${crypto.randomUUID()}`)).toBeNull()
  })
})

describe('upsertState / findState', () => {
  test('writes a new override row', async () => {
    const key = `gate-${crypto.randomUUID()}`
    const scheduledOpenAt = new Date('2027-01-01T00:00:00Z')

    await upsertState(db, key, { mode: 'invite_only', scheduledOpenAt, updatedBy: 'admin:test' })

    const state = await findState(db, key)
    expect(state).toMatchObject({ key, mode: 'invite_only', updatedBy: 'admin:test' })
    expect(state?.scheduledOpenAt?.toISOString()).toBe(scheduledOpenAt.toISOString())
  })

  test('a second call overwrites the first rather than erroring', async () => {
    const key = `gate-${crypto.randomUUID()}`

    await upsertState(db, key, { mode: 'invite_only', scheduledOpenAt: null, updatedBy: 'admin:one' })
    await upsertState(db, key, { mode: 'open', scheduledOpenAt: null, updatedBy: 'admin:two' })

    const state = await findState(db, key)
    expect(state).toMatchObject({ mode: 'open', updatedBy: 'admin:two' })
  })

  test('clears a schedule by upserting null', async () => {
    const key = `gate-${crypto.randomUUID()}`

    await upsertState(db, key, { mode: 'invite_only', scheduledOpenAt: new Date(), updatedBy: 'admin:test' })
    await upsertState(db, key, { mode: 'invite_only', scheduledOpenAt: null, updatedBy: 'admin:test' })

    expect((await findState(db, key))?.scheduledOpenAt).toBeNull()
  })
})

describe('listStates', () => {
  test('includes every override row written so far', async () => {
    const key = `gate-${crypto.randomUUID()}`
    await upsertState(db, key, { mode: 'open', scheduledOpenAt: null, updatedBy: 'admin:test' })

    const states = await listStates(db)
    expect(states.some((s) => s.key === key)).toBe(true)
  })
})
