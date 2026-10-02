import { sql, type Kysely } from 'kysely'

// Launch-ready RBAC data on top of 0001_init's schema and its lone
// `ADMIN` role: a ladder of session policies and a starter role per
// area of the admin surface. Role names follow schemas/rbac.ts's
// ROLE_NAME_PATTERN (UPPERCASE-WITH-DASHES). Everything here is seed data, not schema —
// nothing is `is_system`, so an operator can rename, re-permission, or
// re-time any of these (or delete the roles) from /manage. Only `ADMIN`
// stays locked, as 0001 made it.
//
// Idempotent on purpose (ON CONFLICT DO NOTHING by the unique names):
// a dev database that already has some of these, or a re-run of the
// integration suite, must not fail on unique violations
// (ARCHITECTURE.md, "Integration tests use idempotent seeding").

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// A hand-picked ladder of round, human durations per unit — the steps
// people actually reach for, not a formula. Tops out at 12 days, under
// ROLE_MAX_IDLE_SECONDS (14 days, packages/shared/src/auth/sessionToken.ts),
// which is also the most the schema lets a policy store. Operators who
// want an in-between value still can — these are ordinary rows, the
// input stays free-form.
const LADDER: Array<{ unit: 'minute' | 'hour' | 'day'; seconds: number; steps: number[] }> = [
  { unit: 'minute', seconds: MINUTE, steps: [1, 2, 3, 5, 10, 15, 30] },
  { unit: 'hour', seconds: HOUR, steps: [1, 2, 3, 5, 10] },
  { unit: 'day', seconds: DAY, steps: [1, 2, 3, 5, 10, 12] },
]

function policyName(count: number, unit: 'minute' | 'hour' | 'day'): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}

const SEEDED_POLICIES: Array<{ name: string; maxIdleSeconds: number }> = LADDER.flatMap(({ unit, seconds, steps }) =>
  steps.map((count) => ({ name: policyName(count, unit), maxIdleSeconds: count * seconds })),
)

// One role per area of /manage, each carrying `admin.access` (the
// permission that opens the admin area at all — controllers/trpc.ts) plus
// the slice it's for. Policy durations scale with blast radius: the
// roles that can change who-can-do-what sit at an hour, hands-on daily
// work at a shift, read-only at a day.
interface SeededRole {
  name: string
  description: string
  permissions: string[]
  policy: string
}

// Every read-side permission that exists at this point; later migrations
// that add read permissions (0003 session_reports.read, 0010
// moderation_events.read) grant them to AUDITOR themselves.
const READ_EVERYTHING = ['admin.access', 'roles.read', 'session_policies.read', 'users.read', 'gates.read']

const SEEDED_ROLES: SeededRole[] = [
  {
    name: 'MODERATOR',
    description: 'Reviews flagged messages and decides session reports',
    permissions: ['admin.access', 'moderation_events.review'],
    policy: policyName(10, 'hour'),
  },
  {
    name: 'TRUST-SAFETY-LEAD',
    description: 'Senior moderation: can also ban members',
    permissions: ['admin.access', 'moderation_events.review', 'users.read', 'users.update'],
    policy: policyName(3, 'hour'),
  },
  {
    name: 'SUPPORT',
    description: 'Looks up member accounts and helps with sign-in problems',
    permissions: ['admin.access', 'users.read'],
    policy: policyName(10, 'hour'),
  },
  {
    name: 'LAUNCH-MANAGER',
    description: 'Opens gates and works the waitlist',
    permissions: ['admin.access', 'gates.read', 'gates.manage'],
    policy: policyName(10, 'hour'),
  },
  {
    name: 'ACCESS-MANAGER',
    description: 'Creates roles, grants them to people, sets session policies',
    permissions: [
      'admin.access',
      'roles.read',
      'roles.create',
      'roles.update',
      'session_policies.read',
      'session_policies.create',
      'session_policies.update',
      'users.read',
      'users.update',
    ],
    policy: policyName(1, 'hour'),
  },
  {
    name: 'AUDITOR',
    description: 'Read-only: can look at everything, change nothing',
    permissions: READ_EVERYTHING,
    policy: policyName(1, 'day'),
  },
]

