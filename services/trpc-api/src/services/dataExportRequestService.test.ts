import { describe, expect, test } from 'bun:test'
import { getDataExportStatus, requestDataExport } from './dataExportRequestService'

describe('requestDataExport', () => {
  test('publishes before inserting, with the same generated id', async () => {
    const published: { requestId: string | null } = { requestId: null }

    const result = await requestDataExport({
      generateId: () => 'req-1',
      insertRequest: async (id) => ({ id }),
      publish: async (requestId) => {
        published.requestId = requestId
      },
    })

    expect(result).toEqual({ id: 'req-1' })
    expect(published.requestId).toBe('req-1')
  })

  test('never inserts a row if publish fails, so nothing is left stuck at pending', async () => {
    let inserted = false

    const attempt = requestDataExport({
      generateId: () => 'req-1',
      insertRequest: async (id) => {
        inserted = true
        return { id }
      },
      publish: async () => {
        throw new Error('pubsub publish to data-export-requests failed: status 404')
      },
    })

    await expect(attempt).rejects.toThrow('pubsub publish to data-export-requests failed: status 404')
    expect(inserted).toBe(false)
  })
})

describe('getDataExportStatus', () => {
  test('maps each request without ever exposing storage_key', async () => {
    const result = await getDataExportStatus({
      findRequests: async () => [
        { id: 'req-1', status: 'ready', requestedAt: new Date('2026-01-01T00:00:00Z'), expiresAt: new Date('2026-01-16T00:00:00Z') },
        { id: 'req-2', status: 'pending', requestedAt: new Date('2026-01-02T00:00:00Z'), expiresAt: null },
      ],
    })

    expect(result).toEqual([
      { id: 'req-1', status: 'ready', requestedAt: new Date('2026-01-01T00:00:00Z'), expiresAt: new Date('2026-01-16T00:00:00Z') },
      { id: 'req-2', status: 'pending', requestedAt: new Date('2026-01-02T00:00:00Z'), expiresAt: null },
    ])
    expect(result[0]).not.toHaveProperty('storageKey')
    expect(result[0]).not.toHaveProperty('downloadUrl')
  })
})
