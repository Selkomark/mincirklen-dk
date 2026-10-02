import type { Kysely } from 'kysely'
import type { Database } from '@mincirklen/shared'
import { createLoggingEmailSender, type EmailSender } from '../adapters/emailAdapter'
import type { KmsConfig } from '../adapters/kmsAdapter'
import type { EmailContent } from '../services/moderationEmails'
import { findEmailForUser } from '../repositories/userRepository'

// TODO(email): the logging stand-in — see adapters/emailAdapter.ts and
// TODO.md. Swap for a real sender here; nothing else changes.
export const emailSender: EmailSender = createLoggingEmailSender()

// Best-effort delivery to a member: resolves their address server-side
// and never throws. A report, a decision or a ban must not fail because
// an email didn't go out — the record is the source of truth, the email
// is a courtesy. A member with no address on file (legacy/failure rows,
// see rbacRepository.ts) is simply skipped.
export async function emailMember(db: Kysely<Database>, kms: KmsConfig, userId: string, content: EmailContent): Promise<void> {
  try {
    const to = await findEmailForUser(db, kms, userId)
    if (to) await emailSender.sendEmail({ to, ...content })
  } catch (err) {
    console.error('[EMAIL] failed to send to member', { userId, subject: content.subject, err })
  }
}
