import { Hono } from 'hono'
import { trpcServer } from '@hono/trpc-server'
import * as Sentry from '@sentry/bun'
import { sentry } from '@sentry/hono/bun'
import { appRouter } from './controllers/appRouter'
import { createExportDownloadController } from './controllers/exportDownloadController'
import { createHealthHandler } from './controllers/healthController'
import { createOAuthController } from './controllers/oauthController'
import { createContextFactory, type AppEnv } from './context'

export function createApp(env: AppEnv): Hono {
  const app = new Hono()

  // First middleware registered, before any route — matches "initialize
  // Sentry as early as possible". No-ops when SENTRY_DSN is unset (same
  // convention as web-app's src/sentry.ts). Catches anything that
  // escapes as a thrown exception through Hono's own middleware/handler
  // chain (the OAuth controller, the health route) — tRPC procedure
  // errors don't propagate this way (see the trpcServer onError below
  // for why those need a separate, narrower hook.
  app.use(
    '*',
    sentry(app, {
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'development',
      enableLogs: true,
      // enableLogs alone only turns the capability on — this is what
      // actually forwards console.* calls as Sentry Logs (matches
      // web-app's src/sentry.ts). 'warn'/'error' only, not 'log' — unlike
      // web-app (one console.error total), this service's business logic
      // already emits routine console.log per request in places; forwarding
      // all of that as Sentry Logs would be pure noise at volume, not the
      // "help investigate a real problem" signal this is for.
      integrations: [Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] })],
    }),
  )

  app.get('/health', createHealthHandler(env))
  app.route('/', createOAuthController(env))
  app.route('/', createExportDownloadController(env))

  app.use(
    '/trpc/*',
    trpcServer({
      router: appRouter,
      endpoint: '/trpc',
      createContext: createContextFactory(env),
      // @hono/trpc-server (via tRPC's own fetch adapter) catches a
      // procedure's thrown error internally and formats the HTTP
      // response itself — it never re-throws through Hono's own
      // middleware chain, so the app-wide sentry() middleware above
      // never sees it. This is the only hook that does.
      //
      // Only INTERNAL_SERVER_ERROR is reported: every *expected*,
      // already-classified domain error (NotAMemberError,
      // SessionNotFoundError, ...) gets mapped to a specific non-500
      // TRPCError code by each router's own toTRPCError (see
      // sessionRouter.ts) — those are handled business outcomes, not
      // crashes, same distinction web-app's ErrorBoundary draws between
      // an inline Alert and a real render crash. INTERNAL_SERVER_ERROR
      // is toTRPCError's fallback for anything it didn't recognize —
      // the actual "something broke unexpectedly" case.
      onError({ error }) {
        if (error.code === 'INTERNAL_SERVER_ERROR') {
          Sentry.captureException(error.cause ?? error)
        }
      },
    }),
  )

  return app
}
