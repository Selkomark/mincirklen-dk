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
  insertReport(): Promise<void>
  logReport(params: SubmitSessionReportParams): void
}

export async function submitSessionReport(deps: SubmitSessionReportDeps, params: SubmitSessionReportParams): Promise<void> {
  if (!(await deps.isReporterMember())) {
    throw new NotAMemberError('reporting user is not a member of this session')
  }

  const aboutChecks = await Promise.all(params.aboutUserIds.map((id) => deps.isAboutUserMember(id)))
  if (aboutChecks.some((isMember) => !isMember)) {
    // Same error/mapping as above (toTRPCError -> FORBIDDEN) — a report
    // can't reference someone outside the session either way, and the
    // caller has no legitimate reason to be probing for who else is (or
    // isn't) a member, so this doesn't need a more specific error shape.
    throw new NotAMemberError('one or more reported users are not members of this session')
  }

  await deps.insertReport()
  deps.logReport(params)
}
