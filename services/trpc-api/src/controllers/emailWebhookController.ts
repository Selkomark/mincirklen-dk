import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { verifyStandardWebhookSignature } from '../auth/standardWebhookSignature'
import { ahasendWebhookEventSchema, applyWebhookEvent, createWebhookDeps } from '../services/emailWebhookService'

// Where AhaSend tells us what happened to a message. On the public
// internet by necessity, so: 503 until a signing secret is configured
// (same posture as the OAuth routes when Google isn't set up), 401 for
// anything not signed by that secret, 400 for a signed body that isn't
// an event. Once the event is stored it always answers 200 — the
// provider retries on anything else, and a bug in applying an already-
// stored event is ours to fix from the log, not a reason for a retry
// storm. Storage itself failing (database down) is the one case that
// returns 500 so the provider does retry; the unique webhook id makes
// that retry safe.
export function createEmailWebhookController(env: AppEnv): Hono {
  const app = new Hono()

  app.post('/webhooks/ahasend', async (c) => {
    if (!env.emailWebhookSecret) {
      return c.json({ error: 'email webhooks are not configured' }, 503)
    }

    const rawBody = await c.req.text()
    const webhookId = c.req.header('webhook-id')
    const verified = verifyStandardWebhookSignature(
      { webhookId, timestamp: c.req.header('webhook-timestamp'), signatureHeader: c.req.header('webhook-signature') },
      rawBody,
      env.emailWebhookSecret,
    )
    if (!verified || !webhookId) {
      return c.json({ error: 'invalid signature' }, 401)
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(rawBody)
    } catch {
      return c.json({ error: 'invalid payload' }, 400)
    }
    const event = ahasendWebhookEventSchema.safeParse(parsedJson)
    if (!event.success) {
      return c.json({ error: 'invalid payload' }, 400)
    }

    try {
      const result = await applyWebhookEvent(createWebhookDeps(env), { webhookId, event: event.data })
      return c.json({ ok: true, result })
    } catch (err) {
      console.error('[EMAIL] webhook event could not be processed', { webhookId, type: event.data.type, err })
      return c.json({ error: 'could not process event' }, 500)
    }
  })

  return app
}
