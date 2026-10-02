import { z } from 'zod'
import { defineTemplate } from '../types'
import { Paragraph } from '../components/Paragraph'
import { Link } from '../components/Link'

// Lifting a ban. Says only that the account is open again — never the
// moderator's reasoning — and points at what we expect going forward.
export const memberUnbannedTemplate = defineTemplate({
  key: 'member_unbanned',
  description: 'To a member whose account ban was lifted.',
  signOff: 'moderation',
  variablesSchema: z.object({ termsUrl: z.string().url(), guidelinesUrl: z.string().url() }),
  sampleVariables: { termsUrl: 'https://mincirklen.dk/terms-and-conditions', guidelinesUrl: 'https://mincirklen.dk/community-guidelines' },
  strings: {
    en: {
      subject: 'Your MinCirklen account is open again',
      opening: 'Good news: your MinCirklen account has been reopened and you can sign in again.',
      askBefore: 'We ask everyone in a circle to look after one another. Before you come back, please take a moment with our ',
      guidelines: 'community guidelines',
      and: ' and ',
      terms: 'terms and conditions',
      askAfter: ' — they are what let people share here safely. A further serious breach would mean the account is closed for good.',
    },
  },
  subject: (_v, s) => s.subject,
  Body: ({ variables, strings }) => (
    <>
      <Paragraph>{strings.opening}</Paragraph>
      <Paragraph>
        {strings.askBefore}
        <Link href={variables.guidelinesUrl}>{strings.guidelines}</Link>
        {strings.and}
        <Link href={variables.termsUrl}>{strings.terms}</Link>
        {strings.askAfter}
      </Paragraph>
    </>
  ),
})
