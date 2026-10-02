import { z } from 'zod'
import { sessionReportDecisionSchema } from '@mincirklen/shared'
import { defineTemplate } from '../types'
import { Paragraph } from '../components/Paragraph'

// To the reporter once a moderator has decided. The reporter is never
// told what was done to anyone else — only that someone looked, and
// (for a dismissal) that reporting was still the right thing to do.
export const reportDecidedTemplate = defineTemplate({
  key: 'report_decided',
  description: 'To the reporter when their session report is decided.',
  signOff: 'moderation',
  variablesSchema: z.object({ status: sessionReportDecisionSchema }),
  sampleVariables: { status: 'reviewed' as const },
  strings: {
    en: {
      subject: 'An update on your report',
      dismissed:
        'Thank you for taking the time to report this. A moderator has looked carefully at what happened and, on this occasion, ' +
        'did not find grounds to act. That does not mean your concern was misplaced — if anything else happens, please tell us again. ' +
        'Reports like yours are how we keep an eye on things.',
      reviewed:
        'Thank you for speaking up. A moderator has looked carefully at what happened, reached a decision, and taken the steps ' +
        "needed to keep MinCirklen a safe place. Out of respect for everyone's privacy we don't share the details of what was done, " +
        'but please know your report made a difference.',
      reviewedClosing: 'Please keep looking out for one another. Every report helps make the circles safer for everybody.',
    },
  },
  subject: (_v, s) => s.subject,
  Body: ({ variables, strings }) =>
    variables.status === 'dismissed' ? (
      <Paragraph>{strings.dismissed}</Paragraph>
    ) : (
      <>
        <Paragraph>{strings.reviewed}</Paragraph>
        <Paragraph>{strings.reviewedClosing}</Paragraph>
      </>
    ),
})
