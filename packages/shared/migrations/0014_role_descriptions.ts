import type { Kysely } from 'kysely'

// Sharper seed descriptions, each built from words the others don't use,
// so a search for one area doesn't light up half the roles. Only rows
// still carrying the exact old seed text change — a description an
// operator has edited is theirs.
const CHANGES: Array<[name: string, from: string, to: string]> = [
  ['ADMIN', 'Full platform access', 'Unrestricted — holds every permission'],
  ['MODERATOR', 'Reviews flagged and crisis moderation events', 'Reviews flagged messages and decides session reports'],
  ['TRUST-SAFETY-LEAD', 'Moderation plus the ability to see users and change their roles', 'Senior moderation: can also ban members'],
  ['SUPPORT', 'Helps members with their accounts; can see users and their roles but not change them', 'Looks up member accounts and helps with sign-in problems'],
  ['LAUNCH-MANAGER', 'Runs early-access gates and their waitlists', 'Opens gates and works the waitlist'],
  ['ACCESS-MANAGER', 'Manages roles, permissions, session policies and who holds which role', 'Creates roles, grants them to people, sets session policies'],
  ['AUDITOR', 'Read-only view across the whole admin area', 'Read-only: can look at everything, change nothing'],
]

export async function up(db: Kysely<any>): Promise<void> {
  for (const [name, from, to] of CHANGES) {
    await db.updateTable('roles').set({ description: to }).where('name', '=', name).where('description', '=', from).execute()
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const [name, from, to] of CHANGES) {
    await db.updateTable('roles').set({ description: from }).where('name', '=', name).where('description', '=', to).execute()
  }
}
