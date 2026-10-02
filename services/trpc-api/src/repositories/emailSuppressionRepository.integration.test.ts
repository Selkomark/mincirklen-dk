import { afterAll, describe, expect, test } from 'bun:test'
import { DEFAULT_LOCAL_DATABASE_URL, createDb, createPgPool, runMigrations } from '@mincirklen/shared'
import { hasActiveSuppression, listEmailSuppressions, upsertEmailSuppression } from './emailSuppressionRepository'

const pool = createPgPool(process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL, 'test')
const db = createDb(pool)

await runMigrations(db, 'test')

afterAll(async () => {
  await db.destroy()
})

describe('emailSuppressionRepository', () => {
  test('upserts by recipient and domain, and reports an active suppression', async () => {
    const hash = crypto.randomUUID()
    expect(await hasActiveSuppression(db, hash)).toBe(false)
    await upsertEmailSuppression(db, { recipientHash: hash, recipientMasked: 'a***@x', sendingDomain: null, reason: 'bounce', expiresAt: null, raw: { v: 1 } })
    expect(await hasActiveSuppression(db, hash)).toBe(true)
    await upsertEmailSuppression(db, { recipientHash: hash, recipientMasked: 'a***@x', sendingDomain: null, reason: 'complaint', expiresAt: null, raw: { v: 2 } })
    const all = await listEmailSuppressions(db, { limit: 100 })
    const mine = all.suppressions.filter((s) => s.recipientMasked === 'a***@x' && s.sendingDomain === '')
    const row = await db.selectFrom('email_suppressions').selectAll().where('recipient_hash', '=', hash).execute()
    expect(row.length).toBe(1)
    expect(row[0]?.reason).toBe('complaint')
    expect(row[0]?.raw).toEqual({ v: 2 })
    expect(mine.length).toBeGreaterThanOrEqual(1)
  })

  test('an expired suppression is not active; a future one is', async () => {
    const expired = crypto.randomUUID()
    await upsertEmailSuppression(db, { recipientHash: expired, recipientMasked: 'e***@x', sendingDomain: 'mail.x', reason: null, expiresAt: new Date(Date.now() - 1000), raw: {} })
    expect(await hasActiveSuppression(db, expired)).toBe(false)
    const future = crypto.randomUUID()
    await upsertEmailSuppression(db, { recipientHash: future, recipientMasked: 'f***@x', sendingDomain: 'mail.x', reason: 'r', expiresAt: new Date(Date.now() + 60_000), raw: {} })
    expect(await hasActiveSuppression(db, future)).toBe(true)
  })

  test('pages newest first', async () => {
    for (let i = 0; i < 3; i++) await upsertEmailSuppression(db, { recipientHash: crypto.randomUUID(), recipientMasked: `p${i}***@x`, sendingDomain: '', reason: null, expiresAt: null, raw: {} })
    const page1 = await listEmailSuppressions(db, { limit: 2 })
    expect(page1.suppressions.length).toBe(2)
    expect(page1.nextCursor).not.toBeNull()
    const page2 = await listEmailSuppressions(db, { cursor: page1.nextCursor as string, limit: 2 })
    const ids = [...page1.suppressions, ...page2.suppressions].map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(() => listEmailSuppressions(db, { cursor: 'bad', limit: 1 })).toThrow('invalid cursor')
  })
})
