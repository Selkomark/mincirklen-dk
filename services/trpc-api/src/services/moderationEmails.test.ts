import { describe, expect, test } from 'bun:test'
import {
  memberActionEmail,
  memberBannedEmail,
  memberMessagesHiddenEmail,
  memberRemovedFromCircleEmail,
  memberWarnedEmail,
  reportDecidedEmail,
  reportReceivedEmail,
} from './moderationEmails'

describe('moderation emails', () => {
  test('the reporter is acknowledged and never told what was done to anyone', () => {
    expect(reportReceivedEmail().subject).toBe('We received your report')
    expect(reportReceivedEmail().text).toContain('Nobody in the circle has been told')
    const reviewed = reportDecidedEmail('reviewed')
    expect(reviewed.text).toContain("we don't share what was done")
    expect(reportDecidedEmail('dismissed').text).toContain('did not find grounds')
  })

  test('a warning carries the moderator\'s own words', () => {
    expect(memberWarnedEmail('Please keep it kind.').text).toStartWith('Please keep it kind.')
  })

  test('removal and hiding name the circle when it has a name, and fall back when not', () => {
    expect(memberRemovedFromCircleEmail('Tuesday circle').text).toContain('the circle "Tuesday circle"')
    expect(memberRemovedFromCircleEmail(null).text).toContain('one of your circles')
    expect(memberMessagesHiddenEmail('X', 1).text).toContain('one of your messages')
    expect(memberMessagesHiddenEmail('X', 3).text).toContain('3 of your messages')
  })

  test('a ban states the reason category in plain words and how to request the record', () => {
    const email = memberBannedEmail('harassment')
    expect(email.subject).toBe('Your MinCirklen account has been closed')
    expect(email.text).toContain('harassment of another member')
    expect(email.text).toContain('request a copy')
    expect(memberBannedEmail('other').text).toContain('serious breach')
  })

  test('memberActionEmail routes each action to its template', () => {
    const context = { circleName: 'C', hiddenCount: 2, banReasonCategory: null }
    expect(memberActionEmail('remove_from_session', context).subject).toBe('You were removed from a circle')
    expect(memberActionEmail('hide_messages', context).subject).toBe('Some of your messages were removed')
    expect(memberActionEmail('ban', context).text).toContain('serious breach')
    expect(memberActionEmail('ban', { ...context, banReasonCategory: 'illegal_content' }).text).toContain('illegal content')
  })

  test('every email ends with the sign-off', () => {
    for (const email of [reportReceivedEmail(), reportDecidedEmail('reviewed'), memberWarnedEmail('x'), memberRemovedFromCircleEmail(null), memberMessagesHiddenEmail(null, 1), memberBannedEmail('other')]) {
      expect(email.text).toEndWith("You don't need to reply.")
    }
  })
})
