import { describe, expect, test } from 'bun:test'
import { GATE_REGISTRY, isKnownGateKey } from './registry'

describe('isKnownGateKey', () => {
  test('accepts a registered key', () => {
    expect(isKnownGateKey('platform_launch')).toBe(true)
  })

  test('rejects an unregistered key', () => {
    expect(isKnownGateKey('not_a_real_gate')).toBe(false)
  })

  test('every registry entry has a non-empty name and description', () => {
    for (const definition of Object.values(GATE_REGISTRY)) {
      expect(definition.name.length).toBeGreaterThan(0)
      expect(definition.description.length).toBeGreaterThan(0)
    }
  })
})
