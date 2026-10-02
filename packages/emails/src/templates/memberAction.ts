import type { BanReasonCategory, SessionReportAction } from '@mincirklen/shared'
import type { EmailTemplateKey } from '../types'

// Which member-facing email an action on a member calls for. 'note' is
// internal and 'none' is no action; 'warn' carries its own text
// (member_warned) and isn't built here.
export type MemberActionTemplate =
  | { templateKey: 'member_removed_from_circle'; variables: { circleName: string | null } }
  | { templateKey: 'member_messages_hidden'; variables: { circleName: string | null; count: number } }
  | { templateKey: 'member_banned'; variables: { reasonCategory: BanReasonCategory } }

export function memberActionTemplate(
  action: Exclude<SessionReportAction, 'none' | 'note' | 'warn'>,
  context: { circleName: string | null; hiddenCount: number; banReasonCategory: BanReasonCategory | null },
): MemberActionTemplate & { templateKey: EmailTemplateKey } {
  switch (action) {
    case 'remove_from_session':
      return { templateKey: 'member_removed_from_circle', variables: { circleName: context.circleName } }
    case 'hide_messages':
      return { templateKey: 'member_messages_hidden', variables: { circleName: context.circleName, count: context.hiddenCount } }
    case 'ban':
      return { templateKey: 'member_banned', variables: { reasonCategory: context.banReasonCategory ?? 'other' } }
  }
}
