import type { ColumnType, Generated, JSONColumnType } from 'kysely'

// timestamptz columns: selected as Date, inserted as Date|string|undefined
// (defaults to now() when omitted), never updated directly through a raw
// assignment in this milestone. Bare `Generated<Date>` mismatches insert
// vs. select types for timestamptz columns — see kysely-org/kysely#789.
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>

export interface UsersTable {
  id: Generated<string>
  created_at: Timestamp
  last_seen_at: NullableTimestamp
  // Null = not banned. Live-block only — see migrations/0001_init.ts and
  // AccountBansTable below for the ledger that survives deletion.
  banned_at: NullableTimestamp
  // Essential account-operation data once it exists (CHARTER.md §4's
  // carved-out exception), encrypted the same way as
  // UserProfilesTable.pii_ciphertext — but nullable, since plenty of users
  // stay fully anonymous with no Google identity ever linked and so never
  // have one. See migrations/0001_init.ts.
  email_ciphertext: string | null
}

export interface RolesTable {
  id: Generated<string>
  name: string
  description: string | null
  is_system: Generated<boolean>
  created_at: Timestamp
}

export interface PermissionsTable {
  id: Generated<string>
  slug: string
  description: string | null
}

export interface RolePermissionsTable {
  role_id: string
  permission_id: string
}

export interface UserRolesTable {
  user_id: string
  role_id: string
}

// A permanent, one-way marker: once a row exists, the MASTER_USER_EMAIL
// bootstrap (adminBootstrapService.ts) never fires again — see
// migrations/0001_init.ts's doc comment for the threat this closes off.
export interface AdminBootstrapTable {
  id: Generated<string>
  completed_at: Timestamp
}

export interface SessionsTable {
  id: Generated<string>
  status: 'forming' | 'active' | 'completed' | 'cancelled'
  created_at: Timestamp
  started_at: NullableTimestamp
  ended_at: NullableTimestamp
  current_turn_user_id: string | null
  turn_claimed_at: NullableTimestamp
  // Nullable: only populated for circles created through the scheduled
  // /start/new flow — the pre-existing ad-hoc turn-based flow leaves all
  // five null.
  topic_id: string | null
  scheduled_at: NullableTimestamp
  duration_minutes: number | null
  capacity: number | null
  name: string | null
}

export interface SessionUsersTable {
  session_id: string
  user_id: string
  joined_at: Timestamp
  left_at: NullableTimestamp
  turn_order: number | null
  // Bumped on every visit to /s/:sessionId, not just the original join —
  // see migrations/0001_init.ts. Backs the "recent
  // sessions" sidebar ordering (most recently visited first).
  last_visited_at: Timestamp
  // agreement key -> ISO8601 timestamp this user agreed to it at, for
  // *this* session join specifically (e.g. "community_guidelines",
  // "privacy_policy", "anonymity_acknowledgement", "terms_of_service") —
  // see repositories/sessionRepository.ts's CIRCLE_GUIDELINE_AGREEMENT_KEYS
  // and migrations/0001_init.ts for why this
  // lives per-join rather than once per user.
  agreements: JSONColumnType<Record<string, string>, Record<string, string> | undefined>
}

export interface MessagesTable {
  id: Generated<string>
  session_id: string
  user_id: string
  body: string
  // 'system' rows are synthetic events (e.g. a join notice) rendered
  // inline in the timeline rather than as a real chat bubble — see
  // messageRepository.ts's insertMessage and
  // migrations/0001_init.ts.
  type: Generated<'user' | 'system'>
  // 'reviewed_pass' means a human reviewed a flag/crisis row and
  // determined it wasn't warranted — distinct from 'pass' (the
  // classifier's own original verdict). See migrations/0001_init.ts and
  // messageRepository.ts's listMessages for the visibility rule this
  // column drives.
  moderation_status: Generated<'pass' | 'flag' | 'crisis' | 'reviewed_pass'>
  false_positive_reported_at: NullableTimestamp
  created_at: Timestamp
}

