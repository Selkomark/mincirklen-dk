import type { Database } from '@mincirklen/shared'
import { sql, type Kysely } from 'kysely'
import { type KmsConfig, decryptField } from '../adapters/kmsAdapter'

export async function insertUser(db: Kysely<Database>): Promise<{ id: string }> {
  const row = await db.insertInto('users').defaultValues().returningAll().executeTakeFirstOrThrow()
  return { id: row.id }
}

export async function touchUser(db: Kysely<Database>, userId: string): Promise<boolean> {
  const result = await db
    .updateTable('users')
    .set({ last_seen_at: new Date() })
    .where('id', '=', userId)
    .executeTakeFirst()

  return (result.numUpdatedRows ?? 0n) > 0n
}

// Called on every Google login (oauthController.ts), not just the first —
// keeps the stored value in sync with whatever Google reports as the
// account's current verified email. See migrations/0001_init.ts's
// email_ciphertext doc comment for why this is nullable at the schema
// level despite being essential once a Google identity exists.
export async function setEmail(db: Kysely<Database>, userId: string, emailCiphertext: string): Promise<void> {
  await db.updateTable('users').set({ email_ciphertext: emailCiphertext }).where('id', '=', userId).execute()
}

export async function userExists(db: Kysely<Database>, userId: string): Promise<boolean> {
  const row = await db.selectFrom('users').select('id').where('id', '=', userId).executeTakeFirst()
  return row !== undefined
}

// The live-block half of enforcement (see migrations/0001_init.ts's
// users.banned_at doc comment) — called on every session resolution
// (authService.ts's resolveSession) to kill a still-existing session for
// an account that's been banned but not yet deleted. Distinct from
// account_bans/accountBanRepository.ts, which is the half that survives
// deletion and blocks re-registration.
export async function isUserBanned(db: Kysely<Database>, userId: string): Promise<boolean> {
  const row = await db
    .selectFrom('users')
    .select('id')
    .where('id', '=', userId)
    .where('banned_at', 'is not', null)
    .executeTakeFirst()

  return row !== undefined
}

// GDPR right to erasure (Article 17) — the self-service "delete my
// account" mutation (accountDeletionService.ts). Existing cascade FKs
// clean up user_identities, user_profiles, session_users, messages,
// moderation_events, feedback_ratings, and data_export_requests;
// session_reports.reporter_user_id sets null instead of cascading (see
// migrations/0001_init.ts) so a report this user filed about someone
// else survives them. account_bans/account_ban_evidence are untouched by
// construction — they're never foreign-keyed to this row.
export async function deleteUser(db: Kysely<Database>, userId: string): Promise<void> {
  await db.deleteFrom('users').where('id', '=', userId).execute()
}

// Flips the live-block flag context.ts's resolveSession checks on every
// request — the banned person's current session dies on their next call,
// independent of the account_bans row that refuses future logins.
export async function setBannedAt(db: Kysely<Database>, userId: string): Promise<void> {
  await db.updateTable('users').set({ banned_at: sql`now()` }).where('id', '=', userId).where('banned_at', 'is', null).execute()
}

// Decrypted, unmasked — only for sending the member something
// (emailAdapter.ts). Never return this to a browser; rbacRepository.ts's
// masked variant is what the admin UI gets.
export async function findEmailForUser(db: Kysely<Database>, kms: KmsConfig, userId: string): Promise<string | null> {
  const row = await db.selectFrom('users').select('email_ciphertext').where('id', '=', userId).executeTakeFirst()
  if (!row?.email_ciphertext) return null
  return decryptField(kms, row.email_ciphertext)
}

// The other half of lifting a ban: the live-block flag goes, so the
// person's next login (now passing the ban check) works normally.
export async function clearBannedAt(db: Kysely<Database>, userId: string): Promise<void> {
  await db.updateTable('users').set({ banned_at: null }).where('id', '=', userId).execute()
}
