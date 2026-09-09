import type { Database, Gender } from '@mincirklen/shared'
import type { Kysely } from 'kysely'
import { type KmsConfig, decryptField, encryptField } from '../adapters/kmsAdapter'

export interface UserProfileRow {
  id: string
  userId: string
  firstName: string
  lastName: string
  gender: Gender
  country: string
  mobileNumber: string
  stayAnonymous: boolean
  termsAcceptedAt: Date
  createdAt: Date
  language: string | null
  timezone: string | null
  trainingConsent: boolean
}

// The only shape ever encrypted/decrypted as a unit — see
// migrations/0001_init.ts.
interface EncryptedPii {
  firstName: string
  lastName: string
  mobileNumber: string
}

// Upsert, not insert: resubmitting the registration form (retry after a
// dropped response, or coming back to edit before a dedicated settings UI
// exists) replaces the previous profile rather than erroring.
export async function upsertUserProfile(
  db: Kysely<Database>,
  kms: KmsConfig,
  params: {
    userId: string
    firstName: string
    lastName: string
    gender: Gender
    country: string
    mobileNumber: string
    stayAnonymous: boolean
    termsAcceptedAt: Date
    // Optional for callers that never touch preferences (e.g. tests) —
    // undefined normalizes to null below. This is a full-replace upsert
    // like every other field here (see the doc comment above), so any
    // caller editing just Profile or just Preferences must still resend
    // the other section's current values, or it gets nulled out too.
    language?: string | null
    timezone?: string | null
    // Optional, defaults false (not consented — the schema-level safe
    // fallback) — same "optional for callers that never touch this"
    // reasoning as language/timezone above. RegisterPage.tsx's own
    // checkbox is pre-checked by product decision, so it always sends an
    // explicit true/false and this fallback rarely applies in practice.
    trainingConsent?: boolean
  },
): Promise<UserProfileRow> {
  const pii: EncryptedPii = {
    firstName: params.firstName,
    lastName: params.lastName,
    mobileNumber: params.mobileNumber,
  }
  const piiCiphertext = await encryptField(kms, JSON.stringify(pii))
  const language = params.language ?? null
  const timezone = params.timezone ?? null
  const trainingConsent = params.trainingConsent ?? false

  const row = await db
    .insertInto('user_profiles')
    .values({
      user_id: params.userId,
      pii_ciphertext: piiCiphertext,
      gender: params.gender,
      country: params.country,
      stay_anonymous: params.stayAnonymous,
      terms_accepted_at: params.termsAcceptedAt,
      language,
      timezone,
      training_consent: trainingConsent,
    })
    .onConflict((oc) =>
      oc.column('user_id').doUpdateSet({
        pii_ciphertext: piiCiphertext,
        gender: params.gender,
        country: params.country,
        stay_anonymous: params.stayAnonymous,
        terms_accepted_at: params.termsAcceptedAt,
        language,
        timezone,
        training_consent: trainingConsent,
      }),
    )
    .returningAll()
    .executeTakeFirstOrThrow()

  // The plaintext is already on hand from `params` — no need to decrypt
  // what was just encrypted.
  return {
    id: row.id,
    userId: row.user_id,
    firstName: params.firstName,
    lastName: params.lastName,
    gender: params.gender,
    mobileNumber: params.mobileNumber,
    country: row.country,
    stayAnonymous: row.stay_anonymous,
    termsAcceptedAt: row.terms_accepted_at,
    createdAt: row.created_at,
    language: row.language,
    timezone: row.timezone,
    trainingConsent: row.training_consent,
  }
}

// Existence-only, no KMS/decrypt involved — for callers that only need to
// know "has this user completed registration" (login routing, the
// verifiedProcedure gate) and never touch the PII itself. Keeping these
// off the decrypt path means a KMS/Vault outage or key-rotation hiccup
// can degrade profile *display* without also breaking login and every
// gated feature — see findUserProfileByUserId for the one place that
// still needs the real, decrypted data.
export async function userProfileExists(db: Kysely<Database>, userId: string): Promise<boolean> {
  const row = await db.selectFrom('user_profiles').select('id').where('user_id', '=', userId).executeTakeFirst()
  return row !== undefined
}

// Batch, non-anonymous-only: skips the KMS decrypt round trip entirely
// for anonymous members (the common case — "anonymous by default", see
// migrations/0001_init.ts), so a session's getState poll doesn't
// fan out into up to MAX_USERS_PER_SESSION KMS calls for names nobody
// will ever see. Never caches — resolved fresh from Postgres/KMS on every
// call, so toggling stay_anonymous back on masks the name again on the
// very next call. Callers (sessionService.ts's getSessionState) re-derive
// every member's display name this way on every read, including for
// messages/join notices already sent — their display name is resolved
// from the roster at render time, never stored on the message itself, so
// there's nothing to retroactively scrub.
export async function findDisplayNames(db: Kysely<Database>, kms: KmsConfig, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()

  const rows = await db
    .selectFrom('user_profiles')
    .select(['user_id', 'pii_ciphertext'])
    .where('user_id', 'in', userIds)
    .where('stay_anonymous', '=', false)
    .execute()

  const entries = await Promise.all(
    rows.map(async (row): Promise<[string, string]> => {
      const pii = JSON.parse(await decryptField(kms, row.pii_ciphertext)) as EncryptedPii
      return [row.user_id, pii.firstName]
    }),
  )
  return new Map(entries)
}

export async function findUserProfileByUserId(
  db: Kysely<Database>,
  kms: KmsConfig,
  userId: string,
): Promise<UserProfileRow | null> {
  const row = await db.selectFrom('user_profiles').selectAll().where('user_id', '=', userId).executeTakeFirst()
  if (!row) return null

  const pii = JSON.parse(await decryptField(kms, row.pii_ciphertext)) as EncryptedPii

  return {
    id: row.id,
    userId: row.user_id,
    firstName: pii.firstName,
    lastName: pii.lastName,
    gender: row.gender as Gender,
    mobileNumber: pii.mobileNumber,
    country: row.country,
    stayAnonymous: row.stay_anonymous,
    termsAcceptedAt: row.terms_accepted_at,
    createdAt: row.created_at,
    language: row.language,
    timezone: row.timezone,
    trainingConsent: row.training_consent,
  }
}
