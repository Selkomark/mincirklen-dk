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

export interface ReviewSessionReportDeps {
  findReport(): Promise<{ status: SessionReportStatus } | null>
  applyDecision(status: SessionReportDecision, note: string): Promise<void>
}

export async function reviewSessionReport(
  deps: ReviewSessionReportDeps,
  params: { status: SessionReportDecision; note: string },
): Promise<void> {
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
  await deps.applyDecision(params.status, note)
}
