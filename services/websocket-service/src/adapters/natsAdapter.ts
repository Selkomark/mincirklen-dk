import { presenceSubject, roomSubject } from '@mincirklen/shared'
import type { NatsConnection } from 'nats'

export interface RoomSubscription {
  messages: AsyncIterable<string>
  unsubscribe: () => void
}

function subscribeToSubject(nc: NatsConnection, subject: string): RoomSubscription {
  const sub = nc.subscribe(subject)

  async function* iterate(): AsyncIterable<string> {
    for await (const msg of sub) {
      yield msg.string()
    }
  }

  return { messages: iterate(), unsubscribe: () => sub.unsubscribe() }
}

export function subscribeToRoom(nc: NatsConnection, sessionId: string): RoomSubscription {
  return subscribeToSubject(nc, roomSubject(sessionId))
}

// Moved here from trpc-api's now-deleted adapters/natsAdapter.ts — trpc-api
// no longer touches NATS directly, it calls rpcServer.ts's publishMessage
// RPC instead, which calls this.
export function publishMessage(nc: NatsConnection, sessionId: string, payload: unknown): void {
  nc.publish(roomSubject(sessionId), JSON.stringify(payload))
}

// Cross-pod fanout for roster/turn/join events — see
// packages/shared/src/nats/subjects.ts's presenceSubject comment for why
// this is a separate subject from chat messages.
export function subscribeToPresence(nc: NatsConnection, sessionId: string): RoomSubscription {
  return subscribeToSubject(nc, presenceSubject(sessionId))
}

// Called from rpcServer.ts's turn/roster RPCs (join, advance) once their
// Redis-side mutation has succeeded — never from trpc-api, which has no
// NATS access at all.
export function publishPresenceEvent(nc: NatsConnection, sessionId: string, payload: unknown): void {
  nc.publish(presenceSubject(sessionId), JSON.stringify(payload))
}
