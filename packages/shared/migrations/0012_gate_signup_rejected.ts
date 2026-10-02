import { sql, type Kysely } from 'kysely'

// A waitlist signup can be declined. 'rejected' is its own status rather
// than a delete so the address stays on record (re-submitting is a
// no-op on the unique key) and so it can still be granted later if the
// decision changes. No email goes out on rejection.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`alter table gate_signups drop constraint gate_signups_status_check`.execute(db)
  await sql`alter table gate_signups add constraint gate_signups_status_check check (status in ('pending','granted','revoked','rejected'))`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`update gate_signups set status = 'pending' where status = 'rejected'`.execute(db)
  await sql`alter table gate_signups drop constraint gate_signups_status_check`.execute(db)
  await sql`alter table gate_signups add constraint gate_signups_status_check check (status in ('pending','granted','revoked'))`.execute(db)
}
