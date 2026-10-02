import { z } from 'zod'
import { defineTemplate } from '../types'
import { Paragraph } from '../components/Paragraph'

// A moderator's own words to a member, followed by one line of context.
// Never says who reported them.
export const memberWarnedTemplate = defineTemplate({
  key: 'member_warned',
  description: "A moderator's warning to a member, in the moderator's own words.",
  signOff: 'moderation',
  variablesSchema: z.object({ message: z.string().min(1) }),
  sampleVariables: { message: 'Please keep it kind. A few of your messages yesterday crossed a line for others in the circle.' },
  strings: {
    en: {
      subject: 'A note from the MinCirklen moderators',
      context: 'This follows something that happened in one of your circles.',
    },
  },
  subject: (_v, s) => s.subject,
  Body: ({ variables, strings }) => (
    <>
      <Paragraph>{variables.message}</Paragraph>
      <Paragraph>{strings.context}</Paragraph>
    </>
  ),
})
