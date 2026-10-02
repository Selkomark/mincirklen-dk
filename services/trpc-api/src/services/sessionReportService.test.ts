import { describe, expect, test } from 'bun:test'
import {
  reviewSessionReport,
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
