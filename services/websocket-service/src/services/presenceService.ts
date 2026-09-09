export interface PresenceServiceDeps {
  markOnline(sessionId: string, userId: string): Promise<void>
  markOffline(sessionId: string, userId: string): Promise<void>
  getOnlineUserIds(sessionId: string): Promise<string[]>
  // Separate from publishOnlineUsers rather than one combined event: a
  // browse-scope viewer (hasn't joined this session) is only ever meant
  // to see the aggregate count, never which anonymized members are
  // online — see wsController.ts's subscribeBrowse. Two narrower events
  // keep that privacy boundary structural (a filter can't forget to
  // strip a field from a combined payload) rather than relying on every
  // future consumer to filter correctly.
  publishLiveCount(sessionId: string, count: number): void
  publishOnlineUsers(sessionId: string, userIds: string[]): void
  // Called only when a departure leaves nobody online for this session
  // (see leavePresence below) — drops the turn/roster cache so it never
  // accumulates in Redis forever after everyone's left. Safe: it's a
  // reconstructible cache of Postgres, reseeded on next touch. See
  // redisTurnStateAdapter.ts's clearTurnState doc comment.
  clearTurnState(sessionId: string): Promise<void>
}

async function publishPresenceSnapshot(deps: PresenceServiceDeps, sessionId: string): Promise<string[]> {
  const userIds = await deps.getOnlineUserIds(sessionId)
  deps.publishLiveCount(sessionId, userIds.length)
  deps.publishOnlineUsers(sessionId, userIds)
  return userIds
}

// Called when a connection's session-scope subscription starts (a first
// subscribe, a resubscribe after reconnect, or a heartbeat refresh — all
// the same operation, since markOnline's underlying ZADD both records
// and refreshes in one call) — see wsController.ts's subscribeSession
// and its ping handling.
export async function joinPresence(deps: PresenceServiceDeps, sessionId: string, userId: string): Promise<void> {
  await deps.markOnline(sessionId, userId)
  await publishPresenceSnapshot(deps, sessionId)
}

// Called when a connection's session-scope subscription ends (an
// explicit unsubscribe, or the socket closing while still subscribed).
export async function leavePresence(deps: PresenceServiceDeps, sessionId: string, userId: string): Promise<void> {
  await deps.markOffline(sessionId, userId)
  const userIds = await publishPresenceSnapshot(deps, sessionId)
  if (userIds.length === 0) {
    await deps.clearTurnState(sessionId)
  }
}
