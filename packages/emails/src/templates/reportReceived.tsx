import { z } from 'zod'
import { defineTemplate } from '../types'
import { Paragraph } from '../components/Paragraph'

// To the member who filed a report. Says only that it arrived and that
// nobody in the circle knows who filed it — never what will be done.
export const reportReceivedTemplate = defineTemplate({
  key: 'report_received',
  description: 'To a member right after they file a session report.',
  signOff: 'moderation',
  variablesSchema: z.object({}),
  sampleVariables: {},
  strings: {
    en: {
      subject: 'We received your report',
      body:
        'Thank you for telling us. Your report has reached the moderation team and will be reviewed by a person. ' +
        'Nobody in the circle has been told who filed it.',
    },
  },
  subject: (_v, s) => s.subject,
  Body: ({ strings }) => <Paragraph>{strings.body}</Paragraph>,
})
