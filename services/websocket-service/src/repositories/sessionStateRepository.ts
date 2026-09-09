import type { Database } from '@mincirklen/shared'
import type { Kysely } from 'kysely'
import type { TurnState } from '../adapters/redisTurnStateAdapter'

// Read-only mirror of trpc-api's sessionRepository.ts's getRoster/getSessionState
// queries — this service now owns live turn/roster state in Redis, but
// still needs to read Postgres's copy exactly once per session, to seed
// Redis the first time that session's turn state is touched (see
// adapters/redisTurnStateAdapter.ts's seedTurnState). Never written by
// this service in the normal path — only trpc-api's joinSession writes
// session_users/sessions membership/capacity state.
export async function getPostgresTurnState(db: Kysely<Database>, sessionId: string): Promise<TurnState | null> {
  const session = await db
    .selectFrom('sessions')
    .select(['id', 'current_turn_user_id'])
    .where('id', '=', sessionId)
    .executeTakeFirst()

  if (!session) return null

  const rows = await db
    .selectFrom('session_users')
    .select(['user_id', 'turn_order'])
    .where('session_id', '=', sessionId)
    .orderBy('turn_order', 'asc')
    .execute()

  const roster = rows
    .filter((row) => row.turn_order !== null)
    .map((row) => ({ userId: row.user_id, turnOrder: row.turn_order as number }))

  return { currentTurnUserId: session.current_turn_user_id, roster }
}

// Best-effort, fire-and-forget crash-recovery mirror (see rpcServer.ts's
// advanceTurn RPC for the fire-and-forget wrapping) — Postgres's own
// current_turn_user_id/
// turn_claimed_at columns are no longer read for authority once Redis
// holds this session's turn state, only kept close to it so a Redis
// eviction (before AOF is provisioned — see docs/roadmap.md's Appendix C
// infra notes) reseeds from something within one turn of the truth
// instead of resetting the whole room. Never throws on a since-deleted
// session — this is a mirror, not a source of truth, so there's nothing
// worth surfacing an error for.
export async function writeBackAdvancedTurn(db: Kysely<Database>, sessionId: string, currentTurnUserId: string | null): Promise<void> {
  await db
    .updateTable('sessions')
    .set({ current_turn_user_id: currentTurnUserId, turn_claimed_at: null })
    .where('id', '=', sessionId)
    .execute()
}

export async function writeBackClaimedTurn(db: Kysely<Database>, sessionId: string, claimedAt: Date): Promise<void> {
  await db.updateTable('sessions').set({ turn_claimed_at: claimedAt }).where('id', '=', sessionId).execute()
}
