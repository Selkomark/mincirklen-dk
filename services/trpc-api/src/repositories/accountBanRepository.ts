import type { Database } from '@mincirklen/shared'
import type { Kysely } from 'kysely'

export interface AccountBan {
  id: string
  reasonCategory: string
  decisionSummary: string
  bannedAt: Date
}

// The only read path this codebase needs today — write (creating a ban)
// stays a manual operator action via Adminer for now, see
// migrations/0001_init.ts's account_bans doc comment and
// docs/gdpr-runbook.md. Called on every OAuth login attempt
// (googleAuthService.ts) to reject a banned identity trying to
// re-register after deleting its old account, and is why identity_hash
// has its own index rather than relying on a table scan.
export async function findBanByIdentityHash(
  db: Kysely<Database>,
  provider: string,
  identityHash: string,
): Promise<AccountBan | null> {
  const row = await db
    .selectFrom('account_bans')
    .select(['id', 'reason_category', 'decision_summary', 'banned_at'])
    .where('provider', '=', provider)
    .where('identity_hash', '=', identityHash)
    .orderBy('banned_at', 'desc')
    .executeTakeFirst()

  if (!row) return null

  return { id: row.id, reasonCategory: row.reason_category, decisionSummary: row.decision_summary, bannedAt: row.banned_at }
}
