import { describe, expect, test } from 'bun:test'
import { NotAMemberError } from './messageService'
import {
  reviewSessionReport,
  submitSessionReport,
  type SubmitSessionReportDeps,
  SessionReportAlreadyResolvedError,
  SessionReportForbiddenActionError,
  SessionReportInvalidActionError,
  SessionReportNoteRequiredError,
  SessionReportNotFoundError,
  type ReviewSessionReportDeps,
} from './sessionReportService'

const OPEN_REPORT = { status: 'open' as const, sessionId: 's1', aboutUserIds: ['alice', 'bob'], messageIds: ['m1'] }

function deps(overrides: Partial<ReviewSessionReportDeps> = {}): ReviewSessionReportDeps & { applied: string[] } {
  const applied: string[] = []
  return {
    applied,
    findReport: async () => OPEN_REPORT,
    applyDecision: async (params) => {
      applied.push(`decision:${params.status}:${params.outcomes.map((o) => `${o.action}(${o.targetUserIds.join('+')})`).join(',')}:${params.note}`)
    },
    addMemberNote: async (userId, note) => {
      applied.push(`note:${userId}:${note}`)
    },
    sendWarning: async (userId, message) => {
      applied.push(`warn:${userId}:${message}`)
    },
    removeFromSession: async (userId) => {
      applied.push(`remove:${userId}`)
    },
    hideMessages: async (messageIds) => {
      applied.push(`hide:${messageIds.join('+')}`)
    },
    banUser: async (userId, reasonCategory) => {
      applied.push(`ban:${userId}:${reasonCategory}`)
    },
    notifyDecision: async (params) => {
      applied.push(`notify:${params.status}:${params.outcomes.map((o) => o.action).join(',')}`)
    },
    ...overrides,
  }
}

const base = { status: 'reviewed' as const, note: 'Looked into it.', outcomes: [], canBan: true }

describe('reviewSessionReport', () => {
  test('marks an open report reviewed with no outcome', async () => {
    const d = deps()
    await reviewSessionReport(d, base)
    expect(d.applied).toEqual(['decision:reviewed::Looked into it.', 'notify:reviewed:'])
  })

  test('marks an open report dismissed', async () => {
    const d = deps()
    await reviewSessionReport(d, { ...base, status: 'dismissed', note: 'Nothing in the transcript supports it.' })
    expect(d.applied).toEqual(['decision:dismissed::Nothing in the transcript supports it.', 'notify:dismissed:'])
  })

  test('rejects an unknown report without touching storage', async () => {
    const d = deps({ findReport: async () => null })
    await expect(reviewSessionReport(d, base)).rejects.toBeInstanceOf(SessionReportNotFoundError)
    expect(d.applied).toEqual([])
  })

  test('refuses a decision without a note — the reasoning is the record', async () => {
    const d = deps()
    await expect(reviewSessionReport(d, { ...base, note: '   ' })).rejects.toBeInstanceOf(SessionReportNoteRequiredError)
    expect(d.applied).toEqual([])
  })

  test.each(['reviewed', 'dismissed'] as const)('refuses to re-decide a report already %s', async (existing) => {
    const d = deps({ findReport: async () => ({ ...OPEN_REPORT, status: existing }) })
    await expect(reviewSessionReport(d, { ...base, status: 'dismissed' })).rejects.toBeInstanceOf(SessionReportAlreadyResolvedError)
    expect(d.applied).toEqual([])
  })

  test('different outcomes for different members in one decision: warn one, ban another', async () => {
    const d = deps()
    await reviewSessionReport(d, {
      ...base,
      outcomes: [
        { action: 'warn', targetUserIds: ['alice'], memberMessage: 'Please keep it kind.' },
        { action: 'ban', targetUserIds: ['bob'], banReasonCategory: 'harassment' },
      ],
    })
    expect(d.applied).toEqual([
      'warn:alice:Please keep it kind.',
      'ban:bob:harassment',
      'decision:reviewed:warn(alice),ban(bob):Looked into it.',
      'notify:reviewed:warn,ban',
    ])
  })

  test('a member can be in several outcomes — a note and a warning both apply', async () => {
    const d = deps()
    await reviewSessionReport(d, {
      ...base,
      outcomes: [
        { action: 'note', targetUserIds: ['alice', 'alice'] },
        { action: 'warn', targetUserIds: ['alice'], memberMessage: 'Careful.' },
      ],
    })
    expect(d.applied.slice(0, 2)).toEqual(['note:alice:Looked into it.', 'warn:alice:Careful.'])
  })

  test('a warning needs member-facing text', async () => {
    const d = deps()
    await expect(reviewSessionReport(d, { ...base, outcomes: [{ action: 'warn', targetUserIds: ['alice'] }] })).rejects.toBeInstanceOf(
      SessionReportInvalidActionError,
    )
    expect(d.applied).toEqual([])
  })

  test('hiding messages applies to the messages the report names, needs some, and happens at most once', async () => {
    const d = deps()
    await reviewSessionReport(d, { ...base, outcomes: [{ action: 'hide_messages', targetUserIds: [] }] })
    expect(d.applied).toEqual(['hide:m1', 'decision:reviewed:hide_messages():Looked into it.', 'notify:reviewed:hide_messages'])

    const none = deps({ findReport: async () => ({ ...OPEN_REPORT, messageIds: [] }) })
    await expect(reviewSessionReport(none, { ...base, outcomes: [{ action: 'hide_messages', targetUserIds: [] }] })).rejects.toBeInstanceOf(
      SessionReportInvalidActionError,
    )
    const twice = deps()
    await expect(
      reviewSessionReport(twice, { ...base, outcomes: [{ action: 'hide_messages', targetUserIds: [] }, { action: 'hide_messages', targetUserIds: [] }] }),
    ).rejects.toBeInstanceOf(SessionReportInvalidActionError)
    expect(twice.applied).toEqual([])
  })

  test('a ban needs the permission and a reason category', async () => {
    const d = deps()
    await expect(
      reviewSessionReport(d, { ...base, canBan: false, outcomes: [{ action: 'ban', targetUserIds: ['alice'], banReasonCategory: 'harassment' }] }),
    ).rejects.toBeInstanceOf(SessionReportForbiddenActionError)
    await expect(reviewSessionReport(d, { ...base, outcomes: [{ action: 'ban', targetUserIds: ['alice'] }] })).rejects.toBeInstanceOf(
      SessionReportInvalidActionError,
    )
    expect(d.applied).toEqual([])
  })

  test('a bad second outcome stops the whole decision before the first runs', async () => {
    const d = deps()
    await expect(
      reviewSessionReport(d, {
        ...base,
        outcomes: [
          { action: 'remove_from_session', targetUserIds: ['alice'] },
          { action: 'note', targetUserIds: ['mallory'] },
        ],
      }),
    ).rejects.toBeInstanceOf(SessionReportInvalidActionError)
    expect(d.applied).toEqual([])
  })

  test('member-targeted outcomes need at least one member', async () => {
    const d = deps()
    await expect(reviewSessionReport(d, { ...base, outcomes: [{ action: 'note', targetUserIds: [] }] })).rejects.toBeInstanceOf(
      SessionReportInvalidActionError,
    )
    expect(d.applied).toEqual([])
  })

  test('a dismissed report cannot carry an outcome', async () => {
    const d = deps()
    await expect(
      reviewSessionReport(d, { ...base, status: 'dismissed', outcomes: [{ action: 'note', targetUserIds: ['alice'] }] }),
    ).rejects.toBeInstanceOf(SessionReportInvalidActionError)
    expect(d.applied).toEqual([])
  })
})

