import { afterAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, runMigrations } from '@mincirklen/shared'
import { countsByGateKey, findSignupById, insertSignup, listSignups, markGranted, markRevoked } from './gateSignupRepository'

const pool = createPgPool(
  process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL,
  'test',
)
const db = createDb(pool)

await runMigrations(db, 'test')

afterAll(async () => {
  await db.destroy()
})

function uniqueEmail(): string {
  return `${crypto.randomUUID()}@example.com`
}

describe('insertSignup', () => {
  test('inserts a new signup as pending', async () => {
    const gateKey = `gate-${crypto.randomUUID()}`
    const email = uniqueEmail()

    await insertSignup(db, gateKey, email)

    const { signups } = await listSignups(db, gateKey, { limit: 10 })
    expect(signups).toHaveLength(1)
    expect(signups[0]).toMatchObject({ gateKey, email, status: 'pending', grantedAt: null, grantedBy: null })
  })

  test('resubmitting the same email for the same gate is a silent no-op', async () => {
    const gateKey = `gate-${crypto.randomUUID()}`
    const email = uniqueEmail()

    await insertSignup(db, gateKey, email)
    await insertSignup(db, gateKey, email)

    const { signups } = await listSignups(db, gateKey, { limit: 10 })
    expect(signups).toHaveLength(1)
  })

  test('the same email can independently join two different gates', async () => {
    const gateA = `gate-${crypto.randomUUID()}`
    const gateB = `gate-${crypto.randomUUID()}`
    const email = uniqueEmail()

    await insertSignup(db, gateA, email)
    await insertSignup(db, gateB, email)

    expect((await listSignups(db, gateA, { limit: 10 })).signups).toHaveLength(1)
    expect((await listSignups(db, gateB, { limit: 10 })).signups).toHaveLength(1)
  })
})

describe('listSignups', () => {
  test('filters by status', async () => {
    const gateKey = `gate-${crypto.randomUUID()}`
    await insertSignup(db, gateKey, uniqueEmail())
    await insertSignup(db, gateKey, uniqueEmail())
    await insertSignup(db, gateKey, uniqueEmail())
    const [{ signups: all }] = [await listSignups(db, gateKey, { limit: 10 })]
    await markGranted(db, all[0]!.id, 'admin:test')
    await markGranted(db, all[1]!.id, 'admin:test')
    await markRevoked(db, all[1]!.id)

    const pending = await listSignups(db, gateKey, { status: 'pending', limit: 10 })
    const granted = await listSignups(db, gateKey, { status: 'granted', limit: 10 })
    const revoked = await listSignups(db, gateKey, { status: 'revoked', limit: 10 })

    expect(pending.signups).toHaveLength(1)
    expect(granted.signups).toHaveLength(1)
    expect(granted.signups[0]!.id).toBe(all[0]!.id)
    expect(revoked.signups).toHaveLength(1)
    expect(revoked.signups[0]!.id).toBe(all[1]!.id)
  })

  test('paginates with a cursor and reports nextCursor only when more remain', async () => {
    const gateKey = `gate-${crypto.randomUUID()}`
    for (let i = 0; i < 3; i++) {
      await insertSignup(db, gateKey, uniqueEmail())
    }

    const firstPage = await listSignups(db, gateKey, { limit: 2 })
    expect(firstPage.signups).toHaveLength(2)
    expect(firstPage.nextCursor).not.toBeNull()

    const secondPage = await listSignups(db, gateKey, { limit: 2, cursor: firstPage.nextCursor! })
    expect(secondPage.signups).toHaveLength(1)
    expect(secondPage.nextCursor).toBeNull()
  })
})

describe('markGranted / findSignupById', () => {
  test('marks a signup granted and records who granted it', async () => {
    const gateKey = `gate-${crypto.randomUUID()}`
    await insertSignup(db, gateKey, uniqueEmail())
    const [signup] = (await listSignups(db, gateKey, { limit: 1 })).signups

    const granted = await markGranted(db, signup!.id, 'admin:test')

    expect(granted).toMatchObject({ id: signup!.id, status: 'granted', grantedBy: 'admin:test' })
    expect(granted!.grantedAt).not.toBeNull()

    const refetched = await findSignupById(db, signup!.id)
    expect(refetched?.status).toBe('granted')
  })

  test('returns null for a signup that does not exist', async () => {
    expect(await markGranted(db, crypto.randomUUID(), 'admin:test')).toBeNull()
    expect(await findSignupById(db, crypto.randomUUID())).toBeNull()
  })
})

describe('markRevoked', () => {
  test('revokes a granted signup, leaving grantedAt/grantedBy as a historical record', async () => {
    const gateKey = `gate-${crypto.randomUUID()}`
    await insertSignup(db, gateKey, uniqueEmail())
    const [signup] = (await listSignups(db, gateKey, { limit: 1 })).signups
    await markGranted(db, signup!.id, 'admin:test')

    const revoked = await markRevoked(db, signup!.id)

    expect(revoked).toMatchObject({ id: signup!.id, status: 'revoked', grantedBy: 'admin:test' })
    expect(revoked!.grantedAt).not.toBeNull()

    const refetched = await findSignupById(db, signup!.id)
    expect(refetched?.status).toBe('revoked')
  })

  // The Revoke button (GatesTab.tsx) only appears on a granted row, but
  // this is what actually enforces "only a granted signup can be
  // revoked" — a stale UI, a double-click, or a direct API call against
  // a pending or already-revoked row must all be no-ops, not a status
  // flip that shouldn't happen.
  test('is a no-op for a signup that is not currently granted', async () => {
    const gateKey = `gate-${crypto.randomUUID()}`
    await insertSignup(db, gateKey, uniqueEmail())
    const [signup] = (await listSignups(db, gateKey, { limit: 1 })).signups

    expect(await markRevoked(db, signup!.id)).toBeNull()

    await markGranted(db, signup!.id, 'admin:test')
    await markRevoked(db, signup!.id)
    expect(await markRevoked(db, signup!.id)).toBeNull()
  })

  test('returns null for a signup that does not exist', async () => {
    expect(await markRevoked(db, crypto.randomUUID())).toBeNull()
  })
})

describe('countsByGateKey', () => {
  test('groups pending/granted/revoked counts per gate in one pass', async () => {
    const gateKey = `gate-${crypto.randomUUID()}`
    await insertSignup(db, gateKey, uniqueEmail())
    await insertSignup(db, gateKey, uniqueEmail())
    await insertSignup(db, gateKey, uniqueEmail())
    const [{ signups }] = [await listSignups(db, gateKey, { limit: 10 })]
    await markGranted(db, signups[0]!.id, 'admin:test')
    await markGranted(db, signups[1]!.id, 'admin:test')
    await markRevoked(db, signups[1]!.id)

    const counts = await countsByGateKey(db)

    expect(counts.get(gateKey)).toEqual({ pending: 1, granted: 1, revoked: 1 })
  })

  test('a gate with no signups at all is simply absent from the map', async () => {
    const counts = await countsByGateKey(db)
    expect(counts.get(`gate-${crypto.randomUUID()}`)).toBeUndefined()
  })
})
