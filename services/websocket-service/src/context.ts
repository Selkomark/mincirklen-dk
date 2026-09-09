import type { Database } from '@mincirklen/shared'
import { verifySessionToken } from '@mincirklen/shared'
import { getCookie } from 'hono/cookie'
import type { Context as HonoContext } from 'hono'
import type { Kysely } from 'kysely'
import type { NatsConnection } from 'nats'
import type { Redis } from 'ioredis'
import type { WireFormat } from './services/wireFormat'

export const SESSION_COOKIE_NAME = 'mc_session'

export interface AppEnv {
  db: Kysely<Database>
  nats: NatsConnection
  // This service's own shared memory for live round/roster state (Stage 2
  // of the websocket-owned-turn-state redesign) — see
  // adapters/redisTurnStateAdapter.ts. Never touched by trpc-api directly.
  redis: Redis
  authSecret: string
  // WebSocket handshakes aren't covered by CORS/SOP the way `fetch` is —
  // SameSite=Lax on mc_session already blocks a cross-site page's
  // JS-initiated handshake in modern browsers, but that shouldn't be the
  // only guarantee. Empty list means "no restriction" (local dev default).
  allowedOrigins: string[]
  // Shared secret trpc-api presents on every internal RPC call (see
  // rpcServer.ts) — this service is publicly routable (unlike
  // moderation-service), so that surface needs its own auth rather than
  // relying on network isolation.
  internalServiceSecret: string
  // Negotiated per-connection via wsController.ts's `hello` frame — see
  // services/wireFormat.ts. One env-var-controlled setting for the whole
  // service, not per-connection-configurable.
  wireFormat: WireFormat
}

// Pure — no DB touch on connect (unlike trpc-api's context, which does a
// last_seen_at touch on every request). Deliberately out of scope for this
// slice; the WS connection is delivery-only, all writes go through
// trpc-api.
export function resolveUserId(c: HonoContext, authSecret: string): string | null {
  const token = getCookie(c, SESSION_COOKIE_NAME)
  if (!token) return null
  return verifySessionToken(token, authSecret)?.userId ?? null
}

export function isAllowedOrigin(origin: string | null, allowedOrigins: string[]): boolean {
  if (allowedOrigins.length === 0) return true
  return origin !== null && allowedOrigins.includes(origin)
}
