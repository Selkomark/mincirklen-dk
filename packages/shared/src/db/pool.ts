import { Pool } from 'pg'

// The local docker-compose Postgres (see docker-compose.yml's `postgres`
// service) — the one default every service/test file falls back to when
// DATABASE_URL/TEST_DATABASE_URL isn't set. Centralized so the connection
// string lives in exactly one place instead of copy-pasted at every call
// site; `dev` vs `test` isolation comes from the schema argument to
// createPgPool, not from a different host/port.
export const DEFAULT_LOCAL_DATABASE_URL = 'postgres://mincirklen:mincirklen@localhost:5433/mincirklen'

// `schema` is required, not defaulted to `public` — every caller has to
// consciously pick `dev` or `test` (never `public`, see docs/local_dev.md).
// Set as a connection-level `search_path` rather than baked into
// `connectionString` so every unqualified table reference — including
// Kysely's own migration bookkeeping tables — resolves into it.
export function createPgPool(connectionString: string, schema: string): Pool {
  return new Pool({ connectionString, options: `-c search_path=${schema}` })
}
