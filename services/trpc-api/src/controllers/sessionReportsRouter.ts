import { listSessionReportsInputSchema, reviewSessionReportInputSchema } from '@mincirklen/shared'
import { TRPCError } from '@trpc/server'
import {
  applySessionReportDecision,
  findSessionReportStatus,
  listSessionReports,
} from '../repositories/sessionReportRepository'
import {
  reviewSessionReport,
  SessionReportAlreadyResolvedError,
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
            applyDecision: (status) => applySessionReportDecision(ctx.appEnv.db, { reportId: input.reportId, status, reviewedBy: ctx.userId }),
          },
          { status: input.status },
        )
        return { ok: true }
      } catch (err) {
        throw toTRPCError(err)
      }
    }),
})
