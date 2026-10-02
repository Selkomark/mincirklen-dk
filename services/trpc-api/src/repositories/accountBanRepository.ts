import type { Database } from '@mincirklen/shared'
import { sql, type Kysely } from 'kysely'

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

// The write path (services/banService.ts) — bans used to be a manual
// Adminer action; now a moderator with users.ban can issue one from a
// session report. One row per linked identity, so a banned person is
// refused at login whichever provider they come back through. Evidence
// snapshots are what the ban is justified by if the person ever asks
// (docs/gdpr-runbook.md).
export async function insertAccountBan(
  db: Kysely<Database>,
  params: {
    identityHash: string
    provider: string
    reasonCategory: 'predatory_contact' | 'harassment' | 'crisis_abuse' | 'illegal_content' | 'other'
    decisionSummary: string
    bannedBy: string
    userIdAtBanTime: string
  },
): Promise<{ id: string }> {
  return db
    .insertInto('account_bans')
    .values({
      identity_hash: params.identityHash,
      provider: params.provider,
      reason_category: params.reasonCategory,
      decision_summary: params.decisionSummary,
      banned_by: params.bannedBy,
      user_id_at_ban_time: params.userIdAtBanTime,
    })
    .returning('id')
    .executeTakeFirstOrThrow()
}

export async function insertBanEvidence(
  db: Kysely<Database>,
  params: { banId: string; evidenceType: 'message' | 'moderation_event' | 'operator_note'; snapshot: Record<string, unknown> },
): Promise<void> {
  await db
    .insertInto('account_ban_evidence')
    .values({ ban_id: params.banId, evidence_type: params.evidenceType, snapshot: sql`${JSON.stringify(params.snapshot)}::jsonb` })
    .execute()
}
