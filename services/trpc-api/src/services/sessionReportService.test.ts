import { describe, expect, test } from 'bun:test'
import {
  reviewSessionReport,
  SessionReportAlreadyResolvedError,
  SessionReportNotFoundError,
  type ReviewSessionReportDeps,
} from './sessionReportService'

function deps(overrides: Partial<ReviewSessionReportDeps> = {}): ReviewSessionReportDeps & { applied: string[] } {
  const applied: string[] = []
  return {
    applied,
    findReport: async () => ({ status: 'open' as const }),
    applyDecision: async (status) => {
      applied.push(status)
    },
    ...overrides,
  }
}

describe('reviewSessionReport', () => {
  test('marks an open report reviewed', async () => {
    const d = deps()
    await reviewSessionReport(d, { status: 'reviewed' })
    expect(d.applied).toEqual(['reviewed'])
  })

  test('marks an open report dismissed', async () => {
    const d = deps()
    await reviewSessionReport(d, { status: 'dismissed' })
    expect(d.applied).toEqual(['dismissed'])
  })

  test('rejects an unknown report without touching storage', async () => {
    const d = deps({ findReport: async () => null })
    await expect(reviewSessionReport(d, { status: 'reviewed' })).rejects.toBeInstanceOf(SessionReportNotFoundError)
    expect(d.applied).toEqual([])
  })

  test.each(['reviewed', 'dismissed'] as const)('refuses to re-decide a report already %s', async (existing) => {
    const d = deps({ findReport: async () => ({ status: existing }) })
    await expect(reviewSessionReport(d, { status: 'dismissed' })).rejects.toBeInstanceOf(SessionReportAlreadyResolvedError)
    expect(d.applied).toEqual([])
  })
})
