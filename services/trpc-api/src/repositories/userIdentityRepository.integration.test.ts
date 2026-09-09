import { afterAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, runMigrations } from '@mincirklen/shared'
import { findUserIdByIdentity, hasLinkedIdentityForUser, linkIdentity } from './userIdentityRepository'

const pool = createPgPool(
  process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL,
  'test',
)
const db = createDb(pool)

await runMigrations(db, 'test')

afterAll(async () => {
  await db.destroy()
})

describe('findUserIdByIdentity / linkIdentity', () => {
  test('returns null when no identity is linked yet, then finds it after linking', async () => {
    const user = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const subjectHash = `hash-${crypto.randomUUID()}`

    expect(await findUserIdByIdentity(db, 'google', subjectHash)).toBeNull()

    await linkIdentity(db, user.id, 'google', subjectHash)

    expect(await findUserIdByIdentity(db, 'google', subjectHash)).toBe(user.id)
  })

  test('enforces one user per (provider, subject hash)', async () => {
    const userA = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const userB = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const subjectHash = `hash-${crypto.randomUUID()}`

    await linkIdentity(db, userA.id, 'google', subjectHash)

    await expect(linkIdentity(db, userB.id, 'google', subjectHash)).rejects.toBeTruthy()
  })

  test('the same user can hold identities from different providers', async () => {
    const user = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
    const subjectHash = `hash-${crypto.randomUUID()}`

    await linkIdentity(db, user.id, 'google', subjectHash)
    await expect(linkIdentity(db, user.id, 'apple', subjectHash)).resolves.toBeUndefined()
  })
})

describe('hasLinkedIdentityForUser', () => {
  test('false for a user with no linked identity, true after linking one', async () => {
    const user = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()

    expect(await hasLinkedIdentityForUser(db, user.id)).toBe(false)

    await linkIdentity(db, user.id, 'google', `hash-${crypto.randomUUID()}`)

    expect(await hasLinkedIdentityForUser(db, user.id)).toBe(true)
  })
})
