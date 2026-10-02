import type { BanReasonCategory, SessionReportAction, SessionReportOutcome } from '@mincirklen/shared'
import { NotAMemberError } from './messageService'

// "Report this session" (SessionPage.tsx's ReportSessionModal). Unlike
// crisisEscalationService.ts's escalate() — which must never fail the
// caller's response, because the crisis resource card is an
// unconditional safety guarantee — a report's persistence failure IS
// worth surfacing: the reporting user needs real feedback that it either
// went through or didn't, so they can retry, rather than a silently
// swallowed write. Deliberately stops at "persisted + logged": there's no
// review queue anywhere in this codebase yet (see
// moderationEventRepository.ts's human_reviewed/human_review_outcome,
// written but never read back by anything) — logReport is the same kind
// of "structured, clearly-marked log line, not a fake integration" seam
// crisisEscalationService.ts's logEscalation already established, for a
// future reviewer surface to build on.
export interface SubmitSessionReportParams {
  sessionId: string
  reporterUserId: string
  aboutUserIds: string[]
  // Specific messages the member is reporting (SessionPage.tsx's per-
  // message report action). Optional detail on top of aboutUserIds, not
  // a replacement — but whoever wrote a reported message is responsible
  // for it, so their id is folded into aboutUserIds below regardless of
  // what the picker sent.
  messageIds: string[]
  body: string
}

export interface SubmitSessionReportDeps {
  isReporterMember(): Promise<boolean>
  // One call per candidate id rather than a single batched query — the
  // list is always small (bounded by the session's roster size, itself
  // capped at MAX_USERS_PER_SESSION), and this reuses the exact same
  // isSessionMember(db, sessionId, userId) the router already calls for
  // the reporter, rather than a second, differently-shaped repository
  // function.
  isAboutUserMember(userId: string): Promise<boolean>
  // message id → author id, for the given ids that exist in THIS
  // session only; an id from any other session is simply absent.
  findMessageAuthors(messageIds: string[]): Promise<Map<string, string>>
  insertReport(params: { aboutUserIds: string[]; messageIds: string[] }): Promise<void>
  logReport(params: SubmitSessionReportParams): void
  // "We received your report" — after the insert, best-effort (the
  // router's implementation never throws). The report exists either way.
  notifyReporterReceived(): Promise<void>
}

export async function submitSessionReport(deps: SubmitSessionReportDeps, params: SubmitSessionReportParams): Promise<void> {
  if (!(await deps.isReporterMember())) {
    throw new NotAMemberError('reporting user is not a member of this session')
  }

  const messageIds = [...new Set(params.messageIds)]
  const authors = messageIds.length > 0 ? await deps.findMessageAuthors(messageIds) : new Map<string, string>()
  if (messageIds.some((id) => !authors.has(id))) {
    // Same shape as the membership errors below: a report can't point at
    // a message outside its own circle, and the caller has no legitimate
    // reason to probe which ids exist elsewhere.
    throw new NotAMemberError('one or more reported messages are not in this session')
  }

  const aboutUserIds = [...new Set([...params.aboutUserIds, ...authors.values()])]

  const aboutChecks = await Promise.all(aboutUserIds.map((id) => deps.isAboutUserMember(id)))
  if (aboutChecks.some((isMember) => !isMember)) {
    // Same error/mapping as above (toTRPCError -> FORBIDDEN) — a report
    // can't reference someone outside the session either way, and the
    // caller has no legitimate reason to be probing for who else is (or
    // isn't) a member, so this doesn't need a more specific error shape.
    throw new NotAMemberError('one or more reported users are not members of this session')
  }

  await deps.insertReport({ aboutUserIds, messageIds })
  deps.logReport({ ...params, aboutUserIds, messageIds })
  await deps.notifyReporterReceived()
}

// ---- Review (the /manage "Session reports" tab) ----
//
// A report moves exactly once: open → reviewed (someone acted on or
// looked into it) or open → dismissed (nothing to do). No reopening and
// no second decision — a decision is a record of what a human concluded
// at the time, not a mutable field; if circumstances change, the member
// files a new report and that gets its own decision. Every decision
// carries the reviewer's own words on why — the note is the audit trail,
// so an empty one is refused here, not just discouraged in the UI.
//
// A reviewed report can also carry one action. Member-targeted actions
// (note, warn, remove_from_session, ban) apply to targetUserIds, which
// must be subjects of the report; hide_messages applies to the messages
// the report names. Actions run first and the decision is recorded last,
// so a failure mid-way leaves the report open to retry rather than
// recorded as done with half its effects missing. Banning additionally
// needs the users.ban permission — resolving reports and banning
// accounts are deliberately separate powers.

export type SessionReportStatus = 'open' | 'reviewed' | 'dismissed'
export type SessionReportDecision = Exclude<SessionReportStatus, 'open'>

export class SessionReportNotFoundError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export class SessionReportAlreadyResolvedError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export class SessionReportNoteRequiredError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export class SessionReportInvalidActionError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export class SessionReportForbiddenActionError extends Error {
  constructor(message: string) {
    super(message)
  }
}

