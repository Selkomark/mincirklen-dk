import { createDb, createPgPool } from '@mincirklen/shared'
import { websocket } from 'hono/bun'
import { connect } from 'nats'
import { Redis } from 'ioredis'
import { createApp } from './app'
import { createRpcServer } from './rpcServer'

// Never `public` — see packages/shared/src/db/pool.ts and docs/local_dev.md.
// Not running its own migrations (trpc-api does), so `dbSchema` isn't
// passed to runMigrations here — only used to point the pool's search_path
// at the same schema trpc-api migrated.
const dbSchema = process.env.DB_SCHEMA ?? 'dev'
const pool = createPgPool(
  process.env.DATABASE_URL ?? 'postgres://mincirklen:mincirklen@postgres:5432/mincirklen',
  dbSchema,
)
const db = createDb(pool)

const authSecret = process.env.AUTH_SECRET
if (!authSecret) {
  throw new Error('AUTH_SECRET is required')
}

// Load-bearing for fanout (see trpc-api's src/index.ts for the same note)
// — a boot-time connection failure is fatal rather than swallowed.
const nats = await connect({ servers: process.env.NATS_URL ?? 'nats://nats:4222' })

// This service's own shared memory for live round/roster state (Stage 2
// of the websocket-owned-turn-state redesign — see
// adapters/redisTurnStateAdapter.ts). Load-bearing now, unlike trpc-api's
// former do-nothing Redis client: lazyConnect + an explicit connect()
// fails fast on a bad initial connection, the same "fatal at boot" intent
// as NATS above, while ioredis's own default retry strategy still
// applies to any later transient disconnect once this first connect
// succeeds.
const redis = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379', { lazyConnect: true })
await redis.connect()

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const internalServiceSecret = process.env.INTERNAL_SERVICE_SECRET
if (!internalServiceSecret) {
  throw new Error('INTERNAL_SERVICE_SECRET is required')
}

// Binary by default: production needs no special config to get the
// smaller-payload/less-obvious-on-the-wire behavior. Dev's docker-compose
// sets this to 'json' explicitly for easy DevTools inspection, flippable
// to 'binary' locally to test that path before it ships. See
// services/wireFormat.ts and controllers/wsController.ts's `hello` frame
// for how a connection actually ends up using this.
const wsWireFormat = process.env.WS_WIRE_FORMAT ?? 'binary'
if (wsWireFormat !== 'json' && wsWireFormat !== 'binary') {
  throw new Error("WS_WIRE_FORMAT must be 'json' or 'binary'")
}

const app = createApp({ db, nats, redis, authSecret, allowedOrigins, internalServiceSecret, wireFormat: wsWireFormat })

const port = Number(process.env.PORT ?? 8080)
Bun.serve({ port, fetch: app.fetch, websocket })
console.log(`websocket-service listening on :${port}`)

// Second, internal-only listener for trpc-api's Connect/RPC calls — a
// single Bun.serve can't also own this port, and this surface is never
// published to the host (see docker-compose.yml), same posture as
// moderation-service.
const rpcPort = Number(process.env.INTERNAL_RPC_PORT ?? 8081)
await createRpcServer({ db, nats, redis, authSecret, allowedOrigins, internalServiceSecret, wireFormat: wsWireFormat }).listen({
  host: '0.0.0.0',
  port: rpcPort,
})
console.log(`websocket-service internal RPC listening on :${rpcPort}`)
