import type { Kysely } from 'kysely'
import type { Database } from './types'

// Fixed IDs + onConflict-doNothing so integration tests can call this on
// every run without unique-constraint failures.
export const SEED_USER_ID = '00000000-0000-0000-0000-000000000001'
export const SEED_SESSION_ID = '00000000-0000-0000-0000-000000000002'

export async function seedTestDb(db: Kysely<Database>): Promise<void> {
  await db
    .insertInto('users')
    .values({ id: SEED_USER_ID })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute()

  await db
    .insertInto('sessions')
    .values({ id: SEED_SESSION_ID, status: 'forming' })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute()
}
