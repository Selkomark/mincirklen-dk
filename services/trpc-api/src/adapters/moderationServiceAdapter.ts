import { createClient, type Client, type Interceptor } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-node'
import { ModerationService } from '@mincirklen/proto'
import { classificationSchema, type Classification } from '@mincirklen/shared'

export async function checkModerationServiceHealth(baseUrl: string): Promise<void> {
  const res = await fetch(`${baseUrl}/health`)
  if (!res.ok) {
    throw new Error(`status ${res.status}`)
  }
}

// Explicit constructor: see the same note in repositories/sessionRepository.ts.
export class ModerationServiceError extends Error {
  constructor(message: string) {
    super(message)
  }
}

// One Connect client per distinct baseUrl — same rationale as
// websocketServiceAdapter.ts's clientFor.
const clients = new Map<string, Client<typeof ModerationService>>()

function clientFor(baseUrl: string, internalServiceSecret: string): Client<typeof ModerationService> {
  const existing = clients.get(baseUrl)
  if (existing) return existing

  // Same secret header moderation-service's rpcServer.ts guard expects —
  // see that file's comment for why the guard exists even though this
  // service also has no public ingress at all.
  const authInterceptor: Interceptor = (next) => (req) => {
    req.header.set('x-internal-secret', internalServiceSecret)
    return next(req)
  }

  const client = createClient(
    ModerationService,
    createConnectTransport({ httpVersion: '1.1', baseUrl, interceptors: [authInterceptor] }),
  )
  clients.set(baseUrl, client)
  return client
}

// Fail closed: an RPC failure (network, auth, anything thrown by the
// server) or a result that doesn't parse as a known Classification both
// throw rather than resolving to something that could be mistaken for a
// "pass" — the caller must treat a thrown error as blocking, never as an
// implicit pass-through.
export async function classifyMessage(
  baseUrl: string,
  internalServiceSecret: string,
  params: { sessionId: string; message: string },
): Promise<Classification> {
  let result: string
  try {
    const res = await clientFor(baseUrl, internalServiceSecret).classify({
      sessionId: params.sessionId,
      message: params.message,
    })
    result = res.result
  } catch (err) {
    throw new ModerationServiceError(err instanceof Error ? err.message : String(err))
  }

  const parsed = classificationSchema.safeParse(result)
  if (!parsed.success) {
    throw new ModerationServiceError('moderation service returned an unrecognized classification')
  }

  return parsed.data
}
