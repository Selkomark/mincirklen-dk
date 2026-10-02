import { describe, expect, test } from 'bun:test'
import { NotAMemberError } from './messageService'
import {
  reviewSessionReport,
  submitSessionReport,
  type SubmitSessionReportDeps,
  SessionReportAlreadyResolvedError,
  SessionReportNoteRequiredError,
  SessionReportNotFoundError,
  type ReviewSessionReportDeps,
} from './sessionReportService'

function deps(overrides: Partial<ReviewSessionReportDeps> = {}): ReviewSessionReportDeps & { applied: string[] } {
  const applied: string[] = []
  return {
    applied,
    findReport: async () => ({ status: 'open' as const }),
    applyDecision: async (status, note) => {
      applied.push(`${status}:${note}`)
    },
    ...overrides,
  }
}

describe('reviewSessionReport', () => {
  test('marks an open report reviewed', async () => {
    const d = deps()
    await reviewSessionReport(d, { status: 'reviewed', note: 'Spoke to both members.' })
    expect(d.applied).toEqual(['reviewed:Spoke to both members.'])
  })

  test('marks an open report dismissed', async () => {
    const d = deps()
    await reviewSessionReport(d, { status: 'dismissed', note: 'Nothing in the transcript supports it.' })
    expect(d.applied).toEqual(['dismissed:Nothing in the transcript supports it.'])
  })

  test('rejects an unknown report without touching storage', async () => {
    const d = deps({ findReport: async () => null })
    await expect(reviewSessionReport(d, { status: 'reviewed', note: 'x' })).rejects.toBeInstanceOf(SessionReportNotFoundError)
    expect(d.applied).toEqual([])
  })

  test('refuses a decision without a note — the reasoning is the record', async () => {
    const d = deps()
    await expect(reviewSessionReport(d, { status: 'reviewed', note: '   ' })).rejects.toBeInstanceOf(SessionReportNoteRequiredError)
    expect(d.applied).toEqual([])
  })

  test.each(['reviewed', 'dismissed'] as const)('refuses to re-decide a report already %s', async (existing) => {
    const d = deps({ findReport: async () => ({ status: existing }) })
    await expect(reviewSessionReport(d, { status: 'dismissed', note: 'x' })).rejects.toBeInstanceOf(SessionReportAlreadyResolvedError)
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

  function deps(overrides: Partial<SubmitSessionReportDeps> = {}): SubmitSessionReportDeps & { inserted: { aboutUserIds: string[]; messageIds: string[] }[] } {
    const inserted: { aboutUserIds: string[]; messageIds: string[] }[] = []
    return {
      inserted,
      isReporterMember: async () => true,
      isAboutUserMember: async () => true,
      findMessageAuthors: async (ids) => new Map(ids.filter((id) => MESSAGE_AUTHORS.has(id)).map((id) => [id, MESSAGE_AUTHORS.get(id)!])),
      insertReport: async (params) => {
        inserted.push({ aboutUserIds: params.aboutUserIds, messageIds: params.messageIds })
      },
      logReport: () => {},
      ...overrides,
    }
  }

  test('a report with no messages behaves as before', async () => {
    const d = deps()
    await submitSessionReport(d, { sessionId: SESSION, reporterUserId: REPORTER, aboutUserIds: [ALICE], messageIds: [], body: 'x' })
    expect(d.inserted).toEqual([{ aboutUserIds: [ALICE], messageIds: [] }])
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
