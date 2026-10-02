import { z } from 'zod'
import { SUPPORTED_LANGUAGES } from './userProfile'

// Outbound email: the catalog of templates (React components in
// packages/emails, rendered server-side), the lifecycle a sent message
// moves through, and the admin "Emails" section's inputs. Transactional
// only for now; the shape (template key + variables + status + events)
// is what a later marketing layer builds on.

// One key per React template in packages/emails/src/templates. The
// registry there is typed against this list, so adding a key here
// without a template fails typecheck.
export const EMAIL_TEMPLATE_KEYS = [
  'report_received',
  'report_decided',
  'member_warned',
  'member_removed_from_circle',
  'member_messages_hidden',
  'member_banned',
  'member_unbanned',
  'gate_invite',
] as const
export const emailTemplateKeySchema = z.enum(EMAIL_TEMPLATE_KEYS)
export type EmailTemplateKey = z.infer<typeof emailTemplateKeySchema>

// Where a message is in its life. `queued`→`sent` is ours (row written,
// provider accepted the API call); everything after comes from the
// provider's webhooks. The last four are terminal — see
// services/trpc-api/src/services/emailStatus.ts for the ordering rules.
export const EMAIL_STATUSES = [
  'queued',
  'sent',
  'accepted',
  'delayed',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'failed',
  'suppressed',
  'complained',
] as const
export const emailStatusSchema = z.enum(EMAIL_STATUSES)
export type EmailStatus = z.infer<typeof emailStatusSchema>

// `log` writes the would-be message to the server log (local dev);
// `ahasend` delivers. Selected by EMAIL_PROVIDER at boot.
export const EMAIL_PROVIDERS = ['log', 'ahasend'] as const
export const emailProviderSchema = z.enum(EMAIL_PROVIDERS)
export type EmailProvider = z.infer<typeof emailProviderSchema>

export const emailLanguageSchema = z.enum(SUPPORTED_LANGUAGES)
export type EmailLanguage = z.infer<typeof emailLanguageSchema>

export const listEmailMessagesInputSchema = z.object({
  status: emailStatusSchema.optional(),
  templateKey: emailTemplateKeySchema.optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
})
export type ListEmailMessagesInput = z.infer<typeof listEmailMessagesInputSchema>

export const getEmailMessageInputSchema = z.object({ id: z.string().uuid() })

export const listEmailSuppressionsInputSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
})

// Variables are validated against the template's own zod schema in
// packages/emails; here they are just "a JSON object".
export const previewEmailTemplateInputSchema = z.object({
  templateKey: emailTemplateKeySchema,
  language: emailLanguageSchema.default('en'),
  variables: z.record(z.unknown()).optional(),
})
export type PreviewEmailTemplateInput = z.infer<typeof previewEmailTemplateInputSchema>

export const sendTestEmailInputSchema = z.object({
  templateKey: emailTemplateKeySchema,
  language: emailLanguageSchema.default('en'),
  to: z.string().trim().toLowerCase().email(),
  variables: z.record(z.unknown()).optional(),
})
export type SendTestEmailInput = z.infer<typeof sendTestEmailInputSchema>
