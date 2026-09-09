import { createHmac } from 'node:crypto'

// A real-identity provider's stable subject id (Google's `sub` claim, and
// any future provider's equivalent) is high-entropy but not secret — a
// targeted attacker who independently obtains a specific person's raw
// subject (e.g. by getting them to sign into an OAuth app the attacker
// controls) could otherwise recompute the same hash and correlate it
// against a leaked `user_identities` dump, since the hashing algorithm
// itself is public (this is an open-source repo). Keying the hash with a
// server-side secret closes that: the algorithm stays public, but
// reproducing a specific person's hash requires the key too.
export function hashIdentitySubject(subject: string, key: string): string {
  return createHmac('sha256', key).update(subject).digest('hex')
}
