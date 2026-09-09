import type { ModerationOutcomeCounts } from '../repositories/moderationEventRepository'

export interface TransparencyMetrics {
  falsePositiveRate: number | null
  falseNegativeRate: number | null
  incidentsReviewed: number
}

// Pure function, unit-testable without a DB — mirrors
// sessionReportService.ts's own style. `null` when a rate's denominator is
// 0, so ModerationTransparencyPage.tsx can render "—" rather than a
// misleading 0%. Note: falseNegativeRate has no data path to populate yet
// (the review queue only ever surfaces flag/crisis events, never a `pass`
// a human suspects should have been flagged) — it will correctly keep
// reading as null/"—" until a future pass adds one (session_reports or a
// "review a pass" flow).
export function computeTransparencyMetrics(counts: ModerationOutcomeCounts): TransparencyMetrics {
  const flaggedTotal = counts.truePositive + counts.falsePositive
  const passedTotal = counts.trueNegative + counts.falseNegative

  return {
    falsePositiveRate: flaggedTotal > 0 ? counts.falsePositive / flaggedTotal : null,
    falseNegativeRate: passedTotal > 0 ? counts.falseNegative / passedTotal : null,
    incidentsReviewed: counts.truePositive + counts.falsePositive + counts.trueNegative + counts.falseNegative,
  }
}
