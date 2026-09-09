import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FileMigrationProvider, Migrator, NO_MIGRATIONS, sql } from 'kysely'
import { Pool } from 'pg'
import { createDb } from './kysely'
import { runCliMigration, runMigrations } from './migrate'
import { DEFAULT_LOCAL_DATABASE_URL } from './pool'

const REAL_MIGRATION_FOLDER = path.resolve(import.meta.dir, '..', '..', 'migrations')
const SCHEMA = 'test'

const ADMIN_URL = process.env.DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL
const TEST_DB_NAME = 'mincirklen_migrate_test_tmp'

function connectionStringFor(dbName: string): string {
  const url = new URL(ADMIN_URL)
  url.pathname = `/${dbName}`
  return url.toString()
}

// Never `public` — every pool built directly against TEST_DB_NAME in this
// file (bypassing createPgPool, since these tests exercise the migration
// machinery at a lower level) still has to point at a real schema.
function poolFor(dbName: string): Pool {
  return new Pool({ connectionString: connectionStringFor(dbName), options: `-c search_path=${SCHEMA}` })
}

const adminPool = new Pool({ connectionString: ADMIN_URL })

async function resetTestDatabase(): Promise<void> {
  await adminPool.query(
    'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
    [TEST_DB_NAME],
  )
  await adminPool.query(`drop database if exists ${TEST_DB_NAME}`)
  await adminPool.query(`create database ${TEST_DB_NAME}`)
}

beforeAll(resetTestDatabase)

afterAll(async () => {
  await adminPool.query(`drop database if exists ${TEST_DB_NAME}`)
  await adminPool.end()
})

describe('runMigrations', () => {
  test('applies migrations to a fresh database and is a no-op the second time', async () => {
    const pool = poolFor(TEST_DB_NAME)
    const db = createDb(pool)

    try {
      await runMigrations(db, SCHEMA)

      const tables = await db.introspection.getTables()
      expect(tables.map((t) => t.name)).toEqual(
        expect.arrayContaining([
          'users',
          'sessions',
          'session_users',
          'messages',
          'moderation_events',
          'feedback_ratings',
        ]),
      )

      await expect(runMigrations(db, SCHEMA)).resolves.toBeUndefined()
    } finally {
      await db.destroy()
    }
  })

  test('surfaces and stops on a migration error', async () => {
    const brokenDir = await mkdtemp(path.join(tmpdir(), 'mincirklen-broken-migration-'))
    await writeFile(
      path.join(brokenDir, '0001_broken.ts'),
      [
        "import type { Kysely } from 'kysely'",
        'export async function up(db: Kysely<any>): Promise<void> {',
        "  await db.schema.dropTable('table_that_does_not_exist').execute()",
        '}',
        'export async function down(): Promise<void> {}',
        '',
      ].join('\n'),
    )

    const pool = poolFor(TEST_DB_NAME)
    const db = createDb(pool)

    try {
      await expect(runMigrations(db, SCHEMA, brokenDir)).rejects.toBeTruthy()
    } finally {
      await db.destroy()
      await rm(brokenDir, { recursive: true, force: true })
    }
  })

  test('down() reverses every migration', async () => {
    const pool = poolFor(TEST_DB_NAME)
    const db = createDb(pool)

    try {
      await sql`create schema if not exists ${sql.ref(SCHEMA)}`.execute(db)

      const migrator = new Migrator({
        db,
        provider: new FileMigrationProvider({ fs, path, migrationFolder: REAL_MIGRATION_FOLDER }),
        migrationTableSchema: SCHEMA,
      })

      await migrator.migrateToLatest()
      // Step all the way back to zero migrations applied, rather than one
      // step, so this stays correct as more migration files are added.
      const { error } = await migrator.migrateTo(NO_MIGRATIONS)
      expect(error).toBeUndefined()

      const tables = await db.introspection.getTables()
      expect(tables.map((t) => t.name)).not.toContain('users')
    } finally {
      await db.destroy()
    }
  })
})

describe('runCliMigration', () => {
  test('connects, migrates, and closes the pool', async () => {
    await expect(runCliMigration(connectionStringFor(TEST_DB_NAME), SCHEMA)).resolves.toBeUndefined()
  })
})
