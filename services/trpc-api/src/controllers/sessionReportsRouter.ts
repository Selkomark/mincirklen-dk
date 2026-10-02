import {
  listSessionReportsInputSchema,
  reviewSessionReportInputSchema,
  sessionReportTranscriptInputSchema,
} from '@mincirklen/shared'
import { TRPCError } from '@trpc/server'
import { insertAccountBan, insertBanEvidence } from '../repositories/accountBanRepository'
import { insertMemberNote } from '../repositories/memberNoteRepository'
import { findMessagesByIds, listTranscriptWindow, removeMessages } from '../repositories/messageRepository'
import { findSessionName, getRoster, leaveSession } from '../repositories/sessionRepository'
import {
  applySessionReportDecision,
  findReporterId,
  findSessionReportAnchor,
  findSessionReportForReview,
  listSessionReports,
} from '../repositories/sessionReportRepository'
import { listIdentitiesForUser } from '../repositories/userIdentityRepository'
import { findDisplayNames } from '../repositories/userProfileRepository'
import { setBannedAt } from '../repositories/userRepository'
import { banUser } from '../services/banService'
import { memberActionEmail, memberWarnedEmail, reportDecidedEmail } from '../services/moderationEmails'
import {
  reviewSessionReport,
  SessionReportAlreadyResolvedError,
  SessionReportForbiddenActionError,
  SessionReportInvalidActionError,
  SessionReportNoteRequiredError,
  SessionReportNotFoundError,
} from '../services/sessionReportService'
import { emailMember } from './memberEmail'
import { hasPermission, router } from './trpc'

function toTRPCError(err: unknown): TRPCError {
  if (err instanceof SessionReportNotFoundError) {
    return new TRPCError({ code: 'NOT_FOUND', message: err.message })
  }
  if (err instanceof SessionReportAlreadyResolvedError) {
    return new TRPCError({ code: 'CONFLICT', message: err.message })
  }
  if (err instanceof SessionReportNoteRequiredError || err instanceof SessionReportInvalidActionError) {
    return new TRPCError({ code: 'BAD_REQUEST', message: err.message })
  }
  if (err instanceof SessionReportForbiddenActionError) {
    return new TRPCError({ code: 'FORBIDDEN', message: err.message })
  }
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', cause: err })
}

// The review side of member-filed session reports (filing is
// sessionRouter.ts's `report`). Two permissions, not one: AUDITOR-style
// roles get to see the queue without being able to close anything in it;
// banning needs users.ban on top (checked inside the service).
export const sessionReportsRouter = router({
  list: hasPermission('session_reports.read')
    .input(listSessionReportsInputSchema)
    .query(({ ctx, input }) => listSessionReports(ctx.appEnv.db, input)),

  review: hasPermission('session_reports.review')
    .input(reviewSessionReportInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { db, vault } = ctx.appEnv
      // Resolved once up front so every action dep can close over the
      // circle without a second lookup; the service re-reads via
      // findReport for the open/decided check.
      const report = await findSessionReportForReview(db, input.reportId)
      if (!report) throw toTRPCError(new SessionReportNotFoundError('session report not found'))

      try {
        await reviewSessionReport(
          {
            findReport: () => findSessionReportForReview(db, input.reportId),
            applyDecision: (decision) => applySessionReportDecision(db, { reportId: input.reportId, reviewedBy: ctx.userId, ...decision }),
            addMemberNote: (userId, note) => insertMemberNote(db, { userId, body: note, createdBy: ctx.userId, reportId: input.reportId }),
            sendWarning: (userId, message) => emailMember(db, vault, userId, memberWarnedEmail(message)),
            removeFromSession: (userId) => leaveSession(db, report.sessionId, userId),
            hideMessages: (messageIds) => removeMessages(db, { sessionId: report.sessionId, messageIds, removedBy: ctx.userId }),
            banUser: async (userId, reasonCategory, decisionSummary) => {
              const reported = await findMessagesByIds(db, report.sessionId, report.messageIds)
              await banUser(
                {
                  listIdentities: (id) => listIdentitiesForUser(db, id),
                  insertBan: (params) => insertAccountBan(db, params),
                  insertEvidence: (params) => insertBanEvidence(db, params),
                  setBannedAt: (id) => setBannedAt(db, id),
                },
                {
                  userId,
                  reasonCategory,
                  decisionSummary,
                  bannedBy: ctx.userId,
                  messages: reported.filter((m) => m.userId === userId).map((m) => ({ id: m.id, body: m.body, createdAt: m.createdAt })),
                },
              )
            },
            notifyDecision: async ({ status, action, targetUserIds, banReasonCategory }) => {
              // The reporter: that it was decided, never what was done.
              const anchor = await findSessionReportAnchor(db, input.reportId)
              const reporterId = anchor ? await findReporterId(db, input.reportId) : null
              if (reporterId) await emailMember(db, vault, reporterId, reportDecidedEmail(status))

              // Members acted on. 'warn' already went out via sendWarning;
              // 'note' is internal. Hidden messages: tell each author.
              if (action === 'remove_from_session' || action === 'ban') {
                const circleName = await findSessionName(db, report.sessionId)
                for (const userId of targetUserIds) {
                  await emailMember(db, vault, userId, memberActionEmail(action, { circleName, hiddenCount: 0, banReasonCategory }))
                }
              } else if (action === 'hide_messages') {
                const circleName = await findSessionName(db, report.sessionId)
                const hidden = await findMessagesByIds(db, report.sessionId, report.messageIds)
                const byAuthor = new Map<string, number>()
                for (const m of hidden) byAuthor.set(m.userId, (byAuthor.get(m.userId) ?? 0) + 1)
                for (const [userId, count] of byAuthor) {
                  await emailMember(db, vault, userId, memberActionEmail('hide_messages', { circleName, hiddenCount: count, banReasonCategory: null }))
                }
              }
            },
          },
          {
            status: input.status,
            note: input.note,
            action: input.action,
            targetUserIds: input.targetUserIds,
            memberMessage: input.memberMessage,
            banReasonCategory: input.banReasonCategory,
            canBan: ctx.permissions.includes('users.ban'),
          },
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

      // Always windowed on the moment the report was filed — that's the
      // fixed point a reviewer lands on; any messages the report names are
      // marked in the transcript and reached by scrolling, wherever they
      // are relative to it.
      const window =
        input.direction === 'around' || !input.cursor
          ? await listTranscriptWindow(ctx.appEnv.db, { sessionId: anchor.sessionId, direction: 'around', at: anchor.createdAtExact, limit: input.limit })
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
