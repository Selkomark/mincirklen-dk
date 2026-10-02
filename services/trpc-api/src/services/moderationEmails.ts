import type { BanReasonCategory, SessionReportAction, SessionReportDecision } from '@mincirklen/shared'

// Member-facing emails for the report lifecycle. Pure functions — the
// subject/body for each moment — so the wording is tested once here and
// every sender (the routers) stays a one-liner. English only for now: the
// member's language lives in their profile, and a translated template
// belongs with the real email integration (TODO.md, "Email delivery").
//
// Two rules the wording follows throughout: a reporter is never told what
// was done to anyone else (only that their report was looked at), and a
// member acted on is told what happened to them and why in plain terms,
// never who reported them.

export interface EmailContent {
  subject: string
  text: string
}

const SIGN_OFF = '\n\nThis message was sent by the MinCirklen moderation team. You don\'t need to reply.'

export function reportReceivedEmail(): EmailContent {
  return {
    subject: 'We received your report',
    text:
      'Thank you for telling us. Your report has reached the moderation team and will be reviewed by a person. ' +
      'Nobody in the circle has been told who filed it.' +
      SIGN_OFF,
  }
}

export function reportDecidedEmail(status: SessionReportDecision): EmailContent {
  const outcome =
    status === 'dismissed'
      ? 'Thank you for taking the time to report this. A moderator has looked carefully at what happened and, on this occasion, ' +
        'did not find grounds to act. That does not mean your concern was misplaced \u2014 if anything else happens, please tell us again. ' +
        'Reports like yours are how we keep an eye on things.'
      : 'Thank you for speaking up. A moderator has looked carefully at what happened, reached a decision, and taken the steps ' +
        'needed to keep MinCirklen a safe place. Out of respect for everyone\'s privacy we don\'t share the details of what was done, ' +
        'but please know your report made a difference.\n\n' +
        'Please keep looking out for one another. Every report helps make the circles safer for everybody.'
  return { subject: 'An update on your report', text: `${outcome}${SIGN_OFF}` }
}

export function memberWarnedEmail(message: string): EmailContent {
  return {
    subject: 'A note from the MinCirklen moderators',
    text: `${message}\n\nThis follows something that happened in one of your circles.${SIGN_OFF}`,
  }
}

export function memberRemovedFromCircleEmail(circleName: string | null): EmailContent {
  const where = circleName ? `the circle "${circleName}"` : 'one of your circles'
  return {
    subject: 'You were removed from a circle',
    text:
      `A moderator has removed you from ${where} after a report. You can no longer read or take part in that circle. ` +
      'Your account is not affected and you can still join other circles.' +
      SIGN_OFF,
  }
}

export function memberMessagesHiddenEmail(circleName: string | null, count: number): EmailContent {
  const where = circleName ? `the circle "${circleName}"` : 'one of your circles'
  const what = count === 1 ? 'one of your messages' : `${count} of your messages`
  return {
    subject: 'Some of your messages were removed',
    text:
      `After a report, a moderator removed ${what} in ${where}. Other members can no longer see them; you still can, marked as removed. ` +
      'Please keep our community guidelines in mind going forward.' +
      SIGN_OFF,
  }
}

const BAN_REASON_PHRASES: Record<BanReasonCategory, string> = {
  predatory_contact: 'predatory contact with another member',
  harassment: 'harassment of another member',
  crisis_abuse: 'misuse of crisis support',
  illegal_content: 'sharing illegal content',
  other: 'a serious breach of our community guidelines',
}

export function memberBannedEmail(reasonCategory: BanReasonCategory): EmailContent {
  return {
    subject: 'Your MinCirklen account has been closed',
    text:
      `A moderator has closed your account following a report of ${BAN_REASON_PHRASES[reasonCategory]}. ` +
      'You can no longer sign in to MinCirklen. We keep a record of the decision and the evidence behind it; ' +
      'you can request a copy of that record through our privacy contact.' +
      SIGN_OFF,
  }
}

// Which member-facing email, if any, an action on a member calls for.
// 'note' is internal and 'none' is no action; 'warn' carries its own text
// (memberWarnedEmail) and isn't built here.
export function memberActionEmail(
  action: Exclude<SessionReportAction, 'none' | 'note' | 'warn'>,
  context: { circleName: string | null; hiddenCount: number; banReasonCategory: BanReasonCategory | null },
): EmailContent {
  switch (action) {
    case 'remove_from_session':
      return memberRemovedFromCircleEmail(context.circleName)
    case 'hide_messages':
      return memberMessagesHiddenEmail(context.circleName, context.hiddenCount)
    case 'ban':
      return memberBannedEmail(context.banReasonCategory ?? 'other')
  }
}
