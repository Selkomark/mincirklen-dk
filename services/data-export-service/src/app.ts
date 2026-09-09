import { Hono } from 'hono'
import * as Sentry from '@sentry/bun'
import { sentry } from '@sentry/hono/bun'
import type { AppEnv } from './context'
import { verifyPushRequest } from './adapters/pubsubPushAdapter'
import { uploadExportObject } from './adapters/gcsAdapter'
import {
  findDataExportRequestById,
  markDataExportFailed,
  markDataExportProcessing,
  markDataExportReady,
} from './repositories/dataExportRequestRepository'
import { collectUserExportData } from './repositories/userDataRepository'
import { generateExport, markExportFailedFromDeadLetter } from './services/exportGenerationService'

// Standard Pub/Sub push envelope — `message.data` is the base64 of
// whatever trpc-api published (adapters/pubsubAdapter.ts's
// DataExportRequestedMessage: just { requestId, userId }, deliberately
// no personal data in the message itself).
interface PushEnvelope {
  message?: { data?: string }
}

function decodePushPayload(body: PushEnvelope): { requestId: string; userId: string } {
  const data = body.message?.data
  if (typeof data !== 'string') {
    throw new Error('push envelope missing message.data')
  }
  const decoded = JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as { requestId?: unknown }
  if (typeof decoded.requestId !== 'string') {
    throw new Error('push payload missing requestId')
  }
  return decoded as { requestId: string; userId: string }
}

export function createApp(env: AppEnv): Hono {
  const app = new Hono()

  // First middleware registered, before any route — same convention as
  // trpc-api's app.ts. No-ops when SENTRY_DSN is unset.
  app.use(
    '*',
    sentry(app, {
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'development',
    }),
  )

  app.get('/health', (c) => c.text('ok'))

  // Never public ingress in production (Cloud Run's push subscription
  // calls this directly, IAM-restricted to the subscription's own
  // service account) — the OIDC check below is defense-in-depth beyond
  // that, same posture as moderation-service's shared-secret guard.
  app.post('/pubsub/push', async (c) => {
    try {
      await verifyPushRequest(env.pushAuth, c.req.header('authorization') ?? null)
      const { requestId, userId } = decodePushPayload(await c.req.json())

      const objectKey = `exports/${requestId}.json`

      await generateExport({
        findRequest: () => findDataExportRequestById(env.db, requestId),
        markProcessing: () => markDataExportProcessing(env.db, requestId),
        markReady: (params) => markDataExportReady(env.db, requestId, params),
        collectData: () => collectUserExportData(env.db, env.kms, userId),
        upload: (jsonBody) => uploadExportObject(env.gcs, objectKey, jsonBody),
        objectKey,
        now: () => new Date(),
        retentionTtlMs: env.retentionTtlMs,
      })

      return c.text('ok')
    } catch (err) {
      // No try/catch that swallows this into a 200 — a non-2xx here is
      // exactly what tells Pub/Sub to retry per its own backoff/max-
      // attempts policy. See exportGenerationService.ts's doc comment
      // for why this handler never marks the row 'failed' itself.
      Sentry.captureException(err)
      console.error('[EXPORT] push handler failed', err)
      return c.text('error', 500)
    }
  })

  // Wired (at infra provisioning time, not in this app) as the push
  // target for the dead-letter topic's own subscription — reaching this
  // means Pub/Sub already retried /pubsub/push the configured number of
  // times and gave up. See exportGenerationService.ts.
  app.post('/pubsub/dead-letter', async (c) => {
    try {
      await verifyPushRequest(env.pushAuth, c.req.header('authorization') ?? null)
      const { requestId } = decodePushPayload(await c.req.json())

      await markExportFailedFromDeadLetter({ markFailed: () => markDataExportFailed(env.db, requestId) })

      return c.text('ok')
    } catch (err) {
      Sentry.captureException(err)
      console.error('[EXPORT] dead-letter handler failed', err)
      return c.text('error', 500)
    }
  })

  return app
}
