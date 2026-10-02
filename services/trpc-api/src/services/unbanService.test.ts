import { describe, expect, test } from 'bun:test'
import { unbanUser, UnbanNoteRequiredError, UserNotBannedError, type UnbanUserDeps } from './unbanService'

function deps(overrides: Partial<UnbanUserDeps> = {}) {
  const calls: string[] = []
  const d: UnbanUserDeps & { calls: string[] } = {
    calls,
    isBanned: async () => true,
    listIdentities: async () => [
      { provider: 'google', subjectHash: 'hash-g' },
      { provider: 'apple', subjectHash: 'hash-a' },
    ],
    liftBans: async (hashes, note) => {
      calls.push(`lift:${hashes.join('+')}:${note}`)
      return hashes.length
    },
    clearBannedAt: async () => {
      calls.push('clear')
    },
    addMemberNote: async (note) => {
      calls.push(`note:${note}`)
    },
    notifyUnbanned: async () => {
      calls.push('email')
    },
    ...overrides,
  }
  return d
}

describe('unbanUser', () => {
  test('lifts every identity ban, clears the live block, records the note, then tells the member', async () => {
    const d = deps()
    await unbanUser(d, { userId: 'u1', note: 'Appeal upheld after review.', liftedBy: 'mod-1' })
    expect(d.calls).toEqual(['lift:hash-g+hash-a:Appeal upheld after review.', 'clear', 'note:Appeal upheld after review.', 'email'])
  })

  test('refuses without a note', async () => {
    const d = deps()
    await expect(unbanUser(d, { userId: 'u1', note: '  ', liftedBy: 'mod-1' })).rejects.toBeInstanceOf(UnbanNoteRequiredError)
    expect(d.calls).toEqual([])
  })

  test('refuses for a member who is not banned', async () => {
    const d = deps({ isBanned: async () => false })
    await expect(unbanUser(d, { userId: 'u1', note: 'x', liftedBy: 'mod-1' })).rejects.toBeInstanceOf(UserNotBannedError)
    expect(d.calls).toEqual([])
  })
})
