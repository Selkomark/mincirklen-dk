import { describe, expect, test } from 'bun:test'
import { ExportNotFoundError, ExportNotReadyError, createExportDownloadToken } from './exportDownloadService'

describe('createExportDownloadToken', () => {
  test('rejects a request that does not exist', async () => {
    await expect(
      createExportDownloadToken({
        findRequest: async () => null,
        signToken: () => {
          throw new Error('should not sign a token for a nonexistent request')
        },
      }),
    ).rejects.toBeInstanceOf(ExportNotFoundError)
  })

  test('rejects a request that is not ready yet', async () => {
    for (const status of ['pending', 'processing', 'failed', 'expired']) {
      await expect(
        createExportDownloadToken({
          findRequest: async () => ({ status, storageKey: null }),
          signToken: () => {
            throw new Error('should not sign a token for a not-ready request')
          },
        }),
      ).rejects.toBeInstanceOf(ExportNotReadyError)
    }
  })

  test('rejects a "ready" request with no storage key (defensive — should never happen)', async () => {
    await expect(
      createExportDownloadToken({
        findRequest: async () => ({ status: 'ready', storageKey: null }),
        signToken: () => {
          throw new Error('should not sign a token with no object to serve')
        },
      }),
    ).rejects.toBeInstanceOf(ExportNotReadyError)
  })

  test('signs and returns a token for a ready request', async () => {
    const token = await createExportDownloadToken({
      findRequest: async () => ({ status: 'ready', storageKey: 'exports/req-1.json' }),
      signToken: () => 'signed-token',
    })
    expect(token).toBe('signed-token')
  })
})
