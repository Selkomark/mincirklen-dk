import { Kysely, sql } from 'kysely'

// Single consolidated migration — this repo hasn't launched yet, so
// there's no production data whose migration history needs preserving.
// Previously 16 incremental files (participants -> users rename, PII
// encryption, circle scheduling, message types, etc.); squashed into one
// once since the schema settled, rather than carrying that history
// forward indefinitely. If you're adding a new column/table, just add it
// here directly — there's no reason to start a new incremental file
// again unless/until this has real user data to preserve.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`create extension if not exists pg_trgm with schema public`.execute(db)

  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('last_seen_at', 'timestamptz')
    // Null = not banned. The *live-block* half of enforcement: kills an
    // existing session/login for an account that's been banned but not
    // yet deleted (see authService.ts's resolveSession). This is
    // distinct from account_bans/account_ban_evidence below, which is
    // what survives *after* deletion and blocks re-registration — this
    // column's only job is stopping continued use of a still-existing
    // row. Set manually via Adminer for now — see docs/gdpr-runbook.md.
    .addColumn('banned_at', 'timestamptz')
    // Essential account-operation data once it exists, not optional
    // profile PII (see CHARTER.md §4's carved-out exception, added
    // alongside this column) — but nullable, not required, because a
    // `users` row can exist fully anonymously with no Google identity
    // ever linked (authService.ts's insertUser path) and therefore no
    // email at all. Only set for users who complete Google login (scope
    // now includes `email`, verified via `email_verified` before it's
    // ever trusted). Encrypted the same way as user_profiles.pii_ciphertext
    // below. Lives on `users` directly (not user_profiles) because it must
    // exist from first Google login, before a profile is ever created,
    // and so it's wiped for free by this table's own cascade/delete on
    // account deletion — no separate cleanup needed.
    .addColumn('email_ciphertext', 'text')
    .execute()

  await db.schema
    .createTable('user_identities')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('provider_subject_hash', 'text', (col) => col.notNull())
    .addColumn('linked_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('user_identities_provider_subject_unique')
    .on('user_identities')
    .columns(['provider', 'provider_subject_hash'])
    .unique()
    .execute()

  // Opt-in identity info collected by the post-login registration page
  // (RegisterPage.tsx) — kept in its own table rather than on `users`
  // because anonymity is the default (Charter §4), not a property of
  // every account. first_name/last_name/mobile_number are genuinely
  // identifying PII, so they're never stored as plaintext columns —
  // only as `pii_ciphertext`, encrypted application-side (see
  // services/trpc-api/src/adapters/kmsAdapter.ts, via Vault's Transit
  // engine locally / a cloud KMS in prod) before it ever reaches
  // Postgres. gender/country/stay_anonymous stay plaintext — low
  // sensitivity on their own, and useful for aggregate reporting.
  await db.schema
    .createTable('user_profiles')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().unique().references('users.id').onDelete('cascade'))
    .addColumn('pii_ciphertext', 'text', (col) => col.notNull())
    .addColumn('gender', 'text', (col) => col.notNull())
    .addColumn('country', 'text', (col) => col.notNull())
    .addColumn('stay_anonymous', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('terms_accepted_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // Nullable — null is a meaningful value, not just "unset": for
    // `language` it means "fall back to detected/browser language," for
    // `timezone` it means "use the system/browser timezone" rather than
    // a specific stored one.
    .addColumn('language', 'text')
    .addColumn('timezone', 'text')
    // Consent to this user's messages being used as AI training source
    // material — true means consented. Column default is false (the
    // schema-level safe fallback); RegisterPage.tsx's own checkbox is
    // pre-checked by product decision (a known GDPR Recital 32 gap, see
    // TRAINING_CONSIDERATIONS.md in the moderation-engine repo), so most
    // real rows will actually be inserted as true despite this default —
    // this column default only matters for a caller that skips the
    // registration form's own value entirely.
    .addColumn('training_consent', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute()

  // The abuse-prevention ledger: deliberately NOT foreign-keyed to
  // `users.id`, so it survives account deletion entirely — that's the
  // whole point (see TRAINING_CONSIDERATIONS.md-style reasoning in the
  // moderation-engine repo, and the GDPR data-export/deletion plan this
  // shipped alongside). Keyed by identity_hash — the same deterministic
  // HMAC computed by auth/identityHash.ts's hashIdentitySubject — so a
  // banned Google account can be recognized again on any future
  // registration attempt with the same account, even after the original
  // `users` row is long gone. Legal basis for retaining this past a
  // deletion request: GDPR Article 17(3)(e) (establishment/exercise/
  // defence of legal claims) and Article 6(1)(f)/Recital 47 (legitimate
  // interest in fraud/abuse prevention) — see docs/gdpr-runbook.md.
  // Write path is manual (Adminer) for now — no admin UI/role exists in
  // this codebase yet (see TODO.md).
  await db.schema
    .createTable('account_bans')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('identity_hash', 'text', (col) => col.notNull())
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('reason_category', 'text', (col) => col.notNull())
    // Human-written explanation of the decision — this is what gets
    // quoted back to the person if they ever request disclosure of what
    // evidence justified a ban after their account was deleted. Must be
    // legible on its own, not just a code.
    .addColumn('decision_summary', 'text', (col) => col.notNull())
    .addColumn('banned_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // Free-text operator identifier — no admin-identity system exists to
    // reference instead (see TODO.md).
    .addColumn('banned_by', 'text', (col) => col.notNull())
    // Historical breadcrumb only — deliberately NOT a foreign key, so it
    // can dangle after the `users` row it once pointed at is deleted
    // without blocking anything.
    .addColumn('user_id_at_ban_time', 'uuid')
    .addCheckConstraint(
      'account_bans_reason_category_check',
      sql`reason_category in ('predatory_contact','harassment','crisis_abuse','illegal_content','other')`,
    )
    .execute()

  // Hot lookup path on every OAuth login (see services/googleAuthService.ts
  // and controllers/oauthController.ts) — not unique, since the same
  // identity could in principle be banned more than once across its
  // lifetime (ban, appeal/expire in the future, re-offend).
  await db.schema.createIndex('account_bans_identity_hash_idx').on('account_bans').column('identity_hash').execute()

  // One-to-many child of account_bans — the actual copied evidence, not
  // just a category flag, so a disclosure response can show specifically
  // what justified the decision (GDPR Article 5(2) accountability). Never
  // attributes evidence to a specific reporter, even when a report
  // prompted the ban — keeps reporter confidentiality intact even in the
  // retained record. Cascades on ban_id only — internal to this ledger,
  // nothing to do with `users`.
  await db.schema
    .createTable('account_ban_evidence')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('ban_id', 'uuid', (col) => col.notNull().references('account_bans.id').onDelete('cascade'))
    .addColumn('evidence_type', 'text', (col) => col.notNull())
    .addColumn('snapshot', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'account_ban_evidence_type_check',
      sql`evidence_type in ('message','moderation_event','operator_note')`,
    )
    .execute()

  // RBAC — normalized roles/permissions, mirroring the mechanics already
  // proven out in the sibling selkomark.com repo (role_permissions/
  // user_roles as real many-to-many join tables, not a JSON/array column,
  // so a role's effective permission set is always a plain join, not
  // app-level parsing). `/manage` (services/web-app) and its tRPC
  // procedures (services/trpc-api/src/controllers/trpc.ts's
  // `hasPermission`) are the consumers. `is_system` protects the seeded
  // `admin` role from having its permissions edited away by mistake.
  await db.schema
    .createTable('roles')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (col) => col.notNull().unique())
    .addColumn('description', 'text')
    .addColumn('is_system', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  // slug convention: `<resource>.<action>` (e.g. `roles.read`,
  // `moderation_events.review`) — plain runtime strings, checked via
  // array membership, not a compile-time union; the catalog grows as new
  // admin capabilities are actually built, not ahead of need.
  await db.schema
    .createTable('permissions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('slug', 'text', (col) => col.notNull().unique())
    .addColumn('description', 'text')
    .execute()

  await db.schema
    .createTable('role_permissions')
    .addColumn('role_id', 'uuid', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .addColumn('permission_id', 'uuid', (col) => col.notNull().references('permissions.id').onDelete('cascade'))
    .addPrimaryKeyConstraint('role_permissions_pk', ['role_id', 'permission_id'])
    .execute()

  await db.schema
    .createTable('user_roles')
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('role_id', 'uuid', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .addPrimaryKeyConstraint('user_roles_pk', ['user_id', 'role_id'])
    .execute()

  // Seed: one system role (`admin`, holding every permission below) plus
  // the permission slugs this pass's features actually need.
  // MASTER_USER_EMAIL-driven bootstrap (adminBootstrapService.ts) grants
  // this role to whichever account first logs in with that email — see
  // controllers/oauthController.ts.
  const adminRole = await db
    .insertInto('roles')
    .values({ name: 'admin', description: 'Full platform access', is_system: true })
    .returning('id')
    .executeTakeFirstOrThrow()

  const permissionSlugs: Array<{ slug: string; description: string }> = [
    { slug: 'admin.access', description: 'Access the /manage admin area' },
    { slug: 'roles.read', description: 'View roles and their permissions' },
    { slug: 'roles.create', description: 'Create new roles' },
    { slug: 'roles.update', description: "Edit a role's name/description/permissions" },
    { slug: 'users.read', description: 'View users and their assigned roles' },
    { slug: 'users.update', description: "Change a user's assigned roles" },
    { slug: 'moderation_events.review', description: 'Review flagged/crisis moderation events' },
  ]

  const insertedPermissions = await db
    .insertInto('permissions')
    .values(permissionSlugs)
    .returning('id')
    .execute()

  await db
    .insertInto('role_permissions')
    .values(insertedPermissions.map((p) => ({ role_id: adminRole.id, permission_id: p.id })))
    .execute()

  // A permanent, one-way marker for the master-admin bootstrap
  // (adminBootstrapService.ts) — deliberately NOT "does any user currently
  // hold the admin role," which would re-arm itself if the sole admin is
  // ever removed/deroled later. Once a row exists here, the
  // MASTER_USER_EMAIL bootstrap never fires again, full stop — closing
  // off the scenario where someone with prod env-var access changes it
  // later and logs in hoping to re-trigger elevation.
  await db.schema
    .createTable('admin_bootstrap')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('completed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createTable('topics')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('slug', 'text', (col) => col.notNull().unique())
    .addColumn('label', 'text', (col) => col.notNull())
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db
    .insertInto('topics')
    .values([
      { slug: 'grief', label: 'Grief', sort_order: 0 },
      { slug: 'anxiety', label: 'Anxiety', sort_order: 1 },
      { slug: 'parenting', label: 'New parents', sort_order: 2 },
      { slug: 'chronic', label: 'Chronic illness', sort_order: 3 },
      { slug: 'career', label: 'Career transitions', sort_order: 4 },
      { slug: 'sleep', label: 'Sleep and insomnia', sort_order: 5 },
    ])
    .onConflict((oc) => oc.column('slug').doNothing())
    .execute()

  await db.schema
    .createTable('sessions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('forming'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('started_at', 'timestamptz')
    .addColumn('ended_at', 'timestamptz')
    .addColumn('current_turn_user_id', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('turn_claimed_at', 'timestamptz')
    // Nullable: the ad-hoc turn-based flow (createSession(db) with no
    // scheduling info — tests, packages/shared/src/db/seed.ts) never
    // sets these. Only the scheduled-circle create path
    // (session.create with topicId/scheduledAt/capacity) populates
    // them — see services/trpc-api/src/repositories/sessionRepository.ts.
    .addColumn('topic_id', 'uuid', (col) => col.references('topics.id'))
    .addColumn('scheduled_at', 'timestamptz')
    .addColumn('duration_minutes', 'integer')
    .addColumn('capacity', 'integer')
    // Lets a circle's creator personalize it beyond the generic
    // "<Topic> circle" label. Every row with a topic_id also has a
    // name — createSessionInputSchema requires it for that path — see
    // sessionRepository.ts's listOpenSessions.
    .addColumn('name', 'text')
    .addCheckConstraint('sessions_status_check', sql`status in ('forming','active','completed','cancelled')`)
    .execute()

  // Backs server-side search on /start/join (sessionRepository.ts's
  // listOpenSessions): pg_trgm's GIN index accelerates ILIKE '%term%'
  // substring scans at scale and adds a `similarity()` function used
  // for typo-tolerant fuzzy matching. Schema-qualified (public) since
  // the extension itself is a database-wide singleton, not scoped to
  // whichever of dev/test happens to run this migration first.
  await sql`create index sessions_name_trgm_idx on sessions using gin (name public.gin_trgm_ops)`.execute(db)

  await db.schema
    .createTable('session_users')
    .addColumn('session_id', 'uuid', (col) => col.notNull().references('sessions.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('joined_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('left_at', 'timestamptz')
    .addColumn('turn_order', 'integer')
    // Bumped on every visit to /s/:sessionId, not just the original
    // join — backs the "recent sessions" sidebar ordering (most
    // recently visited first). Revisiting an already-joined session
    // bumps it back to the top; the original join still only happens
    // once.
    .addColumn('last_visited_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // Per-membership community-guidelines consent record — { key:
    // ISO8601 timestamp } — one row per (user, session) joined, so
    // every circle join has its own auditable consent record. A
    // returning user who already agreed on some other session isn't
    // asked again — see sessionRepository.ts's copyPriorAgreementIfAny.
    .addColumn('agreements', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addPrimaryKeyConstraint('session_users_pk', ['session_id', 'user_id'])
    .addUniqueConstraint('session_users_session_turn_order_unique', ['session_id', 'turn_order'])
    .execute()

  await db.schema
    .createIndex('session_users_user_id_last_visited_at_idx')
    .on('session_users')
    .columns(['user_id', 'last_visited_at'])
    .execute()

  await db.schema
    .createTable('messages')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('session_id', 'uuid', (col) => col.notNull().references('sessions.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('body', 'text', (col) => col.notNull())
    // 'system' rows are synthetic events (e.g. a "joined" notice)
    // rendered inline in the timeline rather than as a real chat
    // bubble — see services/trpc-api/src/repositories/messageRepository.ts.
    .addColumn('type', 'text', (col) => col.notNull().defaultTo('user'))
    // Every message is now persisted regardless of classification (flag
    // and crisis included — previously only 'pass' ever got a row here,
    // see messageRepository.ts's git history). This column is what keeps
    // a flagged/crisis row out of the group's shared view: listMessages
    // only returns a non-'pass' row to its own author, never to other
    // participants — see messageRepository.ts's listMessages. Never
    // broadcast (publishMessage) a row whose status isn't 'pass'.
    // 'reviewed_pass' is distinct from 'pass' on purpose — it means a
    // human reviewed a flag/crisis and determined it wasn't warranted,
    // NOT that the classifier originally said pass. Never write
    // 'reviewed_pass' by resetting this column to 'pass'.
    .addColumn('moderation_status', 'text', (col) => col.notNull().defaultTo('pass'))
    // Set when the message's own author disputes a flag/crisis
    // classification via the report-false-positive action — a request
    // for human review, not a status change by itself. See
    // messageRepository.ts's reportFalsePositive.
    .addColumn('false_positive_reported_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'messages_moderation_status_check',
      sql`moderation_status in ('pass','flag','crisis','reviewed_pass')`,
    )
    .execute()

  await db.schema
    .createIndex('messages_session_id_created_at_idx')
    .on('messages')
    .columns(['session_id', 'created_at'])
    .execute()

  await db.schema
    .createTable('moderation_events')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('session_id', 'uuid', (col) => col.notNull().references('sessions.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('message_id', 'uuid', (col) => col.references('messages.id').onDelete('set null'))
    .addColumn('classification', 'text', (col) => col.notNull())
    .addColumn('human_reviewed', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('human_review_outcome', 'text')
    .addColumn('reviewed_at', 'timestamptz')
    // Attributes a review decision to the real user who made it — reviewers
    // are just regular users holding the `moderation_events.review`
    // permission, not a separate moderator identity. `set null`, not
    // cascade: deleting the reviewing account must never destroy the
    // historical review record itself, only its "who" attribution.
    .addColumn('reviewed_by', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('moderation_events_classification_check', sql`classification in ('pass','flag','crisis')`)
    .addCheckConstraint(
      'moderation_events_review_outcome_check',
      sql`human_review_outcome in ('true_positive','false_positive','true_negative','false_negative')`,
    )
    .execute()

  await db.schema
    .createTable('feedback_ratings')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('session_id', 'uuid', (col) => col.notNull().references('sessions.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('rating', 'smallint', (col) => col.notNull())
    .addColumn('free_text', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('feedback_ratings_rating_check', sql`rating between 1 and 5`)
    .addUniqueConstraint('feedback_ratings_session_user_unique', ['session_id', 'user_id'])
    .execute()

  // "Report this session" (SessionPage.tsx's ReportSessionModal) — a
  // user-initiated complaint, distinct from moderation_events (the AI
  // classifier's own automated pass/flag/crisis calls on message
  // content). about_user_ids is a plain jsonb array of userIds rather
  // than a Postgres uuid[] column or a join table — same convention as
  // session_users.agreements above, and there's no need to query "reports
  // about user X" efficiently yet (no review queue exists — see
  // services/trpc-api/src/services/sessionReportService.ts's doc comment
  // for why this deliberately stops at "persisted + logged," matching
  // crisisEscalationService.ts's own "nothing real to page yet" stance).
  await db.schema
    .createTable('session_reports')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('session_id', 'uuid', (col) => col.notNull().references('sessions.id').onDelete('cascade'))
    // set null, not cascade: if a reporter deletes their own account
    // later, a report they filed about someone else must survive them —
    // otherwise self-deletion would let a reporter's own evidence vanish
    // right when a moderator might need it. Nullable here specifically
    // because of that (a filed report with no reporter left is still
    // meaningful; a report can never be filed without one to begin with).
    .addColumn('reporter_user_id', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('about_user_ids', 'jsonb', (col) => col.notNull())
    .addColumn('body', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  // Tracks a self-service "download my data" request end to end.
  // trpc-api only ever inserts the row + publishes a Pub/Sub message
  // (see services/dataExportRequestService.ts) — the actual aggregation
  // and status transitions past 'pending' are owned entirely by the
  // separate data-export-service Cloud Run worker, deliberately kept out
  // of trpc-api's own process so a bug there can never take the rest of
  // the platform down with it. Cascades on user_id: if the account is
  // deleted before the export finishes, the pending request should go
  // too (the worker treats a since-deleted user as a normal failure
  // path, not a special case, if it's already mid-job).
  await db.schema
    .createTable('data_export_requests')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('storage_key', 'text')
    .addColumn('requested_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('completed_at', 'timestamptz')
    .addColumn('expires_at', 'timestamptz')
    .addCheckConstraint(
      'data_export_requests_status_check',
      sql`status in ('pending','processing','ready','failed','expired')`,
    )
    .execute()

  await db.schema
    .createIndex('data_export_requests_user_id_idx')
    .on('data_export_requests')
    .column('user_id')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('data_export_requests').execute()
  await db.schema.dropTable('session_reports').execute()
  await db.schema.dropTable('feedback_ratings').execute()
  await db.schema.dropTable('moderation_events').execute()
  await db.schema.dropTable('messages').execute()
  await db.schema.dropTable('session_users').execute()
  await sql`drop index if exists sessions_name_trgm_idx`.execute(db)
  await db.schema.dropTable('sessions').execute()
  await db.schema.dropTable('topics').execute()
  await db.schema.dropTable('account_ban_evidence').execute()
  await db.schema.dropTable('account_bans').execute()
  await db.schema.dropTable('admin_bootstrap').execute()
  await db.schema.dropTable('user_roles').execute()
  await db.schema.dropTable('role_permissions').execute()
  await db.schema.dropTable('permissions').execute()
  await db.schema.dropTable('roles').execute()
  await db.schema.dropTable('user_profiles').execute()
  await db.schema.dropTable('user_identities').execute()
  await db.schema.dropTable('users').execute()
  await sql`drop extension if exists pg_trgm`.execute(db)
}