// 0001 seeded `ADMIN` with no policy, which (before ROLE_MAX_IDLE_SECONDS)
// meant the 180-day member default. The role with every permission gets
// the shortest default of the lot.
const ADMIN_POLICY = policyName(1, 'hour')

export async function up(db: Kysely<any>): Promise<void> {
  await db
    .insertInto('session_policies')
    .values(
      SEEDED_POLICIES.map((policy) => ({
        name: policy.name,
        attributes: sql`${JSON.stringify({ maxIdleSeconds: policy.maxIdleSeconds })}::jsonb`,
      })),
    )
    .onConflict((oc) => oc.column('name').doNothing())
    .execute()

  const policyRows = await db
    .selectFrom('session_policies')
    .select(['id', 'name'])
    .where(
      'name',
      'in',
      SEEDED_POLICIES.map((policy) => policy.name),
    )
    .execute()
  const policyIdByName = new Map<string, string>(policyRows.map((row: { id: string; name: string }) => [row.name, row.id]))

  const permissionRows = await db.selectFrom('permissions').select(['id', 'slug']).execute()
  const permissionIdBySlug = new Map<string, string>(permissionRows.map((row: { id: string; slug: string }) => [row.slug, row.id]))

  await db
    .insertInto('roles')
    .values(SEEDED_ROLES.map((role) => ({ name: role.name, description: role.description, is_system: false })))
    .onConflict((oc) => oc.column('name').doNothing())
    .execute()

  const roleRows = await db
    .selectFrom('roles')
    .select(['id', 'name'])
    .where(
      'name',
      'in',
      SEEDED_ROLES.map((role) => role.name),
    )
    .execute()
  const roleIdByName = new Map<string, string>(roleRows.map((row: { id: string; name: string }) => [row.name, row.id]))

  for (const role of SEEDED_ROLES) {
    const roleId = roleIdByName.get(role.name)
    if (!roleId) continue

    const permissionIds = role.permissions
      .map((slug) => permissionIdBySlug.get(slug))
      .filter((id): id is string => id !== undefined)
    if (permissionIds.length > 0) {
      await db
        .insertInto('role_permissions')
        .values(permissionIds.map((permissionId) => ({ role_id: roleId, permission_id: permissionId })))
        .onConflict((oc) => oc.columns(['role_id', 'permission_id']).doNothing())
        .execute()
    }

    // Only where unset — a role that already exists with a deliberately
    // chosen policy keeps it.
    const policyId = policyIdByName.get(role.policy)
    if (policyId) {
      await db
        .updateTable('roles')
        .set({ session_policy_id: policyId })
        .where('id', '=', roleId)
        .where('session_policy_id', 'is', null)
        .execute()
    }
  }

  const adminPolicyId = policyIdByName.get(ADMIN_POLICY)
  if (adminPolicyId) {
    await db
      .updateTable('roles')
      .set({ session_policy_id: adminPolicyId })
      .where('name', '=', 'ADMIN')
      .where('session_policy_id', 'is', null)
      .execute()
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  // role_permissions and user_roles cascade from roles (0001_init);
  // roles.session_policy_id is `set null` on policy delete, so the
  // admin role (and any custom role pointed at a seeded policy) simply
  // reverts to no policy.
  await db
    .deleteFrom('roles')
    .where(
      'name',
      'in',
      SEEDED_ROLES.map((role) => role.name),
    )
    .where('is_system', '=', false)
    .execute()

  await db
    .deleteFrom('session_policies')
    .where(
      'name',
      'in',
      SEEDED_POLICIES.map((policy) => policy.name),
    )
    .execute()
}
