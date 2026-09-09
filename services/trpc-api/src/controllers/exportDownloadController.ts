import { verifySessionToken } from '@mincirklen/shared'
import { Hono } from 'hono'
import { downloadExportObject, GcsError } from '../adapters/gcsAdapter'
import type { AppEnv } from '../context'
import { findDataExportRequestById } from '../repositories/dataExportRequestRepository'

// 1 day — a fresh token is minted per click (authRouter.ts's
// createExportDownloadToken), not once at export-completion time, so
// this only needs to cover "enough room to actually start the download,"
// not the whole 15-day retention window.
const DOWNLOAD_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24

// The whole point of proxying through this service's own domain
// (trpc.mincirklen.dk in prod, trpc.dev-mincirklen.dk in dev) rather than
// handing the browser a GCS/emulator URL directly: the emulator's
// internal Docker hostname (gcs:4443) was never reachable from a real
// browser in the first place, and in production the bucket is never
// public (public_access_prevention enforced) — this route is the only
// way a download ever actually happens. Deliberately NOT behind a
// session cookie/protectedProcedure — the token itself is the whole
// capability, a "tokenized for public sharing" link that works standalone
// (e.g. forwarded, opened in a different browser) for its 1-day window,
// same shape as any other magic-link download.
export function createExportDownloadController(env: AppEnv): Hono {
  const app = new Hono()

  app.get('/storage/exports/:token', async (c) => {
    const token = c.req.param('token')
    const verified = verifySessionToken(token, env.downloadTokenSecret, DOWNLOAD_TOKEN_MAX_AGE_SECONDS)
    if (!verified) {
      return c.text('Not found', 404)
    }

    // sessionToken.ts's field is generically named `userId` — reused here
    // to carry the data_export_requests.id the token was minted for.
    const requestId = verified.userId
    const request = await findDataExportRequestById(env.db, requestId)
    if (!request || request.status !== 'ready' || !request.storageKey) {
      return c.text('Not found', 404)
    }

    try {
      const { body, contentType } = await downloadExportObject(env.gcs, request.storageKey)
      c.header('content-type', contentType ?? 'application/json')
      c.header('content-disposition', `attachment; filename="mincirklen-export-${requestId}.json"`)
      return c.body(new Uint8Array(body))
    } catch (err) {
      // The object may have already aged out under the bucket's own
      // lifecycle rule even though the token itself is still valid and
      // the DB row still says 'ready' — a 404 either way is the honest
      // answer, not a 500.
      if (err instanceof GcsError) {
        return c.text('Not found', 404)
      }
      throw err
    }
  })

  return app
}
