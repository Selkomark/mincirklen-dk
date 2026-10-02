import { z } from 'zod'
import { defineTemplate } from '../types'
import { fill } from '../i18n'
import { Paragraph } from '../components/Paragraph'
import { Link } from '../components/Link'

// The invite a waitlist signup receives when a launch manager grants
// them access. The signup is just an address — no profile language yet,
// so this always goes out in English until the sender says otherwise.
export const gateInviteTemplate = defineTemplate({
  key: 'gate_invite',
  description: 'The invitation link to a waitlist signup whose access was granted.',
  signOff: 'team',
  variablesSchema: z.object({ inviteUrl: z.string().url(), gateName: z.string().min(1) }),
  sampleVariables: { inviteUrl: 'https://mincirklen.dk/?invite=sample-token', gateName: 'Platform launch' },
  strings: {
    en: {
      subject: 'Your invitation to MinCirklen',
      opening: 'Your circle is ready. You asked to be let in to {{gateName}}, and a member of our team has opened the door.',
      useLink: 'Use this link to come in:',
      noRush:
        'The link is personal to you and keeps working until we say otherwise, so there is no rush. ' +
        'If you did not sign up for MinCirklen, you can ignore this email.',
    },
  },
  subject: (_v, s) => s.subject,
  Body: ({ variables, strings }) => (
    <>
      <Paragraph>{fill(strings.opening, { gateName: variables.gateName })}</Paragraph>
      <Paragraph>
        {strings.useLink}
        <br />
        <Link href={variables.inviteUrl} />
      </Paragraph>
      <Paragraph>{strings.noRush}</Paragraph>
    </>
  ),
})
