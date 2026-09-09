import type { Database } from '@mincirklen/shared'
import type { Kysely } from 'kysely'
import { type KmsConfig, decryptField } from '../adapters/kmsAdapter'

// The full "own content only" export shape — see the plan this shipped
// with for why this deliberately excludes session_reports filed *about*
// this user by someone else (reporter-confidentiality on an anonymous
// platform where reporting relies on the reporter not fearing
// retaliation — GDPR Article 15(4) permits withholding data where
// release would adversely affect another person's rights) and excludes
// account_bans/account_ban_evidence entirely (never reachable from
// here — see exportGenerationService.ts).
export interface UserExportData {
  account: { id: string; createdAt: Date; lastSeenAt: Date | null }
  profile: {
    firstName: string
    lastName: string
    mobileNumber: string
    gender: string
    country: string
    stayAnonymous: boolean
    language: string | null
    timezone: string | null
    trainingConsent: boolean
    createdAt: Date
  } | null
  identities: { provider: string; linkedAt: Date }[]
  sessionMemberships: { sessionId: string; joinedAt: Date; leftAt: Date | null; turnOrder: number | null }[]
  messages: { id: string; sessionId: string; body: string; type: string; moderationStatus: string; createdAt: Date }[]
  moderationEvents: {
    id: string
    sessionId: string
    classification: string
    humanReviewed: boolean
    humanReviewOutcome: string | null
    createdAt: Date
  }[]
  feedbackRatings: { sessionId: string; rating: number; freeText: string | null; createdAt: Date }[]
  reportsFiled: { sessionId: string; aboutUserIds: string[]; body: string; createdAt: Date }[]
}

export async function collectUserExportData(db: Kysely<Database>, kms: KmsConfig, userId: string): Promise<UserExportData> {
  const [account, profileRow, identityRows, membershipRows, messageRows, eventRows, ratingRows, reportRows] = await Promise.all([
    db.selectFrom('users').select(['id', 'created_at', 'last_seen_at']).where('id', '=', userId).executeTakeFirstOrThrow(),
    db.selectFrom('user_profiles').selectAll().where('user_id', '=', userId).executeTakeFirst(),
    db.selectFrom('user_identities').select(['provider', 'linked_at']).where('user_id', '=', userId).execute(),
    db
      .selectFrom('session_users')
      .select(['session_id', 'joined_at', 'left_at', 'turn_order'])
      .where('user_id', '=', userId)
      .execute(),
    db
      .selectFrom('messages')
      .select(['id', 'session_id', 'body', 'type', 'moderation_status', 'created_at'])
      .where('user_id', '=', userId)
      .execute(),
    db
      .selectFrom('moderation_events')
      .select(['id', 'session_id', 'classification', 'human_reviewed', 'human_review_outcome', 'created_at'])
      .where('user_id', '=', userId)
      .execute(),
    db
      .selectFrom('feedback_ratings')
      .select(['session_id', 'rating', 'free_text', 'created_at'])
      .where('user_id', '=', userId)
      .execute(),
    // reporter_user_id, not about_user_ids — this user's own filed
    // reports only, never reports naming them as a subject. See this
    // file's top doc comment.
    db
      .selectFrom('session_reports')
      .select(['session_id', 'about_user_ids', 'body', 'created_at'])
      .where('reporter_user_id', '=', userId)
      .execute(),
  ])

  let profile: UserExportData['profile'] = null
  if (profileRow) {
    const pii = JSON.parse(await decryptField(kms, profileRow.pii_ciphertext)) as {
      firstName: string
      lastName: string
      mobileNumber: string
    }
    profile = {
      firstName: pii.firstName,
      lastName: pii.lastName,
      mobileNumber: pii.mobileNumber,
      gender: profileRow.gender,
      country: profileRow.country,
      stayAnonymous: profileRow.stay_anonymous,
      language: profileRow.language,
      timezone: profileRow.timezone,
      trainingConsent: profileRow.training_consent,
      createdAt: profileRow.created_at,
    }
  }

  return {
    account: { id: account.id, createdAt: account.created_at, lastSeenAt: account.last_seen_at },
    profile,
    // Never the identity_hash itself — a security-relevant value, not
    // something the user needs handed back to them.
    identities: identityRows.map((r) => ({ provider: r.provider, linkedAt: r.linked_at })),
    sessionMemberships: membershipRows.map((r) => ({
      sessionId: r.session_id,
      joinedAt: r.joined_at,
      leftAt: r.left_at,
      turnOrder: r.turn_order,
    })),
    messages: messageRows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      body: r.body,
      type: r.type,
      moderationStatus: r.moderation_status,
      createdAt: r.created_at,
    })),
    moderationEvents: eventRows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      classification: r.classification,
      humanReviewed: r.human_reviewed,
      humanReviewOutcome: r.human_review_outcome,
      createdAt: r.created_at,
    })),
    feedbackRatings: ratingRows.map((r) => ({
      sessionId: r.session_id,
      rating: r.rating,
      freeText: r.free_text,
      createdAt: r.created_at,
    })),
    reportsFiled: reportRows.map((r) => ({
      sessionId: r.session_id,
      aboutUserIds: r.about_user_ids,
      body: r.body,
      createdAt: r.created_at,
    })),
  }
}
