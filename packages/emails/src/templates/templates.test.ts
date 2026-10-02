import { describe, expect, test } from 'bun:test'
import { renderEmail } from '../render'
import { memberActionTemplate } from './memberAction'

// The wording rules these templates follow: a reporter is never told
// what was done to anyone else, and a member acted on is never told who
// reported them. Assertions run against the derived plain text, which is
// what a text-only client shows.
const text = (key: Parameters<typeof renderEmail>[0], variables: unknown) => renderEmail(key, 'en', variables).text
const subject = (key: Parameters<typeof renderEmail>[0], variables: unknown) => renderEmail(key, 'en', variables).subject

describe('report emails', () => {
  test('the reporter is acknowledged and never told what was done to anyone', () => {
    expect(subject('report_received', {})).toBe('We received your report')
    expect(text('report_received', {})).toContain('Nobody in the circle has been told')
    const reviewed = text('report_decided', { status: 'reviewed' })
    expect(reviewed).toContain('Thank you for speaking up')
    expect(reviewed).toContain('taken the steps')
    expect(reviewed).toContain("don't share the details")
    expect(reviewed).toContain('safer for everybody')
    const dismissed = text('report_decided', { status: 'dismissed' })
    expect(dismissed).toContain('did not find grounds')
    expect(dismissed).toContain('Thank you for taking the time')
    expect(dismissed).not.toContain('safer for everybody')
    expect(subject('report_decided', { status: 'dismissed' })).toBe('An update on your report')
  })
})

describe('member emails', () => {
  test("a warning carries the moderator's own words first, then one line of context", () => {
    const out = text('member_warned', { message: 'Please keep it kind.\nSecond paragraph.' })
    expect(out.indexOf('Please keep it kind.\nSecond paragraph.')).toBeLessThan(out.indexOf('This follows something that happened'))
    expect(subject('member_warned', { message: 'x' })).toBe('A note from the MinCirklen moderators')
  })

  test('removal and hiding name the circle when it has a name, and fall back when not', () => {
    expect(text('member_removed_from_circle', { circleName: 'Tuesday circle' })).toContain('the circle "Tuesday circle"')
    expect(text('member_removed_from_circle', { circleName: null })).toContain('one of your circles')
    expect(subject('member_removed_from_circle', { circleName: null })).toBe('You were removed from a circle')
    expect(text('member_messages_hidden', { circleName: 'X', count: 1 })).toContain('one of your messages in the circle "X"')
    expect(text('member_messages_hidden', { circleName: null, count: 3 })).toContain('3 of your messages in one of your circles')
    expect(subject('member_messages_hidden', { circleName: null, count: 3 })).toBe('Some of your messages were removed')
  })

  test('a ban states the reason category in plain words and how to request the record', () => {
    expect(subject('member_banned', { reasonCategory: 'harassment' })).toBe('Your MinCirklen account has been closed')
    expect(text('member_banned', { reasonCategory: 'harassment' })).toContain('report of harassment of another member.')
    expect(text('member_banned', { reasonCategory: 'harassment' })).toContain('request a copy')
    expect(text('member_banned', { reasonCategory: 'other' })).toContain('serious breach')
    expect(text('member_banned', { reasonCategory: 'predatory_contact' })).toContain('predatory contact')
    expect(text('member_banned', { reasonCategory: 'crisis_abuse' })).toContain('misuse of crisis support')
    expect(text('member_banned', { reasonCategory: 'illegal_content' })).toContain('sharing illegal content')
  })

  test('lifting a ban says only that the account is open, and links the rules', () => {
    const vars = { termsUrl: 'https://x/terms', guidelinesUrl: 'https://x/guidelines' }
    expect(subject('member_unbanned', vars)).toBe('Your MinCirklen account is open again')
    const out = text('member_unbanned', vars)
    expect(out).toContain('community guidelines (https://x/guidelines)')
    expect(out).toContain('terms and conditions (https://x/terms)')
    expect(out).not.toContain('note')
    expect(out).toContain('closed for good')
  })
})

describe('gate invite', () => {
  test('carries the link on its own line and names the gate', () => {
    const vars = { inviteUrl: 'https://mincirklen.dk/?invite=abc', gateName: 'Platform launch' }
    expect(subject('gate_invite', vars)).toBe('Your invitation to MinCirklen')
    const out = text('gate_invite', vars)
    expect(out).toContain('let in to Platform launch')
    expect(out).toContain('Use this link to come in:\nhttps://mincirklen.dk/?invite=abc')
    expect(out).toEndWith("This message was sent by the MinCirklen team. You don't need to reply.")
  })
})

describe('memberActionTemplate', () => {
  test('routes each action to its template and variables', () => {
    const context = { circleName: 'C', hiddenCount: 2, banReasonCategory: null }
    expect(memberActionTemplate('remove_from_session', context)).toEqual({ templateKey: 'member_removed_from_circle', variables: { circleName: 'C' } })
    expect(memberActionTemplate('hide_messages', context)).toEqual({ templateKey: 'member_messages_hidden', variables: { circleName: 'C', count: 2 } })
    expect(memberActionTemplate('ban', context)).toEqual({ templateKey: 'member_banned', variables: { reasonCategory: 'other' } })
    expect(memberActionTemplate('ban', { ...context, banReasonCategory: 'illegal_content' }).variables).toEqual({ reasonCategory: 'illegal_content' })
  })
})
