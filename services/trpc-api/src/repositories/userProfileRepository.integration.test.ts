import { afterAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, runMigrations } from '@mincirklen/shared'
import { findDisplayNames, findUserProfileByUserId, upsertUserProfile } from './userProfileRepository'

const pool = createPgPool(
  process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL,
  'test',
)
const db = createDb(pool)

const KMS = {
  provider: 'vault' as const,
  vaultAddr: process.env.TEST_VAULT_ADDR ?? 'http://localhost:8200',
  vaultToken: process.env.TEST_VAULT_TOKEN ?? 'dev-only-not-for-production',
}

await runMigrations(db, 'test')

afterAll(async () => {
  await db.destroy()
})

async function insertTestUser() {
  return db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
}

describe('userProfileRepository', () => {
  test('upsertUserProfile creates a profile for a user with no profile yet', async () => {
    const user = await insertTestUser()
    const termsAcceptedAt = new Date()

    const profile = await upsertUserProfile(db, KMS, {
      userId: user.id,
      firstName: 'Ada',
      lastName: 'Lovelace',
      gender: 'other',
      country: 'GB',
      mobileNumber: '+44 20 7946 0958',
      stayAnonymous: true,
      termsAcceptedAt,
    })

    expect(profile.userId).toBe(user.id)
    expect(profile.firstName).toBe('Ada')
    expect(profile.lastName).toBe('Lovelace')
    expect(profile.country).toBe('GB')
    expect(profile.mobileNumber).toBe('+44 20 7946 0958')
    expect(profile.stayAnonymous).toBe(true)
    expect(profile.termsAcceptedAt.getTime()).toBe(termsAcceptedAt.getTime())
  })

  test('the name and mobile number are not stored as plaintext', async () => {
    const user = await insertTestUser()

    await upsertUserProfile(db, KMS, {
      userId: user.id,
      firstName: 'Ada',
      lastName: 'Lovelace',
      gender: 'other',
      country: 'GB',
      mobileNumber: '+44 20 7946 0958',
      stayAnonymous: true,
      termsAcceptedAt: new Date(),
    })

    const row = await db
      .selectFrom('user_profiles')
      .select(['pii_ciphertext', 'country'])
      .where('user_id', '=', user.id)
      .executeTakeFirstOrThrow()

    expect(row.pii_ciphertext).not.toContain('Ada')
    expect(row.pii_ciphertext).not.toContain('Lovelace')
    expect(row.pii_ciphertext).not.toContain('7946')
    expect(row.pii_ciphertext.startsWith('vault:v1:')).toBe(true)
    // country stays plaintext — not PII on its own.
    expect(row.country).toBe('GB')
  })

  test('upsertUserProfile replaces an existing profile for the same user', async () => {
    const user = await insertTestUser()

    await upsertUserProfile(db, KMS, {
      userId: user.id,
      firstName: 'Ada',
      lastName: 'Lovelace',
      gender: 'other',
      country: 'GB',
      mobileNumber: '+44 20 7946 0958',
      stayAnonymous: true,
      termsAcceptedAt: new Date(),
    })

    const updated = await upsertUserProfile(db, KMS, {
      userId: user.id,
      firstName: 'Grace',
      lastName: 'Hopper',
      gender: 'other',
      country: 'US',
      mobileNumber: '+1 202 555 0119',
      stayAnonymous: false,
      termsAcceptedAt: new Date(),
    })

    expect(updated.firstName).toBe('Grace')
    expect(updated.lastName).toBe('Hopper')
    expect(updated.country).toBe('US')
    expect(updated.stayAnonymous).toBe(false)

    const found = await findUserProfileByUserId(db, KMS, user.id)
    expect(found?.firstName).toBe('Grace')
  })

  test('findUserProfileByUserId returns null when no profile exists', async () => {
    const user = await insertTestUser()
    expect(await findUserProfileByUserId(db, KMS, user.id)).toBeNull()
  })

  describe('findDisplayNames', () => {
    test('returns an empty map without querying anything for an empty userIds list', async () => {
      expect(await findDisplayNames(db, KMS, [])).toEqual(new Map())
    })

    test('only includes members who have turned off stay_anonymous, and omits anyone else', async () => {
      const named = await insertTestUser()
      const anonymous = await insertTestUser()
      const noProfile = await insertTestUser()

      await upsertUserProfile(db, KMS, {
        userId: named.id,
        firstName: 'Grace',
        lastName: 'Hopper',
        gender: 'other',
        country: 'US',
        mobileNumber: '+1 202 555 0119',
        stayAnonymous: false,
        termsAcceptedAt: new Date(),
      })
      await upsertUserProfile(db, KMS, {
        userId: anonymous.id,
        firstName: 'Ada',
        lastName: 'Lovelace',
        gender: 'other',
        country: 'GB',
        mobileNumber: '+44 20 7946 0958',
        stayAnonymous: true,
        termsAcceptedAt: new Date(),
      })

      const result = await findDisplayNames(db, KMS, [named.id, anonymous.id, noProfile.id])
      expect(result).toEqual(new Map([[named.id, 'Grace']]))
    })

    test('a member who turns stay_anonymous back on stops appearing on the very next call', async () => {
      const user = await insertTestUser()
      await upsertUserProfile(db, KMS, {
        userId: user.id,
        firstName: 'Grace',
        lastName: 'Hopper',
        gender: 'other',
        country: 'US',
        mobileNumber: '+1 202 555 0119',
        stayAnonymous: false,
        termsAcceptedAt: new Date(),
      })
      expect((await findDisplayNames(db, KMS, [user.id])).get(user.id)).toBe('Grace')

      await upsertUserProfile(db, KMS, {
        userId: user.id,
        firstName: 'Grace',
        lastName: 'Hopper',
        gender: 'other',
        country: 'US',
        mobileNumber: '+1 202 555 0119',
        stayAnonymous: true,
        termsAcceptedAt: new Date(),
      })
      expect(await findDisplayNames(db, KMS, [user.id])).toEqual(new Map())
    })
  })
})
