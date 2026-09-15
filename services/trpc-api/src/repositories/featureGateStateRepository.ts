import type { Database, GateMode } from '@mincirklen/shared'
import type { Kysely } from 'kysely'

export interface GateState {
  key: string
  mode: GateMode
  scheduledOpenAt: Date | null
  updatedAt: Date
  updatedBy: string | null
}

function toGateState(row: { key: string; mode: string; scheduled_open_at: Date | null; updated_at: Date; updated_by: string | null }): GateState {
  return {
    key: row.key,
    mode: row.mode as GateMode,
    scheduledOpenAt: row.scheduled_open_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

// null means "no override recorded yet" — the caller (featureGateService.ts)
// falls back to the registry's own defaultMode, not this repository.
export async function findState(db: Kysely<Database>, key: string): Promise<GateState | null> {
  const row = await db.selectFrom('feature_gate_states').selectAll().where('key', '=', key).executeTakeFirst()
  return row ? toGateState(row) : null
}

// Every override row ever written, keyed by gate key — used by
// featureGateService.ts::listGatesWithStats to merge state onto the
// registry in one pass instead of one query per gate.
export async function listStates(db: Kysely<Database>): Promise<GateState[]> {
  const rows = await db.selectFrom('feature_gate_states').selectAll().execute()
  return rows.map(toGateState)
}

// Upsert, not insert-then-update — a gate's override row may or may not
// exist yet (see findState's comment), and the admin action that calls
// this ("toggle this gate") doesn't know or care which.
export async function upsertState(
  db: Kysely<Database>,
  key: string,
  params: { mode: GateMode; scheduledOpenAt: Date | null; updatedBy: string | null },
): Promise<void> {
  await db
    .insertInto('feature_gate_states')
    .values({
      key,
      mode: params.mode,
      scheduled_open_at: params.scheduledOpenAt,
      updated_by: params.updatedBy,
    })
    .onConflict((oc) =>
      oc.column('key').doUpdateSet({
        mode: params.mode,
        scheduled_open_at: params.scheduledOpenAt,
        updated_by: params.updatedBy,
        updated_at: new Date(),
      }),
    )
    .execute()
}
