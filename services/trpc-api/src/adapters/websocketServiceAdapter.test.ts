import * as http from 'node:http'
import { afterEach, describe, expect, test } from 'bun:test'
import { Code, ConnectError, type HandlerContext } from '@connectrpc/connect'
import { connectNodeAdapter } from '@connectrpc/connect-node'
import { InternalService, type PublishMessageRequest, type GetTurnStateRequest, type JoinRosterRequest, type ClaimTurnRequest, type ReleaseTurnClaimRequest, type AdvanceTurnRequest, type NotifyProfileUpdatedRequest } from '@mincirklen/proto'
import type { MessageRow } from '../repositories/messageRepository'
import { NotYourTurnError, SessionNotFoundError, TurnAlreadyClaimedError } from '../repositories/sessionRepository'
import {
  WebsocketServiceError,
  advanceTurn,
  checkWebsocketServiceHealth,
  claimTurn,
  getTurnState,
  notifyJoined,
  publishMessage,
  releaseTurnClaim,
} from './websocketServiceAdapter'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

// A real (but ephemeral, in-process) Connect server per test, standing in
// for websocket-service's rpcServer.ts — the adapter always builds a real
// createConnectTransport pointed at a baseUrl (see clientFor), which
// talks over node:http/https directly rather than global fetch, so
// mocking globalThis.fetch (this file's old approach) can no longer
// intercept these calls. Each test supplies just the method(s) it cares
// about; everything else 501s if accidentally invoked.
interface FakeImpl {
  publishMessage?: (req: PublishMessageRequest, ctx: HandlerContext) => Promise<Record<string, never>>
  getTurnState?: (
    req: GetTurnStateRequest,
    ctx: HandlerContext,
  ) => Promise<{ currentTurnUserId: string; roster: { userId: string; turnOrder: number }[]; onlineUserIds: string[] }>
  joinRoster?: (req: JoinRosterRequest, ctx: HandlerContext) => Promise<Record<string, never>>
  notifyProfileUpdated?: (req: NotifyProfileUpdatedRequest, ctx: HandlerContext) => Promise<Record<string, never>>
  claimTurn?: (req: ClaimTurnRequest, ctx: HandlerContext) => Promise<Record<string, never>>
  releaseTurnClaim?: (req: ReleaseTurnClaimRequest, ctx: HandlerContext) => Promise<Record<string, never>>
  advanceTurn?: (req: AdvanceTurnRequest, ctx: HandlerContext) => Promise<{ nextTurnUserId: string }>
}

function notImplemented(): never {
  throw new ConnectError('not implemented in this fake', Code.Unimplemented)
}

async function withFakeServer(impl: FakeImpl, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const handler = connectNodeAdapter({
    routes: (router) =>
      router.service(InternalService, {
        publishMessage: impl.publishMessage ?? notImplemented,
        getTurnState: impl.getTurnState ?? notImplemented,
        joinRoster: impl.joinRoster ?? notImplemented,
        notifyProfileUpdated: impl.notifyProfileUpdated ?? notImplemented,
        claimTurn: impl.claimTurn ?? notImplemented,
        releaseTurnClaim: impl.releaseTurnClaim ?? notImplemented,
        advanceTurn: impl.advanceTurn ?? notImplemented,
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

describe('WebsocketServiceError', () => {
  test('is a real Error subclass', () => {
    const err = new WebsocketServiceError('boom')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('boom')
  })
})

describe('checkWebsocketServiceHealth', () => {
  test('resolves when the health endpoint responds ok', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch
    await expect(checkWebsocketServiceHealth('http://websocket.invalid')).resolves.toBeUndefined()
  })

  test('throws with the status code when the response is not ok', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 503 })) as unknown as typeof fetch
    await expect(checkWebsocketServiceHealth('http://websocket.invalid')).rejects.toThrow('status 503')
  })
})

