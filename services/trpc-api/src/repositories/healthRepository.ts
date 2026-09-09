import type { Database } from '@mincirklen/shared'
import { sql, type Kysely } from 'kysely'

export async function pingDatabase(db: Kysely<Database>): Promise<void> {
  const result = await sql<{ ok: number }>`select 1 as ok`.execute(db)
  // Defensive: `select 1 as ok` cannot return anything else against a real
  // Postgres connection, so this branch has no reachable integration-test
  // path — flagged rather than covered with a contrived fake Kysely db.
  if (result.rows[0]?.ok !== 1) {
    throw new Error('unexpected response')
  }
}
