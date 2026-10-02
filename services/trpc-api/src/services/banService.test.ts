import { describe, expect, test } from 'bun:test'
import { banUser, type BanUserDeps } from './banService'

function deps(overrides: Partial<BanUserDeps> = {}) {
  const calls: string[] = []
  const d: BanUserDeps & { calls: string[] } = {
    calls,
    listIdentities: async () => [
      { provider: 'google', subjectHash: 'hash-g' },
      { provider: 'apple', subjectHash: 'hash-a' },
    ],
    insertBan: async (params) => {
      calls.push(`ban:${params.provider}:${params.identityHash}:${params.reasonCategory}`)
      return { id: `ban-${params.provider}` }
    },
    insertEvidence: async (params) => {
      calls.push(`evidence:${params.banId}:${params.evidenceType}`)
    },
    setBannedAt: async () => {
      calls.push('banned_at')
    },
    ...overrides,
  }
  return d
}

describe('banUser', () => {
  test('records one ban per linked identity, with the reported messages and the note as evidence, then blocks the live account', async () => {
    const d = deps()
    await banUser(d, {
      userId: 'u1',
      reasonCategory: 'harassment',
      decisionSummary: 'Repeated targeting of another member.',
      bannedBy: 'mod-1',
      messages: [{ id: 'm1', body: 'go away', createdAt: new Date('2026-10-02T10:00:00Z') }],
    })
    expect(d.calls).toEqual([
      'ban:google:hash-g:harassment',
      'evidence:ban-google:operator_note',
      'evidence:ban-google:message',
      'ban:apple:hash-a:harassment',
      'evidence:ban-apple:operator_note',
      'evidence:ban-apple:message',
      'banned_at',
    ])
  })

  test('still blocks the live account when no identity is linked', async () => {
    const d = deps({ listIdentities: async () => [] })
    await banUser(d, { userId: 'u1', reasonCategory: 'other', decisionSummary: 'x', bannedBy: 'mod-1', messages: [] })
    expect(d.calls).toEqual(['banned_at'])
  })
})