export interface ModerationEventsTable {
  id: Generated<string>
  session_id: string
  user_id: string
  message_id: string | null
  classification: 'pass' | 'flag' | 'crisis'
  human_reviewed: Generated<boolean>
  human_review_outcome: 'true_positive' | 'false_positive' | 'true_negative' | 'false_negative' | null
  reviewed_at: NullableTimestamp
  reviewed_by: string | null
  created_at: Timestamp
}

export interface FeedbackRatingsTable {
  id: Generated<string>
  session_id: string
  user_id: string
  rating: number
  free_text: string | null
  created_at: Timestamp
}

// A user-initiated "Report this session" complaint — distinct from
// ModerationEventsTable, which is the AI classifier's own automated
// pass/flag/crisis calls on message content, not a user complaint.
export interface SessionReportsTable {
  id: Generated<string>
  session_id: string
  // Nullable: set null (not cascaded) if the reporter later deletes
  // their own account, so their report survives them — see
  // migrations/0001_init.ts.
  reporter_user_id: string | null
  about_user_ids: JSONColumnType<string[]>
  body: string
  created_at: Timestamp
}

// The abuse-prevention ledger — deliberately NOT foreign-keyed to
// `users.id`, so it survives account deletion. See
// migrations/0001_init.ts for the full reasoning and GDPR basis.
export interface AccountBansTable {
  id: Generated<string>
  identity_hash: string
  provider: string
  reason_category: 'predatory_contact' | 'harassment' | 'crisis_abuse' | 'illegal_content' | 'other'
  decision_summary: string
  banned_at: Timestamp
  banned_by: string
  user_id_at_ban_time: string | null
}

export interface AccountBanEvidenceTable {
  id: Generated<string>
  ban_id: string
  evidence_type: 'message' | 'moderation_event' | 'operator_note'
  snapshot: JSONColumnType<Record<string, unknown>>
  created_at: Timestamp
}

// See services/dataExportRequestService.ts (trpc-api, insert + publish
// only) and the separate data-export-service Cloud Run worker (owns
// every status transition past 'pending').
export interface DataExportRequestsTable {
  id: Generated<string>
  user_id: string
  status: Generated<'pending' | 'processing' | 'ready' | 'failed' | 'expired'>
  storage_key: string | null
  requested_at: Timestamp
  completed_at: NullableTimestamp
  expires_at: NullableTimestamp
}

export interface UserIdentitiesTable {
  id: Generated<string>
  user_id: string
  provider: string
  provider_subject_hash: string
  linked_at: Timestamp
}

export interface UserProfilesTable {
  id: Generated<string>
  user_id: string
  // Encrypted { firstName, lastName, mobileNumber } — see
  // migrations/0001_init.ts and adapters/kmsAdapter.ts. Never read/
  // written as plaintext outside userProfileRepository.ts.
  pii_ciphertext: string
  // 'male' | 'female' | 'other' at the application layer — see
  // schemas/userProfile.ts's GENDERS.
  gender: string
  country: string
  stay_anonymous: Generated<boolean>
  terms_accepted_at: Timestamp
  created_at: Timestamp
  // Both nullable — null means "not set," not an empty/invalid value.
  language: string | null
  timezone: string | null
  // Consent to AI training use, true = consented — see migrations/0001_init.ts.
  training_consent: Generated<boolean>
}

export interface TopicsTable {
  id: Generated<string>
  slug: string
  label: string
  sort_order: Generated<number>
  is_active: Generated<boolean>
  created_at: Timestamp
}

export interface Database {
  users: UsersTable
  sessions: SessionsTable
  session_users: SessionUsersTable
  messages: MessagesTable
  moderation_events: ModerationEventsTable
  feedback_ratings: FeedbackRatingsTable
  session_reports: SessionReportsTable
  user_identities: UserIdentitiesTable
  user_profiles: UserProfilesTable
  topics: TopicsTable
  account_bans: AccountBansTable
  account_ban_evidence: AccountBanEvidenceTable
  data_export_requests: DataExportRequestsTable
  roles: RolesTable
  permissions: PermissionsTable
  role_permissions: RolePermissionsTable
  user_roles: UserRolesTable
  admin_bootstrap: AdminBootstrapTable
}
