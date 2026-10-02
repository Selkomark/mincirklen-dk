import { z } from 'zod'
import { defineTemplate } from '../types'
import { fill } from '../i18n'
import { Paragraph } from '../components/Paragraph'

export const memberMessagesHiddenTemplate = defineTemplate({
  key: 'member_messages_hidden',
  description: 'To a member whose messages a moderator removed after a report.',
  signOff: 'moderation',
  variablesSchema: z.object({ circleName: z.string().nullable(), count: z.number().int().min(1) }),
  sampleVariables: { circleName: 'Tuesday circle', count: 2 },
  strings: {
    en: {
      subject: 'Some of your messages were removed',
      namedCircle: 'the circle "{{circleName}}"',
      someCircle: 'one of your circles',
      one: 'one of your messages',
      many: '{{count}} of your messages',
      body:
        'After a report, a moderator removed {{what}} in {{where}}. Other members can no longer see them; you still can, marked as removed. ' +
        'Please keep our community guidelines in mind going forward.',
    },
  },
  subject: (_v, s) => s.subject,
  Body: ({ variables, strings }) => {
    const where = variables.circleName ? fill(strings.namedCircle, { circleName: variables.circleName }) : strings.someCircle
    const what = variables.count === 1 ? strings.one : fill(strings.many, { count: variables.count })
    return <Paragraph>{fill(strings.body, { what, where })}</Paragraph>
  },
})
