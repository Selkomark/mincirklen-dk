import { z } from 'zod'
import { banReasonCategorySchema, type BanReasonCategory } from '@mincirklen/shared'
import { defineTemplate } from '../types'
import { fill } from '../i18n'
import { Paragraph } from '../components/Paragraph'

// The reason category in plain words, and how to request the record.
// Never who reported them.
export const memberBannedTemplate = defineTemplate({
  key: 'member_banned',
  description: 'To a member whose account a moderator closed.',
  signOff: 'moderation',
  variablesSchema: z.object({ reasonCategory: banReasonCategorySchema }),
  sampleVariables: { reasonCategory: 'harassment' as BanReasonCategory },
  strings: {
    en: {
      subject: 'Your MinCirklen account has been closed',
      reason_predatory_contact: 'predatory contact with another member',
      reason_harassment: 'harassment of another member',
      reason_crisis_abuse: 'misuse of crisis support',
      reason_illegal_content: 'sharing illegal content',
      reason_other: 'a serious breach of our community guidelines',
      body:
        'A moderator has closed your account following a report of {{reason}}. ' +
        'You can no longer sign in to MinCirklen. We keep a record of the decision and the evidence behind it; ' +
        'you can request a copy of that record through our privacy contact.',
    },
  },
  subject: (_v, s) => s.subject,
  Body: ({ variables, strings }) => {
    const reason = strings[`reason_${variables.reasonCategory}`]
    return <Paragraph>{fill(strings.body, { reason })}</Paragraph>
  },
})
