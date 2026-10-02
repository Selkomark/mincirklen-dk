import { describe, expect, test } from 'bun:test'
import { gateInviteEmail } from './gateEmails'

describe('gateInviteEmail', () => {
  test('carries the link and names the gate', () => {
    const email = gateInviteEmail('https://mincirklen.dk/?invite=abc', 'Platform launch')
    expect(email.subject).toBe('Your invitation to MinCirklen')
    expect(email.text).toContain('https://mincirklen.dk/?invite=abc')
    expect(email.text).toContain('Platform launch')
    expect(email.text).toEndWith("You don't need to reply.")
  })
})
