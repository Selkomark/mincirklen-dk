import * as http from 'node:http'
import { afterEach, describe, expect, test } from 'bun:test'
import { Code, ConnectError, type HandlerContext } from '@connectrpc/connect'
import { connectNodeAdapter } from '@connectrpc/connect-node'
import { ModerationService, type ClassifyRequest } from '@mincirklen/proto'
import { ModerationServiceError, checkModerationServiceHealth, classifyMessage } from './moderationServiceAdapter'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

// A real (but ephemeral, in-process) Connect server per test, standing in
// for moderation-service's rpcServer.ts — same rationale as
// websocketServiceAdapter.test.ts's identical helper: the adapter always
// builds a real createConnectTransport, which talks over node:http/https
// directly rather than global fetch, so mocking globalThis.fetch can't
// intercept these calls.
interface FakeImpl {
  classify?: (req: ClassifyRequest, ctx: HandlerContext) => Promise<{ result: string }>
}

function notImplemented(): never {
  throw new ConnectError('not implemented in this fake', Code.Unimplemented)
}

async function withFakeServer(impl: FakeImpl, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const handler = connectNodeAdapter({
    routes: (router) =>
      router.service(ModerationService, {
        classify: impl.classify ?? notImplemented,
      }),
  })
  const server = http.createServer(handler)
  const baseUrl = await new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      resolve(`http://127.0.0.1:${port}`)
    })
  })
  try {
    await run(baseUrl)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('ModerationServiceError', () => {
  test('is a real Error subclass', () => {
    const err = new ModerationServiceError('boom')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('boom')
  })
})

describe('checkModerationServiceHealth', () => {
  test('resolves when the health endpoint responds ok', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch
    await expect(checkModerationServiceHealth('http://moderation.invalid')).resolves.toBeUndefined()
  })

  test('throws with the status code when the response is not ok', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 503 })) as unknown as typeof fetch
    await expect(checkModerationServiceHealth('http://moderation.invalid')).rejects.toThrow('status 503')
  })
})

describe('classifyMessage', () => {
  const params = { sessionId: '11111111-1111-1111-1111-111111111111', message: 'hi' }

  test.each(['pass', 'flag', 'crisis'] as const)('resolves "%s" from a valid response', async (result) => {
    await withFakeServer({ classify: async () => ({ result }) }, async (baseUrl) => {
      await expect(classifyMessage(baseUrl, 'secret', params)).resolves.toBe(result)
    })
  })

  test('throws when the RPC fails', async () => {
    await withFakeServer(
      { classify: async () => { throw new ConnectError('unavailable', Code.Unavailable) } },
      async (baseUrl) => {
        await expect(classifyMessage(baseUrl, 'secret', params)).rejects.toThrow(ModerationServiceError)
      },
    )
  })

  test('throws when the classification is not one of the known values', async () => {
    await withFakeServer({ classify: async () => ({ result: 'maybe' }) }, async (baseUrl) => {
      await expect(classifyMessage(baseUrl, 'secret', params)).rejects.toThrow('unrecognized classification')
    })
  })

  test('throws on a network failure', async () => {
    // No server listening at this port at all — a real connection refusal,
    // not a fake implementation throwing.
    await expect(classifyMessage('http://127.0.0.1:1', 'secret', params)).rejects.toThrow(ModerationServiceError)
  })
})
