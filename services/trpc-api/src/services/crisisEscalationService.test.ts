import { describe, expect, test } from 'bun:test'
import { buildCrisisResource, escalate } from './crisisEscalationService'

const params = { sessionId: 's1', userId: 'p1' }

describe('buildCrisisResource', () => {
  test('is deterministic and non-empty', () => {
    expect(buildCrisisResource()).toEqual(buildCrisisResource())
    expect(buildCrisisResource().resources.length).toBeGreaterThan(0)
  })
})

describe('escalate', () => {
  test('logs, persists, and returns the resource card on the happy path', async () => {
    const events: string[] = []

    const resource = await escalate(
      {
        recordCrisisMessage: async () => {
          events.push('persisted')
        },
        logEscalation: () => events.push('logged'),
        logCriticalFailure: () => events.push('critical'),
      },
      params,
    )

    expect(events).toEqual(['logged', 'persisted'])
    expect(resource).toEqual(buildCrisisResource())
  })

  test('still returns the resource card when persistence fails — the guarantee this module exists for', async () => {
    let criticalLogged = false

    const resource = await escalate(
      {
        recordCrisisMessage: async () => {
          throw new Error('db unavailable')
        },
        logEscalation: () => {},
        logCriticalFailure: () => {
          criticalLogged = true
        },
      },
      params,
    )

    expect(resource).toEqual(buildCrisisResource())
    expect(criticalLogged).toBe(true)
  })
})
