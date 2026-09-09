export interface RelayAuthDeps {
  isSessionMember(): Promise<boolean>
}

export async function isAuthorizedToJoinRoom(deps: RelayAuthDeps): Promise<boolean> {
  return deps.isSessionMember()
}

// Framework-agnostic: `messages` is an already-normalized async iterable of
// strings (the Adapter's job is turning NATS `Msg`s into plain strings —
// see adapters/natsAdapter.ts) and `send` is a plain callback, never a
// Hono/WSContext type. Runs for the lifetime of the subscription; the
// controller is responsible for ending that lifetime (via the adapter's
// `unsubscribe`) when the socket closes.
export async function relayMessages(messages: AsyncIterable<string>, send: (data: string) => void): Promise<void> {
  for await (const message of messages) {
    send(message)
  }
}

export interface PublishDeps {
  publish(payload: unknown): void
}

// Called from rpcServer.ts's publishMessage RPC — trpc-api's only path
// to fan a message out, now that it no longer talks to NATS directly.
export function publishToRoom(deps: PublishDeps, payload: unknown): void {
  deps.publish(payload)
}