describe('submitSessionReport with reported messages', () => {
  const SESSION = 'session-1'
  const REPORTER = 'reporter'
  const ALICE = 'alice'
  const BOB = 'bob'
  const MESSAGE_AUTHORS = new Map([
    ['m-alice', ALICE],
    ['m-bob', BOB],
  ])

  function deps(
    overrides: Partial<SubmitSessionReportDeps> = {},
  ): SubmitSessionReportDeps & { inserted: { aboutUserIds: string[]; messageIds: string[] }[]; notified: string[] } {
    const inserted: { aboutUserIds: string[]; messageIds: string[] }[] = []
    const notified: string[] = []
    return {
      inserted,
      notified,
      isReporterMember: async () => true,
      isAboutUserMember: async () => true,
      findMessageAuthors: async (ids) => new Map(ids.filter((id) => MESSAGE_AUTHORS.has(id)).map((id) => [id, MESSAGE_AUTHORS.get(id)!])),
      insertReport: async (params) => {
        inserted.push({ aboutUserIds: params.aboutUserIds, messageIds: params.messageIds })
      },
      logReport: () => {},
      notifyReporterReceived: async () => {
        notified.push('reporter')
      },
      ...overrides,
    }
  }

  test('a report with no messages behaves as before, and the reporter is acknowledged', async () => {
    const d = deps()
    await submitSessionReport(d, { sessionId: SESSION, reporterUserId: REPORTER, aboutUserIds: [ALICE], messageIds: [], body: 'x' })
    expect(d.inserted).toEqual([{ aboutUserIds: [ALICE], messageIds: [] }])
    expect(d.notified).toEqual(['reporter'])
  })

  test('a refused report acknowledges nobody', async () => {
    const d = deps()
    await expect(
      submitSessionReport(d, { sessionId: SESSION, reporterUserId: REPORTER, aboutUserIds: [ALICE], messageIds: ['m-elsewhere'], body: 'x' }),
    ).rejects.toBeInstanceOf(NotAMemberError)
    expect(d.notified).toEqual([])
  })

  test("the authors of reported messages are always among the report's subjects", async () => {
    const d = deps()
    // The member picked Alice, but also selected one of Bob's messages —
    // Bob is responsible for it, so he's a subject too.
    await submitSessionReport(d, { sessionId: SESSION, reporterUserId: REPORTER, aboutUserIds: [ALICE], messageIds: ['m-bob'], body: 'x' })
    expect(d.inserted[0]?.aboutUserIds.sort()).toEqual([ALICE, BOB].sort())
    expect(d.inserted[0]?.messageIds).toEqual(['m-bob'])
  })

  test('a reported message that is not in this session is refused', async () => {
    const d = deps()
    await expect(
      submitSessionReport(d, { sessionId: SESSION, reporterUserId: REPORTER, aboutUserIds: [ALICE], messageIds: ['m-elsewhere'], body: 'x' }),
    ).rejects.toBeInstanceOf(NotAMemberError)
    expect(d.inserted).toEqual([])
  })

  test('messages alone are enough — subjects can be derived entirely from them', async () => {
    const d = deps()
    await submitSessionReport(d, { sessionId: SESSION, reporterUserId: REPORTER, aboutUserIds: [], messageIds: ['m-alice', 'm-bob'], body: 'x' })
    expect(d.inserted[0]?.aboutUserIds.sort()).toEqual([ALICE, BOB].sort())
  })
})
