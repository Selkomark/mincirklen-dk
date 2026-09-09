import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createSessionInputSchema, listMessagesInputSchema, listOpenSessionsInputSchema, listRecentVisitsInputSchema } from '@mincirklen/shared'
import { classifyMessage } from '../adapters/moderationServiceAdapter'
import {
  advanceTurn,
  claimTurn,
  getTurnState,
  notifyJoined,
  publishMessage,
  releaseTurnClaim,
} from '../adapters/websocketServiceAdapter'
import { findDisplayNames } from '../repositories/userProfileRepository'
import {
  insertMessage,
  listMessages as listMessagesRepo,
  recordCrisisMessage,
  recordFlaggedMessage,
  recordPassedMessage,
  reportFalsePositive as reportFalsePositiveRepo,
} from '../repositories/messageRepository'
import { insertSessionReport } from '../repositories/sessionReportRepository'
import {
  NotYourTurnError,
  SessionFullError,
  SessionNotFoundError,
  TurnAlreadyClaimedError,
  checkAndSyncGuidelines,
  createSession as createSessionRepo,
  getSessionStatus as getSessionStatusRepo,
  getSessionSummary as getSessionSummaryRepo,
  isSessionMember,
  joinSession as joinSessionRepo,
  listOpenSessions as listOpenSessionsRepo,
  listRecentSessionVisits as listRecentSessionVisitsRepo,
  recordGuidelinesAgreement,
  type RosterEntry,
} from '../repositories/sessionRepository'
import { escalate } from '../services/crisisEscalationService'
import { NotAMemberError, sendMessage as sendMessageService, skipTurn as skipTurnService } from '../services/messageService'
import { submitSessionReport } from '../services/sessionReportService'
import * as sessionService from '../services/sessionService'
import { router, verifiedProcedure } from './trpc'
import type { AppEnv } from '../context'

function toTRPCError(err: unknown): TRPCError {
  if (err instanceof NotAMemberError || err instanceof NotYourTurnError) {
    return new TRPCError({ code: 'FORBIDDEN', message: err.message })
  }
  if (err instanceof TurnAlreadyClaimedError) {
    return new TRPCError({ code: 'CONFLICT', message: err.message })
  }
  if (err instanceof SessionFullError) {
    return new TRPCError({ code: 'CONFLICT', message: err.message })
  }
  if (err instanceof SessionNotFoundError) {
    return new TRPCError({ code: 'NOT_FOUND', message: err.message })
  }
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', cause: err })
}

const sessionIdInput = z.object({ sessionId: z.string().uuid() })

// Fire-and-forget, same rationale as sendMessage's publish call below —
// see websocketServiceAdapter.ts's notifyJoined comment for why a missed
// or failed notify is never a correctness gap (getState's own
// read-through re-seeds from Postgres regardless).
function notifyJoinedFireAndForget(env: AppEnv, sessionId: string, entry: RosterEntry): void {
  void notifyJoined(env.websocketServiceUrl, env.internalServiceSecret, sessionId, entry.userId, entry.turnOrder).catch(
    (err) => {
      console.error('[TURN] failed to notify websocket-service of a join', err)
    },
  )
}

// Persists a "X joined the circle" system message the same way a real
// chat message is stored (see messageRepository.ts's `type` column), then
// relays it fire-and-forget the same way sendMessage's own `publish` does
// — so it interleaves correctly in history (one cursor-paginated stream,
// sorted by created_at) and arrives live over the exact same WebSocket
// path the frontend already renders messages from. The insert itself is
// awaited (it's a local Postgres write, not a network call to another
// service) so a page load immediately after joining already sees it, but
// a failure here must never fail the join itself — caught and logged.
async function recordAndPublishJoinMessage(env: AppEnv, sessionId: string, userId: string): Promise<void> {
  try {
    const message = await insertMessage(env.db, { sessionId, userId, body: 'joined', type: 'system' })
    void publishMessage(env.websocketServiceUrl, env.internalServiceSecret, sessionId, message).catch((err) => {
      console.error('[PUBLISH] failed to relay join message to websocket-service', err)
    })
  } catch (err) {
    console.error('[JOIN] failed to persist join system message', err)
  }
}

