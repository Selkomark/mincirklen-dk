import {
  listSessionReportsInputSchema,
  reviewSessionReportInputSchema,
  sessionReportTranscriptInputSchema,
} from '@mincirklen/shared'
import { TRPCError } from '@trpc/server'
import { findEarliestMessageAt, listTranscriptWindow } from '../repositories/messageRepository'
import { getRoster } from '../repositories/sessionRepository'
import {
  applySessionReportDecision,
  findSessionReportAnchor,
  findSessionReportStatus,
  listSessionReports,
} from '../repositories/sessionReportRepository'
import { findDisplayNames } from '../repositories/userProfileRepository'
import {
  reviewSessionReport,
  SessionReportAlreadyResolvedError,
  SessionReportNoteRequiredError,
  SessionReportNotFoundError,
} from '../services/sessionReportService'
import { hasPermission, router } from './trpc'

function toTRPCError(err: unknown): TRPCError {
  if (err instanceof SessionReportNotFoundError) {
    return new TRPCError({ code: 'NOT_FOUND', message: err.message })
  }
  if (err instanceof SessionReportAlreadyResolvedError) {
    return new TRPCError({ code: 'CONFLICT', message: err.message })
  }
  if (err instanceof SessionReportNoteRequiredError) {
    return new TRPCError({ code: 'BAD_REQUEST', message: err.message })
  }
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', cause: err })
}

// The review side of member-filed session reports (filing is
// sessionRouter.ts's `report`). Two permissions, not one: AUDITOR-style
// roles get to see the queue without being able to close anything in it.
export const sessionReportsRouter = router({
  list: hasPermission('session_reports.read')
    .input(listSessionReportsInputSchema)
    .query(({ ctx, input }) => listSessionReports(ctx.appEnv.db, input)),

  review: hasPermission('session_reports.review')
    .input(reviewSessionReportInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        await reviewSessionReport(
          {
            findReport: () => findSessionReportStatus(ctx.appEnv.db, input.reportId),
            applyDecision: (status, note) =>
              applySessionReportDecision(ctx.appEnv.db, { reportId: input.reportId, status, reviewedBy: ctx.userId, note }),
          },
          { status: input.status, note: input.note },
        )
        return { ok: true }
      } catch (err) {
        throw toTRPCError(err)
      }
    }),

  // The reported circle's conversation, windowed around the report (see
  // sessionReportTranscriptInputSchema). Members are labelled exactly as
  // the circle itself labels them — turn-order roster plus the first
  // name only for members who turned anonymity off (the same
  // findDisplayNames session.getState uses) — so the reviewer sees what
  // the members saw, never a decrypted identity (CHARTER.md §4).
  transcript: hasPermission('session_reports.read')
    .input(sessionReportTranscriptInputSchema)
    .query(async ({ ctx, input }) => {
      const anchor = await findSessionReportAnchor(ctx.appEnv.db, input.reportId)
      if (!anchor) throw toTRPCError(new SessionReportNotFoundError('session report not found'))

      // A report that names messages opens on the earliest of them — the
      // thing the member actually pointed at — otherwise on the moment it
      // was filed.
      const anchorAt = (await findEarliestMessageAt(ctx.appEnv.db, anchor.messageIds)) ?? anchor.createdAtExact
      const window =
        input.direction === 'around' || !input.cursor
          ? await listTranscriptWindow(ctx.appEnv.db, { sessionId: anchor.sessionId, direction: 'around', at: anchorAt, limit: input.limit })
          : await listTranscriptWindow(ctx.appEnv.db, { sessionId: anchor.sessionId, direction: input.direction, cursor: input.cursor, limit: input.limit })

      const rosterEntries = await getRoster(ctx.appEnv.db, anchor.sessionId)
      const displayNames = await findDisplayNames(
        ctx.appEnv.db,
        ctx.appEnv.vault,
        rosterEntries.map((entry) => entry.userId),
      )
      const roster = rosterEntries.map((entry) => ({ ...entry, displayName: displayNames.get(entry.userId) ?? null }))

      return { ...window, roster, reportedAt: anchor.createdAt, aboutUserIds: anchor.aboutUserIds, messageIds: anchor.messageIds }
    }),
})