describe('publishMessage', () => {
  const message: MessageRow = {
    id: '11111111-1111-1111-1111-111111111111',
    sessionId: '22222222-2222-2222-2222-222222222222',
    userId: '33333333-3333-3333-3333-333333333333',
    body: 'hi',
    type: 'user',
    moderationStatus: 'pass',
    falsePositiveReportedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  }

  test('calls the RPC with the internal secret header and the message fields', async () => {
    let captured: PublishMessageRequest | undefined
    let capturedSecret: string | null | undefined

    await withFakeServer(
      {
        publishMessage: async (req, ctx) => {
          captured = req
          capturedSecret = ctx.requestHeader.get('x-internal-secret')
          return {}
        },
      },
      async (baseUrl) => {
        await publishMessage(baseUrl, 'shh-secret', message.sessionId, message)
      },
    )

    expect(capturedSecret).toBe('shh-secret')
    expect(captured).toMatchObject({
      sessionId: message.sessionId,
      messageId: message.id,
      userId: message.userId,
      body: message.body,
      type: message.type,
      createdAt: message.createdAt.toISOString(),
    })
  })

  test('throws WebsocketServiceError when the RPC fails', async () => {
    await expect(
      withFakeServer({ publishMessage: notImplemented }, async (baseUrl) => {
        await publishMessage(baseUrl, 'shh-secret', message.sessionId, message)
      }),
    ).rejects.toThrow(WebsocketServiceError)
  })

  test('throws on a network failure (nothing listening)', async () => {
    await expect(publishMessage('http://127.0.0.1:1', 'shh-secret', message.sessionId, message)).rejects.toThrow(WebsocketServiceError)
  })
})

const SESSION_ID = '22222222-2222-2222-2222-222222222222'

describe('getTurnState', () => {
  test('calls the RPC and returns the parsed state, translating empty-string to null', async () => {
    let capturedSecret: string | null | undefined

    let state: Awaited<ReturnType<typeof getTurnState>> | undefined
    await withFakeServer(
      {
        getTurnState: async (req, ctx) => {
          capturedSecret = ctx.requestHeader.get('x-internal-secret')
          expect(req.sessionId).toBe(SESSION_ID)
          return { currentTurnUserId: 'alice', roster: [{ userId: 'alice', turnOrder: 0 }], onlineUserIds: ['alice'] }
        },
      },
      async (baseUrl) => {
        state = await getTurnState(baseUrl, 'shh-secret', SESSION_ID)
      },
    )

    expect(capturedSecret).toBe('shh-secret')
    expect(state).toEqual({ currentTurnUserId: 'alice', roster: [{ userId: 'alice', turnOrder: 0 }], onlineUserIds: ['alice'] })
  })

  test('translates an empty currentTurnUserId to null', async () => {
    let state: Awaited<ReturnType<typeof getTurnState>> | undefined
    await withFakeServer(
      { getTurnState: async () => ({ currentTurnUserId: '', roster: [], onlineUserIds: [] }) },
      async (baseUrl) => {
        state = await getTurnState(baseUrl, 'shh-secret', SESSION_ID)
      },
    )
    expect(state?.currentTurnUserId).toBeNull()
  })

  test('maps Code.NotFound to SessionNotFoundError', async () => {
    await expect(
      withFakeServer(
        {
          getTurnState: async () => {
            throw new ConnectError('nope', Code.NotFound)
          },
        },
        async (baseUrl) => {
          await getTurnState(baseUrl, 'shh-secret', SESSION_ID)
        },
      ),
    ).rejects.toThrow(SessionNotFoundError)
  })

  test('throws WebsocketServiceError for anything else unrecognized', async () => {
    await expect(
      withFakeServer(
        {
          getTurnState: async () => {
            throw new ConnectError('boom', Code.Internal)
          },
        },
        async (baseUrl) => {
          await getTurnState(baseUrl, 'shh-secret', SESSION_ID)
        },
      ),
    ).rejects.toThrow(WebsocketServiceError)
  })
})