const MEMBER_TARGETED_ACTIONS: ReadonlySet<SessionReportAction> = new Set(['note', 'warn', 'remove_from_session', 'ban'])

// One outcome as the service validates and runs it — the schema's shape
// (SessionReportOutcome) with targets de-duplicated.
export interface ResolvedOutcome {
  action: Exclude<SessionReportAction, 'none'>
  targetUserIds: string[]
  memberMessage: string | null
  banReasonCategory: BanReasonCategory | null
}

export interface ReviewSessionReportDeps {
  findReport(): Promise<{ status: SessionReportStatus; sessionId: string; aboutUserIds: string[]; messageIds: string[] } | null>
  applyDecision(params: { status: SessionReportDecision; note: string; outcomes: ResolvedOutcome[] }): Promise<void>
  addMemberNote(userId: string, note: string): Promise<void>
  sendWarning(userId: string, message: string): Promise<void>
  removeFromSession(userId: string): Promise<void>
  hideMessages(messageIds: string[]): Promise<void>
  banUser(userId: string, reasonCategory: BanReasonCategory, decisionSummary: string): Promise<void>
  // Member-facing follow-up, once the decision is on record: the
  // reporter hears their report was decided; members an outcome applied
  // to hear what happened to them (warn carries its own text and is sent
  // by sendWarning above; note is internal, so nothing). Best-effort —
  // the router's implementation never throws.
  notifyDecision(params: { status: SessionReportDecision; outcomes: ResolvedOutcome[] }): Promise<void>
}

export interface ReviewSessionReportParams {
  status: SessionReportDecision
  note: string
  outcomes: SessionReportOutcome[]
  canBan: boolean
}

export async function reviewSessionReport(deps: ReviewSessionReportDeps, params: ReviewSessionReportParams): Promise<void> {
  const note = params.note.trim()
  if (!note) {
    throw new SessionReportNoteRequiredError('a decision needs a note explaining it')
  }
  const report = await deps.findReport()
  if (!report) {
    throw new SessionReportNotFoundError('session report not found')
  }
  if (report.status !== 'open') {
    throw new SessionReportAlreadyResolvedError(`session report is already ${report.status}`)
  }

  if (params.outcomes.length > 0 && params.status === 'dismissed') {
    throw new SessionReportInvalidActionError('a dismissed report cannot carry an outcome')
  }

  const subjects = new Set(report.aboutUserIds)
  const outcomes: ResolvedOutcome[] = params.outcomes.map((outcome) => {
    const targets = [...new Set(outcome.targetUserIds)]
    const memberMessage = outcome.memberMessage?.trim() ?? ''
    if (MEMBER_TARGETED_ACTIONS.has(outcome.action)) {
      if (targets.length === 0) {
        throw new SessionReportInvalidActionError(`${outcome.action} needs at least one member to apply to`)
      }
      if (targets.some((id) => !subjects.has(id))) {
        throw new SessionReportInvalidActionError('an outcome can only apply to members the report is about')
      }
    }
    if (outcome.action === 'warn' && !memberMessage) {
      throw new SessionReportInvalidActionError('a warning needs the text the member will receive')
    }
    if (outcome.action === 'hide_messages' && report.messageIds.length === 0) {
      throw new SessionReportInvalidActionError('this report names no messages to hide')
    }
    if (outcome.action === 'ban') {
      if (!params.canBan) {
        throw new SessionReportForbiddenActionError('banning needs the users.ban permission')
      }
      if (!outcome.banReasonCategory) {
        throw new SessionReportInvalidActionError('a ban needs a reason category')
      }
    }
    return {
      action: outcome.action,
      targetUserIds: MEMBER_TARGETED_ACTIONS.has(outcome.action) ? targets : [],
      memberMessage: outcome.action === 'warn' ? memberMessage : null,
      banReasonCategory: outcome.action === 'ban' ? (outcome.banReasonCategory ?? null) : null,
    }
  })
  if (outcomes.filter((o) => o.action === 'hide_messages').length > 1) {
    throw new SessionReportInvalidActionError('the reported messages can only be hidden once')
  }

  // Everything is validated before anything runs, so a bad second outcome
  // can't leave the first half-applied. Then run in order — a member can
  // be in several outcomes (a note and a warning, say), each applies.
  for (const outcome of outcomes) {
    switch (outcome.action) {
      case 'note':
        for (const userId of outcome.targetUserIds) await deps.addMemberNote(userId, note)
        break
      case 'warn':
        for (const userId of outcome.targetUserIds) await deps.sendWarning(userId, outcome.memberMessage!)
        break
      case 'remove_from_session':
        for (const userId of outcome.targetUserIds) await deps.removeFromSession(userId)
        break
      case 'hide_messages':
        await deps.hideMessages(report.messageIds)
        break
      case 'ban':
        for (const userId of outcome.targetUserIds) await deps.banUser(userId, outcome.banReasonCategory!, note)
        break
    }
  }

  await deps.applyDecision({ status: params.status, note, outcomes })
  await deps.notifyDecision({ status: params.status, outcomes })
}
