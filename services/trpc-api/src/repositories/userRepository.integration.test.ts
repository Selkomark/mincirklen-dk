import { afterAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, runMigrations } from '@mincirklen/shared'
import { findEmailAndLanguageForUser, insertUser, setEmail, touchUser } from './userRepository'
import { upsertUserProfile } from './userProfileRepository'
import { encryptField } from '../adapters/kmsAdapter'

const KMS = {
  provider: 'vault' as const,
  vaultAddr: process.env.TEST_VAULT_ADDR ?? 'http://localhost:8200',
  vaultToken: process.env.TEST_VAULT_TOKEN ?? 'dev-only-not-for-production',
}

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

  test('findEmailAndLanguageForUser returns the decrypted address with the profile language, or null without an address', async () => {
    const user = await insertUser(db)
    expect(await findEmailAndLanguageForUser(db, KMS, user.id)).toBeNull()
    await setEmail(db, user.id, await encryptField(KMS, 'member@example.com'))
    expect(await findEmailAndLanguageForUser(db, KMS, user.id)).toEqual({ email: 'member@example.com', language: null })
    await upsertUserProfile(db, KMS, {
      userId: user.id, firstName: 'A', lastName: 'B', gender: 'other', country: 'DK', mobileNumber: '+4512345678',
      stayAnonymous: true, termsAcceptedAt: new Date(), language: 'da',
    })
    expect(await findEmailAndLanguageForUser(db, KMS, user.id)).toEqual({ email: 'member@example.com', language: 'da' })
    expect(await findEmailAndLanguageForUser(db, KMS, crypto.randomUUID())).toBeNull()
  })
})
