import type {
  GuidelinesCheckResult,
  ListOpenSessionsResult,
  ListRecentVisitsResult,
  RosterEntry,
  SessionState,
  SessionSummary,
} from '../repositories/sessionRepository'

export interface CreateSessionDeps {
  createSession(): Promise<{ id: string }>
}

export async function createSession(deps: CreateSessionDeps): Promise<{ id: string }> {
  return deps.createSession()
}

export interface ListOpenSessionsDeps {
  listOpenSessions(): Promise<ListOpenSessionsResult>
}

export async function listOpenSessions(deps: ListOpenSessionsDeps): Promise<ListOpenSessionsResult> {
  return deps.listOpenSessions()
}

export interface JoinSessionDeps {
  joinSession(): Promise<RosterEntry>
}

export async function joinSession(deps: JoinSessionDeps): Promise<RosterEntry> {
  return deps.joinSession()
}

// Composes three independent reads: session lifecycle status (Postgres),
// live turn/roster state (Redis, via websocket-service — see
// adapters/websocketServiceAdapter.ts's getTurnState), and each roster
// member's current display name (Postgres/KMS — see
// userProfileRepository.ts's findDisplayNames). Only reads the live state
// once the session is confirmed to still exist, so a deleted/never-existed
// session is a clean null rather than a websocket-service round trip that
// would 404 anyway. Display names are resolved fresh on every call — see
// findDisplayNames's own doc comment for why that's what makes toggling
// stay_anonymous back on immediately mask the name again, with no
// separate "un-reveal" step needed anywhere.
export interface GetSessionStateDeps {
  getSessionStatus(): Promise<{ id: string; status: SessionState['status'] } | null>
  getTurnState(): Promise<{ currentTurnUserId: string | null; roster: RosterEntry[]; onlineUserIds: string[] }>
  findDisplayNames(userIds: string[]): Promise<Map<string, string>>
}

export async function getSessionState(deps: GetSessionStateDeps): Promise<SessionState | null> {
  const statusInfo = await deps.getSessionStatus()
  if (!statusInfo) return null

  const turnState = await deps.getTurnState()
  const displayNames = await deps.findDisplayNames(turnState.roster.map((r) => r.userId))
  const roster = turnState.roster.map((r) => ({ ...r, displayName: displayNames.get(r.userId) ?? null }))
  return { ...statusInfo, ...turnState, roster }
}

// Read-only existence check — no join, no last_visited_at touch. Used
// before the community-guidelines gate (SessionPage.tsx): a user who
// hasn't agreed yet must not be silently joined to a session just by
// having its URL open, and confirming the session is even real before
// asking them to click through the guidelines saves them the trip if
// it's a dead link. See visitSession below for the join-and-record step
// that runs once guidelines are cleared.
export interface GetSessionSummaryDeps {
  getSessionSummary(): Promise<SessionSummary | null>
}

export async function getSessionSummary(deps: GetSessionSummaryDeps): Promise<SessionSummary | null> {
  return deps.getSessionSummary()
}

// "Visiting" /s/:sessionId is joining (see sessionRepository.ts's
// joinSession) — idempotent for an existing member, so this both
// validates the session exists (joinSession throws SessionNotFoundError
// otherwise) and grants/refreshes real access to getState/listMessages/
// sendMessage, which stay membership-gated. getSessionSummary is a
// second call because joinSession's own return (just a RosterEntry) has
// no display info — the session is guaranteed to exist at that point
// (joinSession would already have thrown), so a null summary here would
// mean the two calls disagreed about that, not a normal "not found".
export interface VisitSessionDeps {
  joinSession(): Promise<RosterEntry>
  getSessionSummary(): Promise<SessionSummary | null>
}

export async function visitSession(deps: VisitSessionDeps): Promise<SessionSummary> {
  await deps.joinSession()
  const summary = await deps.getSessionSummary()
  return summary!
}

export interface ListRecentVisitsDeps {
  listRecentSessionVisits(): Promise<ListRecentVisitsResult>
}

export async function listRecentVisits(deps: ListRecentVisitsDeps): Promise<ListRecentVisitsResult> {
  return deps.listRecentSessionVisits()
}

// Called once a user has already joined (visitSession above) — the
// community-guidelines gate (SessionPage.tsx's CommunityGuidelinesModal)
// lives per-session-membership-row now, not per-user. A thin passthrough:
// the repository does the actual union-across-sessions/sync work (see
// checkAndSyncGuidelines) so a user who agreed to an older set of
// required keys sees exactly the ones they've covered pre-checked, not
// a blunt "start over" — including when a new key gets added later.
export interface CheckGuidelinesDeps {
  checkAndSyncGuidelines(): Promise<GuidelinesCheckResult>
}

export async function checkGuidelines(deps: CheckGuidelinesDeps): Promise<GuidelinesCheckResult> {
  return deps.checkAndSyncGuidelines()
}

export interface RecordGuidelinesAgreementDeps {
  recordGuidelinesAgreement(): Promise<void>
}

export async function recordGuidelinesAgreement(deps: RecordGuidelinesAgreementDeps): Promise<{ agreed: true }> {
  await deps.recordGuidelinesAgreement()
  return { agreed: true }
}