export const sessionRouter = router({
  create: verifiedProcedure.input(createSessionInputSchema).mutation(async ({ ctx, input }) => {
    return sessionService.createSession({
      createSession: () =>
        createSessionRepo(
          ctx.appEnv.db,
          input.scheduled
            ? {
                topicId: input.topicId,
                name: input.name,
                scheduledAt: input.scheduledAt,
                durationMinutes: input.durationMinutes,
                capacity: input.capacity,
              }
            : undefined,
        ),
    })
  }),

  listOpen: verifiedProcedure.input(listOpenSessionsInputSchema).query(async ({ ctx, input }) => {
    return sessionService.listOpenSessions({ listOpenSessions: () => listOpenSessionsRepo(ctx.appEnv.db, input) })
  }),

  join: verifiedProcedure.input(sessionIdInput).mutation(async ({ ctx, input }) => {
    try {
      return await sessionService.joinSession({
        joinSession: async () => {
          const { entry, isNewJoin } = await joinSessionRepo(ctx.appEnv.db, input.sessionId, ctx.userId)
          // Only a genuinely new member fans out a live "joined" event —
          // re-joining a circle you're already in (a double-click, a
          // stale browse-page click) must not re-announce you to
          // everyone currently viewing it. See JoinSessionResult's doc
          // comment in sessionRepository.ts.
          if (isNewJoin) {
            notifyJoinedFireAndForget(ctx.appEnv, input.sessionId, entry)
            await recordAndPublishJoinMessage(ctx.appEnv, input.sessionId, ctx.userId)
          }
          return entry
        },
      })
    } catch (err) {
      throw toTRPCError(err)
    }
  }),

  // Read-only existence + display-info check — SessionPage.tsx calls
  // this first, before the community-guidelines gate, so a not-found
  // session shows 404 immediately without joining anyone or making them
  // click through guidelines for a dead link. No membership side effect;
  // see `visit` below for the join step.
  getSummary: verifiedProcedure.input(sessionIdInput).query(async ({ ctx, input }) => {
    const summary = await sessionService.getSessionSummary({
      getSessionSummary: () => getSessionSummaryRepo(ctx.appEnv.db, input.sessionId),
    })
    if (!summary) {
      throw toTRPCError(new SessionNotFoundError(`session ${input.sessionId} not found`))
    }
    return summary
  }),

  // Navigating to /s/:sessionId — SessionPage.tsx calls this right
  // after getSummary above confirms the session exists, and *before* the
  // guidelines gate (checkGuidelines/agreeToGuidelines below): agreement
  // now lives on the session_users row itself (see
  // migrations/0001_init.ts), so that row
  // has to exist first. Not a dedicated "browse" action like `join`
  // above (StartJoinPage.tsx) — this is the always-on entry point.
  // Re-checks existence (NOT_FOUND if it doesn't exist — a defensive
  // re-check, not the primary one) and auto-joins/refreshes membership
  // so a verified user can navigate straight to any session's URL —
  // including ones they've never explicitly joined via /start/join —
  // without a separate join step; getState/listMessages/sendMessage stay
  // membership-gated exactly as before, now satisfied by this. Also
  // records/bumps last_visited_at for the recent-sessions sidebar
  // (listRecentVisits below).
  visit: verifiedProcedure.input(sessionIdInput).mutation(async ({ ctx, input }) => {
    try {
      return await sessionService.visitSession({
        joinSession: async () => {
          const { entry, isNewJoin } = await joinSessionRepo(ctx.appEnv.db, input.sessionId, ctx.userId)
          // Same rationale as `join` above — `visit` runs on *every*
          // navigation to this session (including by an existing
          // member just reopening the page), so this must stay
          // conditional or every revisit falsely announces a fresh
          // join to everyone currently viewing the session.
          if (isNewJoin) {
            notifyJoinedFireAndForget(ctx.appEnv, input.sessionId, entry)
            await recordAndPublishJoinMessage(ctx.appEnv, input.sessionId, ctx.userId)
          }
          return entry
        },
        getSessionSummary: () => getSessionSummaryRepo(ctx.appEnv.db, input.sessionId),
      })
    } catch (err) {
      throw toTRPCError(err)
    }
  }),

  // Called once `visit` above has joined the user — checks which
  // required keys this user has already agreed to (on this session or
  // any other) and syncs them onto this session's row, so a returning
  // user is never asked to re-agree to something they've already
  // covered, even if a new key was added since they last agreed and
  // they still need to clear that one. A mutation, not a query: the
  // sync is a real write.
  checkGuidelines: verifiedProcedure.input(sessionIdInput).mutation(async ({ ctx, input }) => {
    return sessionService.checkGuidelines({
      checkAndSyncGuidelines: () => checkAndSyncGuidelines(ctx.appEnv.db, input.sessionId, ctx.userId),
    })
  }),

  // CommunityGuidelinesModal's "Agree and continue" — records the
  // agreement onto this session's own membership row (the user must
  // already be a member — see `visit` above).
  agreeToGuidelines: verifiedProcedure.input(sessionIdInput).mutation(async ({ ctx, input }) => {
    return sessionService.recordGuidelinesAgreement({
      recordGuidelinesAgreement: () => recordGuidelinesAgreement(ctx.appEnv.db, input.sessionId, ctx.userId),
    })
  }),

  listRecentVisits: verifiedProcedure.input(listRecentVisitsInputSchema).query(async ({ ctx, input }) => {
    return sessionService.listRecentVisits({
      listRecentSessionVisits: () =>
        listRecentSessionVisitsRepo(ctx.appEnv.db, { userId: ctx.userId, search: input.search, cursor: input.cursor, limit: input.limit }),
    })
  }),

  getState: verifiedProcedure.input(sessionIdInput).query(async ({ ctx, input }) => {
    if (!(await isSessionMember(ctx.appEnv.db, input.sessionId, ctx.userId))) {
      throw toTRPCError(new NotAMemberError('user is not a member of this session'))
    }
    const { websocketServiceUrl, internalServiceSecret } = ctx.appEnv
    return sessionService.getSessionState({
      getSessionStatus: () => getSessionStatusRepo(ctx.appEnv.db, input.sessionId),
      getTurnState: () => getTurnState(websocketServiceUrl, internalServiceSecret, input.sessionId),
      findDisplayNames: (userIds) => findDisplayNames(ctx.appEnv.db, ctx.appEnv.vault, userIds),
    })
  }),

  listMessages: verifiedProcedure.input(listMessagesInputSchema).query(async ({ ctx, input }) => {
    if (!(await isSessionMember(ctx.appEnv.db, input.sessionId, ctx.userId))) {
      throw toTRPCError(new NotAMemberError('user is not a member of this session'))
    }
    return listMessagesRepo(ctx.appEnv.db, {
      sessionId: input.sessionId,
      cursor: input.cursor,
      limit: input.limit,
      requestingUserId: ctx.userId,
    })
  }),

  sendMessage: verifiedProcedure
    .input(sessionIdInput.extend({ body: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { db, moderationServiceUrl, websocketServiceUrl, internalServiceSecret } = ctx.appEnv
      const { sessionId } = input
      const userId = ctx.userId

      try {
        return await sendMessageService(
          {
            isSessionMember: () => isSessionMember(db, sessionId, userId),
            claimTurn: () => claimTurn(websocketServiceUrl, internalServiceSecret, sessionId, userId),
            releaseTurnClaim: () => releaseTurnClaim(websocketServiceUrl, internalServiceSecret, sessionId),
            classify: (body) => classifyMessage(moderationServiceUrl, internalServiceSecret, { sessionId, message: body }),
            recordPassedMessage: (body) => recordPassedMessage(db, { sessionId, userId, body }),
            recordFlaggedMessage: async (body) => {
              await recordFlaggedMessage(db, { sessionId, userId, body })
            },
            escalateCrisis: () =>
              escalate(
                {
                  recordCrisisMessage: () => recordCrisisMessage(db, { sessionId, userId, body: input.body }),
                  logEscalation: (params) => console.error('[ESCALATION] crisis flagged', params),
                  logCriticalFailure: (err, params) =>
                    console.error('[ESCALATION][CRITICAL] failed to persist crisis event', params, err),
                },
                { sessionId, userId },
              ),
            // Fire-and-forget — see websocketServiceAdapter.ts's
            // publishMessage comment for why this must never be awaited
            // into sendMessage's own response.
            publish: (message) => {
              void publishMessage(websocketServiceUrl, internalServiceSecret, sessionId, message).catch((err) => {
                console.error('[PUBLISH] failed to relay message to websocket-service', err)
              })
            },
            // Awaited (unlike publish above) so the turn has actually
            // moved on by the time sendMessage's own response returns —
            // the sender's immediate next getState read should never see
            // themselves still holding it. But the message is already
            // durably persisted by this point regardless, so a failure
            // here must never fail an otherwise-successful send: caught
            // and logged, not propagated.
            advanceTurn: async () => {
              try {
                await advanceTurn(websocketServiceUrl, internalServiceSecret, sessionId)
              } catch (err) {
                console.error('[TURN] failed to advance the turn after sending a message', err)
              }
            },
          },
          input.body,
        )
      } catch (err) {
        throw toTRPCError(err)
      }
    }),

  // The client-side inactivity countdown's auto-skip outcome
  // (sessionShared.tsx's useTurnCountdown) — the holder let a full
  // countdown elapse with nothing drafted. Forfeits the turn to the next
  // (online) member; nothing is persisted or moderated. claimTurn's own
  // check is what makes this safe: only whoever genuinely holds the turn
  // can ever make this succeed, same guarantee sendMessage relies on —
  // so a stale/duplicate call from a client that already lost the turn
  // just 403s instead of skipping someone else's turn.
  skipTurn: verifiedProcedure.input(sessionIdInput).mutation(async ({ ctx, input }) => {
    const { db, websocketServiceUrl, internalServiceSecret } = ctx.appEnv
    const { sessionId } = input
    const userId = ctx.userId

    try {
      await skipTurnService({
        isSessionMember: () => isSessionMember(db, sessionId, userId),
        claimTurn: () => claimTurn(websocketServiceUrl, internalServiceSecret, sessionId, userId),
        advanceTurn: () => advanceTurn(websocketServiceUrl, internalServiceSecret, sessionId),
      })
      return { status: 'skipped' as const }
    } catch (err) {
      throw toTRPCError(err)
    }
  }),

  // ReportSessionModal (SessionPage.tsx) — a member flagging one or more
  // other members' behavior to a human, distinct from sendMessage's own
  // classify() call (the AI moderator acting on message content). See
  // services/sessionReportService.ts's doc comment for why this
  // deliberately doesn't try to swallow persistence failures the way
  // escalateCrisis above does.
  report: verifiedProcedure
    .input(sessionIdInput.extend({ aboutUserIds: z.array(z.string().uuid()).min(1), body: z.string().trim().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx.appEnv
      const { sessionId, aboutUserIds, body } = input
      const reporterUserId = ctx.userId

      try {
        await submitSessionReport(
          {
            isReporterMember: () => isSessionMember(db, sessionId, reporterUserId),
            isAboutUserMember: (userId) => isSessionMember(db, sessionId, userId),
            insertReport: () => insertSessionReport(db, { sessionId, reporterUserId, aboutUserIds, body }),
            logReport: (params) => console.error('[REPORT] session reported', params),
          },
          { sessionId, reporterUserId, aboutUserIds, body },
        )
        return { status: 'submitted' as const }
      } catch (err) {
        throw toTRPCError(err)
      }
    }),

  // The red-highlighted "report as false positive" button next to the
  // sender's own flag/crisis message (SessionPage.tsx). Only ever
  // touches the caller's own message — messageRepository.ts's
  // reportFalsePositive is guarded to `user_id = ctx.userId` at the SQL
  // level, so there's no way to dispute someone else's message even with
  // a forged messageId. Records a request for human review; does not by
  // itself change moderation_status — see
  // messageRepository.ts's applyHumanReviewOutcome for the (not yet
  // wired to any endpoint) reviewer-side half of this.
  reportFalsePositive: verifiedProcedure
    .input(sessionIdInput.extend({ messageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx.appEnv
      if (!(await isSessionMember(db, input.sessionId, ctx.userId))) {
        throw toTRPCError(new NotAMemberError('user is not a member of this session'))
      }
      await reportFalsePositiveRepo(db, { messageId: input.messageId, userId: ctx.userId })
      return { status: 'reported' as const }
    }),
})
