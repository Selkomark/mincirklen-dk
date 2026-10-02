import { EMAIL_TEMPLATE_KEYS, type EmailTemplateKey } from '@mincirklen/shared'
import type { z } from 'zod'
import type { AnyEmailTemplate } from './types'
import { reportReceivedTemplate } from './templates/reportReceived'
import { reportDecidedTemplate } from './templates/reportDecided'
import { memberWarnedTemplate } from './templates/memberWarned'
import { memberRemovedFromCircleTemplate } from './templates/memberRemovedFromCircle'
import { memberMessagesHiddenTemplate } from './templates/memberMessagesHidden'
import { memberBannedTemplate } from './templates/memberBanned'
import { memberUnbannedTemplate } from './templates/memberUnbanned'
import { gateInviteTemplate } from './templates/gateInvite'

// Every template, keyed by the shared EMAIL_TEMPLATE_KEYS. `satisfies`
// makes a missing or extra key a typecheck error while keeping each
// entry's own variable type for EmailVariables<K>.
export const EMAIL_TEMPLATES = {
  report_received: reportReceivedTemplate,
  report_decided: reportDecidedTemplate,
  member_warned: memberWarnedTemplate,
  member_removed_from_circle: memberRemovedFromCircleTemplate,
  member_messages_hidden: memberMessagesHiddenTemplate,
  member_banned: memberBannedTemplate,
  member_unbanned: memberUnbannedTemplate,
  gate_invite: gateInviteTemplate,
} satisfies Record<EmailTemplateKey, AnyEmailTemplate>

export type EmailVariables<K extends EmailTemplateKey> = z.infer<(typeof EMAIL_TEMPLATES)[K]['variablesSchema']>

export function getTemplate(key: EmailTemplateKey): AnyEmailTemplate {
  return EMAIL_TEMPLATES[key]
}

export interface EmailTemplateSummary {
  key: EmailTemplateKey
  description: string
  sampleVariables: Record<string, unknown>
}

// For the admin catalog, in the shared list's order.
export function listTemplates(): EmailTemplateSummary[] {
  return EMAIL_TEMPLATE_KEYS.map((key) => {
    const template = EMAIL_TEMPLATES[key]
    return { key, description: template.description, sampleVariables: template.sampleVariables as Record<string, unknown> }
  })
}
