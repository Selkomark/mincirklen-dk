import { createHmac } from 'node:crypto'

// An email address is PII we'd rather not store next to a record of what
// was sent to it. A keyed hash of the normalised address lets a row be
// matched later — to a provider suppression, or to a closed-account
// record request (docs/email_automation.md) — without the address itself
// being in the table. Keyed, same reasoning as identityHash.ts: the
// algorithm is public, so reproducing a particular person's hash has to
// require a server-side secret too. EMAIL_HASH_KEY is its own secret,
// separate from IDENTITY_HASH_KEY and the token secrets (key separation).

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function hashEmail(email: string, key: string): string {
  return createHmac('sha256', key).update(normalizeEmail(email)).digest('hex')
}
