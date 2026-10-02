import type { Database } from '@mincirklen/shared'
import type { Kysely } from 'kysely'

export async function findUserIdByIdentity(
  db: Kysely<Database>,
  provider: string,
  subjectHash: string,
): Promise<string | null> {
  const row = await db
    .selectFrom('user_identities')
    .select('user_id')
    .where('provider', '=', provider)
    .where('provider_subject_hash', '=', subjectHash)
    .executeTakeFirst()

  return row?.user_id ?? null
}

export async function linkIdentity(
  db: Kysely<Database>,
  userId: string,
  provider: string,
  subjectHash: string,
): Promise<void> {
  await db
    .insertInto('user_identities')
    .values({ user_id: userId, provider, provider_subject_hash: subjectHash })
    .execute()
}

// Whether this user has ever completed a real-identity provider login
// (currently only Google) — distinguishes a real, traceable account from a
// bare, unverified session row. Used to gate everything past "has a
// session cookie" (see controllers/trpc.ts's
// verifiedProcedure/googleLinkedProcedure).
export async function hasLinkedIdentityForUser(db: Kysely<Database>, userId: string): Promise<boolean> {
  const row = await db.selectFrom('user_identities').select('id').where('user_id', '=', userId).executeTakeFirst()

  return row !== undefined
}

// Every sign-in identity linked to a user, for banService.ts — a ban is
// recorded per identity hash so the person is refused however they come
// back (oauthController.ts checks the hash before any user row exists).
export async function listIdentitiesForUser(db: Kysely<Database>, userId: string): Promise<{ provider: string; subjectHash: string }[]> {
  const rows = await db.selectFrom('user_identities').select(['provider', 'provider_subject_hash']).where('user_id', '=', userId).execute()
  return rows.map((row) => ({ provider: row.provider, subjectHash: row.provider_subject_hash }))
}
