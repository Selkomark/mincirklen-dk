import { z } from 'zod'
import { defineTemplate } from '../types'
import { fill } from '../i18n'
import { Paragraph } from '../components/Paragraph'

export const memberRemovedFromCircleTemplate = defineTemplate({
  key: 'member_removed_from_circle',
  description: 'To a member a moderator removed from a circle after a report.',
  signOff: 'moderation',
  variablesSchema: z.object({ circleName: z.string().nullable() }),
  sampleVariables: { circleName: 'Tuesday circle' },
  strings: {
    en: {
      subject: 'You were removed from a circle',
      namedCircle: 'the circle "{{circleName}}"',
      someCircle: 'one of your circles',
      body:
        'A moderator has removed you from {{where}} after a report. You can no longer read or take part in that circle. ' +
        'Your account is not affected and you can still join other circles.',
    },
  },
  subject: (_v, s) => s.subject,
  Body: ({ variables, strings }) => {
    const where = variables.circleName ? fill(strings.namedCircle, { circleName: variables.circleName }) : strings.someCircle
    return <Paragraph>{fill(strings.body, { where })}</Paragraph>
  },
})
