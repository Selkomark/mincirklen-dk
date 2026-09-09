import { describe, expect, test } from 'bun:test'
import { computeTransparencyMetrics } from './moderationTransparencyService'

describe('computeTransparencyMetrics', () => {
  test('returns null rates when there is no data yet', () => {
    const metrics = computeTransparencyMetrics({
      truePositive: 0,
      falsePositive: 0,
      trueNegative: 0,
      falseNegative: 0,
    })
    expect(metrics).toEqual({ falsePositiveRate: null, falseNegativeRate: null, incidentsReviewed: 0 })
  })

  test('computes falsePositiveRate from flagged events only', () => {
    const metrics = computeTransparencyMetrics({
      truePositive: 3,
      falsePositive: 1,
      trueNegative: 0,
      falseNegative: 0,
    })
    expect(metrics.falsePositiveRate).toBe(0.25)
    expect(metrics.falseNegativeRate).toBeNull()
    expect(metrics.incidentsReviewed).toBe(4)
  })

  test('computes falseNegativeRate from passed events only', () => {
    const metrics = computeTransparencyMetrics({
      truePositive: 0,
      falsePositive: 0,
      trueNegative: 9,
      falseNegative: 1,
    })
    expect(metrics.falseNegativeRate).toBe(0.1)
    expect(metrics.falsePositiveRate).toBeNull()
    expect(metrics.incidentsReviewed).toBe(10)
  })
})
