import type { Database, GateSignup } from '@mincirklen/shared'
import { sql, type Kysely } from 'kysely'

function toGateSignup(row: {
  id: string
  gate_key: string
  email: string
  status: string
  created_at: Date
  granted_at: Date | null
  granted_by: string | null
}): GateSignup {
  return {
    id: row.id,
    gateKey: row.gate_key,
    email: row.email,
    status: row.status as GateSignup['status'],
    createdAt: row.created_at,
    grantedAt: row.granted_at,
    grantedBy: row.granted_by,
  }
}

// ON CONFLICT DO NOTHING — resubmitting an email already on a gate's
// waitlist is a silent no-op, not an error (gate_signups_gate_key_email_key,
// migrations/0001_init.ts), matching the request's "just get me on the
// list" intent rather than surfacing an internal uniqueness detail.
export async function insertSignup(db: Kysely<Database>, gateKey: string, email: string): Promise<void> {
  await db
    .insertInto('gate_signups')
    .values({ gate_key: gateKey, email })
    .onConflict((oc) => oc.columns(['gate_key', 'email']).doNothing())
    .execute()
}

// Cursor encodes both the sort key and the id ("<created_at::text>|<id>"),
// not just the id — id alone can't correctly resume a created_at-ordered
// scan, since UUIDs are random and have no relationship to insertion
// order (a row's id being "less than" the cursor's says nothing about
// whether it comes later in created_at order). Same keyset-pagination
// shape as sessionRepository.ts::listOpenSessions's cursor, including the
// ::text cast — created_at round-trips through pg as a JS Date, which
// only has millisecond resolution, while timestamptz has microsecond
// resolution; casting to text avoids truncating a boundary row's precise
// value and returning it twice.
function encodeCursor(createdAtText: string, id: string): string {
  return `${createdAtText}|${id}`
}

function decodeCursor(cursor: string): { createdAtText: string; id: string } {
  const [createdAtText, id] = cursor.split('|')
  if (!createdAtText || !id) {
    throw new Error(`invalid cursor: ${cursor}`)
  }
  return { createdAtText, id }
}

export async function listSignups(
  db: Kysely<Database>,
  gateKey: string,
  params: { status?: 'pending' | 'granted' | 'revoked'; cursor?: string; limit: number },
): Promise<{ signups: GateSignup[]; nextCursor: string | null }> {
  let query = db
    .selectFrom('gate_signups')
    .select(['id', 'gate_key', 'email', 'status', 'created_at', 'granted_at', 'granted_by', sql<string>`created_at::text`.as('created_at_cursor')])
    .where('gate_key', '=', gateKey)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(params.limit + 1)

  if (params.status) {
    query = query.where('status', '=', params.status)
  }
  if (params.cursor) {
    const { createdAtText, id } = decodeCursor(params.cursor)
    query = query.where((eb) =>
      eb.or([
        sql<boolean>`created_at::text < ${createdAtText}`,
        eb.and([sql<boolean>`created_at::text = ${createdAtText}`, eb('id', '<', id)]),
      ]),
    )
  }

  const rows = await query.execute()
  const hasMore = rows.length > params.limit
  const page = hasMore ? rows.slice(0, params.limit) : rows
  const last = page[page.length - 1]

  return {
    signups: page.map(toGateSignup),
    nextCursor: hasMore && last ? encodeCursor(last.created_at_cursor, last.id) : null,
  }
}

export async function markGranted(db: Kysely<Database>, id: string, grantedBy: string | null): Promise<GateSignup | null> {
  const row = await db
    .updateTable('gate_signups')
    .set({ status: 'granted', granted_at: new Date(), granted_by: grantedBy })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()

  return row ? toGateSignup(row) : null
}

// Leaves granted_at/granted_by as-is — a historical "who granted this,
// and when" record stays informative after a revoke, unlike resetting
// straight to 'pending' would (see the migration's comment on why
// 'revoked' is its own status). redeemGateInvite (featureGateService.ts)
// only ever accepts an exactly-'granted' row, so this alone is what
// invalidates the person's existing invite link.
export async function markRevoked(db: Kysely<Database>, id: string): Promise<GateSignup | null> {
  const row = await db
    .updateTable('gate_signups')
    .set({ status: 'revoked' })
    .where('id', '=', id)
    .where('status', '=', 'granted')
    .returningAll()
    .executeTakeFirst()

  return row ? toGateSignup(row) : null
}

export async function findSignupById(db: Kysely<Database>, id: string): Promise<GateSignup | null> {
  const row = await db.selectFrom('gate_signups').selectAll().where('id', '=', id).executeTakeFirst()
  return row ? toGateSignup(row) : null
}

// One grouped query covering every gate at once — the admin list view's
// aggregated stats (featureGateService.ts::listGatesWithStats) needs one
// count per (gateKey, status), not N+1 queries per registry entry.
export async function countsByGateKey(
  db: Kysely<Database>,
): Promise<Map<string, { pending: number; granted: number; revoked: number }>> {
  const rows = await db
    .selectFrom('gate_signups')
    .select(['gate_key', 'status', (eb) => eb.fn.countAll().as('count')])
    .groupBy(['gate_key', 'status'])
    .execute()

  const counts = new Map<string, { pending: number; granted: number; revoked: number }>()
  for (const row of rows) {
    const entry = counts.get(row.gate_key) ?? { pending: 0, granted: 0, revoked: 0 }
    const count = Number(row.count)
    if (row.status === 'granted') entry.granted = count
    else if (row.status === 'revoked') entry.revoked = count
    else entry.pending = count
    counts.set(row.gate_key, entry)
  }
  return counts
}
