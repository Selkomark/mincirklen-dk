import { Hono } from 'hono'
import * as Sentry from '@sentry/bun'
import { sentry } from '@sentry/hono/bun'
import type { AppEnv } from './context'
import { createWsGuard, createWsHandler } from './controllers/wsController'

// trpc-api's internal calls (turn/roster/publish/profile-updated) are no
// longer routed through this Hono app — see rpcServer.ts's Connect/RPC
// listener on its own internal-only port (index.ts starts both).
export function createApp(env: AppEnv): Hono {
  const app = new Hono()

  // First middleware, before any route — matches "initialize Sentry as
  // early as possible". This is the ONE Sentry.init() for the whole
  // process (both this Hono app on :8080 and rpcServer.ts's Fastify
  // server on :8081 run in the same process — see index.ts) — the
  // fastifyIntegration here registers Fastify instrumentation ahead of
  // time; rpcServer.ts's own Sentry.setupFastifyErrorHandler(server)
  // wires the actual error capture onto that Fastify instance once it
  // exists, reusing this same client rather than re-initializing.
  app.use(
    '*',
    sentry(app, {
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'development',
      enableLogs: true,
      // 'warn'/'error' only — see trpc-api/src/app.ts's identical comment
      // for why (this service's turn/presence logic already logs
      // routinely at 'log' level per request/heartbeat).
      integrations: [
        Sentry.fastifyIntegration(),
        Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] }),
      ],
    }),
  )

  app.get('/healthz', (c) => c.text('ok'))

  app.get('/ws', createWsGuard(env), createWsHandler(env))

  return app
}
