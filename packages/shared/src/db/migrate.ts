import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FileMigrationProvider, Migrator, sql, type Kysely } from 'kysely'
import { DEFAULT_LOCAL_DATABASE_URL } from './pool'
import type { Database } from './types'

const defaultMigrationFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations',
)

// `schema` must be `dev` or `test` — never `public` (docs/local_dev.md).
// Creating it here (idempotent) means no separate one-time setup step is
// needed on a fresh database: every caller already calls this before doing
// anything else. Kysely's own migration-bookkeeping tables land in it too
// (via `migrationTableSchema` below), not in `public`.
export async function runMigrations(
  db: Kysely<Database>,
  schema: string,
  migrationFolder = defaultMigrationFolder,
): Promise<void> {
  await sql`create schema if not exists ${sql.ref(schema)}`.execute(db)

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({ fs, path, migrationFolder }),
    migrationTableSchema: schema,
  })

  const { error, results } = await migrator.migrateToLatest()

  for (const result of results ?? []) {
    if (result.status === 'Success') {
      console.log(`migration "${result.migrationName}" applied`)
    } else if (result.status === 'Error') {
      // Not reached with the current Kysely version — a failing `up()`
      // rejects `migrateToLatest` directly rather than returning an
      // 'Error'-status entry in `results`. Kept for type-correctness and
      // in case that behavior changes; see the `error` check below for
      // what actually fires on failure today.
      console.error(`migration "${result.migrationName}" failed`)
    }
  }

  if (error) {
    throw error
  }
}

export async function runCliMigration(
  databaseUrl = process.env.DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL,
  schema = 'dev',
): Promise<void> {
  const { createPgPool } = await import('./pool')
  const { createDb } = await import('./kysely')

  const pool = createPgPool(databaseUrl, schema)
  const db = createDb(pool)

  await runMigrations(db, schema)
  await db.destroy()
}

if (import.meta.main) {
  await runCliMigration()
}