describe('notifyJoined', () => {
  test('calls joinRoster with the new member', async () => {
    let captured: JoinRosterRequest | undefined
    await withFakeServer(
      {
        joinRoster: async (req) => {
          captured = req
          return {}
        },
      },
      async (baseUrl) => {
        await notifyJoined(baseUrl, 'shh-secret', SESSION_ID, 'alice', 0)
      },
    )
    expect(captured).toMatchObject({ sessionId: SESSION_ID, userId: 'alice', turnOrder: 0 })
  })

  test('maps Code.NotFound to SessionNotFoundError', async () => {
    await expect(
      withFakeServer(
        {
          joinRoster: async () => {
            throw new ConnectError('nope', Code.NotFound)
          },
        },
        async (baseUrl) => {
          await notifyJoined(baseUrl, 'shh-secret', SESSION_ID, 'alice', 0)
        },
      ),
    ).rejects.toThrow(SessionNotFoundError)
  })
})

describe('claimTurn', () => {
  test('calls the claim RPC', async () => {
    let captured: ClaimTurnRequest | undefined
    await withFakeServer(
      {
        claimTurn: async (req) => {
          captured = req
          return {}
        },
      },
      async (baseUrl) => {
        await claimTurn(baseUrl, 'shh-secret', SESSION_ID, 'alice')
      },
    )
    expect(captured).toMatchObject({ sessionId: SESSION_ID, userId: 'alice' })
  })

  test('maps Code.PermissionDenied to NotYourTurnError', async () => {
    await expect(
      withFakeServer(
        {
          claimTurn: async () => {
            throw new ConnectError('nope', Code.PermissionDenied)
          },
        },
        async (baseUrl) => {
          await claimTurn(baseUrl, 'shh-secret', SESSION_ID, 'alice')
        },
      ),
    ).rejects.toThrow(NotYourTurnError)
  })

  test('maps Code.AlreadyExists to TurnAlreadyClaimedError', async () => {
    await expect(
      withFakeServer(
        {
          claimTurn: async () => {
            throw new ConnectError('nope', Code.AlreadyExists)
          },
        },
        async (baseUrl) => {
          await claimTurn(baseUrl, 'shh-secret', SESSION_ID, 'alice')
        },
      ),
    ).rejects.toThrow(TurnAlreadyClaimedError)
  })

  test('maps Code.NotFound to SessionNotFoundError', async () => {
    await expect(
      withFakeServer(
        {
          claimTurn: async () => {
            throw new ConnectError('nope', Code.NotFound)
          },
        },
        async (baseUrl) => {
          await claimTurn(baseUrl, 'shh-secret', SESSION_ID, 'alice')
        },
      ),
    ).rejects.toThrow(SessionNotFoundError)
  })
})

describe('releaseTurnClaim', () => {
  test('calls the release RPC', async () => {
    let captured: ReleaseTurnClaimRequest | undefined
    await withFakeServer(
      {
        releaseTurnClaim: async (req) => {
          captured = req
          return {}
        },
      },
      async (baseUrl) => {
        await releaseTurnClaim(baseUrl, 'shh-secret', SESSION_ID)
      },
    )
    expect(captured?.sessionId).toBe(SESSION_ID)
  })
})

describe('advanceTurn', () => {
  test('calls the advance RPC and discards the response body', async () => {
    let captured: AdvanceTurnRequest | undefined
    await withFakeServer(
      {
        advanceTurn: async (req) => {
          captured = req
          return { nextTurnUserId: 'bob' }
        },
      },
      async (baseUrl) => {
        await advanceTurn(baseUrl, 'shh-secret', SESSION_ID)
      },
    )
    expect(captured?.sessionId).toBe(SESSION_ID)
  })

  test('maps Code.NotFound to SessionNotFoundError', async () => {
    await expect(
      withFakeServer(
        {
          advanceTurn: async () => {
            throw new ConnectError('nope', Code.NotFound)
          },
        },
        async (baseUrl) => {
          await advanceTurn(baseUrl, 'shh-secret', SESSION_ID)
        },
      ),
    ).rejects.toThrow(SessionNotFoundError)
  })
})
