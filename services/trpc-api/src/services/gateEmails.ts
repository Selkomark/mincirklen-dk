// The invite a waitlist signup receives when a launch manager grants
// them access. Pure function, same shape and sign-off as
// moderationEmails.ts. English only for now — the signup is just an
// address, there's no profile language yet (TODO.md, "Email delivery").
import type { EmailContent } from './moderationEmails'

export function gateInviteEmail(inviteUrl: string, gateName: string): EmailContent {
  return {
    subject: 'Your invitation to MinCirklen',
    text:
      `Your circle is ready. You asked to be let in to ${gateName}, and a member of our team has opened the door.\n\n` +
      `Use this link to come in:\n${inviteUrl}\n\n` +
      'The link is personal to you and keeps working until we say otherwise, so there is no rush. ' +
      'If you did not sign up for MinCirklen, you can ignore this email.\n\n' +
      "This message was sent by the MinCirklen team. You don't need to reply.",
  }
}
