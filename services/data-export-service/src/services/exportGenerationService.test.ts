import { describe, expect, test } from 'bun:test'
import { generateExport, markExportFailedFromDeadLetter } from './exportGenerationService'

function baseDeps(overrides: Partial<Parameters<typeof generateExport>[0]> = {}) {
  const calls: { markProcessing: boolean; markReady: unknown; uploaded: string | null } = {
    markProcessing: false,
    markReady: null,
    uploaded: null,
  }

  return {
    calls,
    deps: {
      findRequest: async () => ({ id: 'req-1', userId: 'user-1', status: 'pending' }),
      markProcessing: async () => {
        calls.markProcessing = true
      },
      markReady: async (params: { objectKey: string; expiresAt: Date }) => {
        calls.markReady = params
      },
      collectData: async () => ({ hello: 'world' }),
      upload: async (jsonBody: string) => {
        calls.uploaded = jsonBody
      },
      objectKey: 'exports/req-1.json',
      now: () => new Date('2026-01-01T00:00:00Z'),
      retentionTtlMs: 48 * 60 * 60 * 1000,
      ...overrides,
    },
  }
}

describe('generateExport', () => {
  test('no-ops when the request does not exist', async () => {
    const { calls, deps } = baseDeps({ findRequest: async () => null })
    await generateExport(deps)
    expect(calls.markProcessing).toBe(false)
  })

  test('no-ops when the request already concluded (ready/failed/expired)', async () => {
    for (const status of ['ready', 'failed', 'expired']) {
      const { calls, deps } = baseDeps({ findRequest: async () => ({ id: 'req-1', userId: 'user-1', status }) })
      await generateExport(deps)
      expect(calls.markProcessing).toBe(false)
    }
  })

  test('happy path: marks processing, uploads, and marks ready with the object key and ttl-derived expiry', async () => {
    const { calls, deps } = baseDeps()
    await generateExport(deps)

    expect(calls.markProcessing).toBe(true)
    expect(calls.uploaded).toBe(JSON.stringify({ hello: 'world' }, null, 2))
    expect(calls.markReady).toEqual({
      objectKey: 'exports/req-1.json',
      expiresAt: new Date('2026-01-03T00:00:00Z'),
    })
  })

  test('propagates an upload failure without marking ready', async () => {
    const { calls, deps } = baseDeps({
      upload: async () => {
        throw new Error('gcs is down')
      },
    })

    await expect(generateExport(deps)).rejects.toThrow('gcs is down')
    expect(calls.markReady).toBeNull()
  })
})

describe('markExportFailedFromDeadLetter', () => {
  test('delegates to markFailed', async () => {
    let called = false
    await markExportFailedFromDeadLetter({
      markFailed: async () => {
        called = true
      },
    })
    expect(called).toBe(true)
  })
})
