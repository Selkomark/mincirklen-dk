// The client->server half of the protocol (see wsController.ts). Pure
// parsing/validation, framework-agnostic, so it can be unit tested
// without a real socket. A single persistent connection now serves every
// protected page a user visits (see web-app's SessionSocketProvider), so
// authorization for a given session moves to subscribe-time rather than
// connection-handshake-time — see createWsGuard's comment for why.
export type ClientFrame =
  | { type: 'subscribe'; scope: 'session'; sessionId: string }
  | { type: 'unsubscribe'; scope: 'session'; sessionId: string }
  // The client always sends its *entire* desired browse window on every
  // change (not incremental add/remove) — the server diffs against what
  // it already has subscribed. Matches useOpenSessions' own windowing:
  // there's already exactly one place tracking "which session ids are
  // currently visible," no need for a second incremental protocol to
  // stay in sync with it.
  | { type: 'subscribe'; scope: 'browse'; sessionIds: string[] }
  // Refreshes this connection's presence entries for every session it
  // currently holds a session-scope subscription to — see
  // presenceService.ts's joinPresence, reused here as the refresh path.
  | { type: 'ping' }

// Takes an already-decoded value, not raw wire bytes — decoding (JSON or
// binary, per the connection's negotiated format) happens one layer up in
// wireFormat.ts's decodeFrame, called by wsController.ts before this. That
// keeps this function itself format-agnostic: a pure narrower/validator
// over whatever shape came out of decoding.
export function parseClientFrame(data: unknown): ClientFrame | null {
  if (typeof data !== 'object' || data === null) return null
  const frame = data as Record<string, unknown>

  if (frame.type === 'ping') return { type: 'ping' }

  if (frame.type === 'subscribe' && frame.scope === 'session' && typeof frame.sessionId === 'string') {
    return { type: 'subscribe', scope: 'session', sessionId: frame.sessionId }
  }
  if (frame.type === 'unsubscribe' && frame.scope === 'session' && typeof frame.sessionId === 'string') {
    return { type: 'unsubscribe', scope: 'session', sessionId: frame.sessionId }
  }
  if (
    frame.type === 'subscribe' &&
    frame.scope === 'browse' &&
    Array.isArray(frame.sessionIds) &&
    frame.sessionIds.every((id) => typeof id === 'string')
  ) {
    return { type: 'subscribe', scope: 'browse', sessionIds: frame.sessionIds as string[] }
  }

  return null
}

// A browse-scope viewer hasn't joined the session they're watching a
// live count for — they must never receive that session's
// roster-update/participant-joined detail (which would leak who's in an
// anonymous circle to someone outside it), only the aggregate count. See
// wsController.ts's subscribeBrowse, and presenceSubject's doc comment
// in packages/shared/src/nats/subjects.ts for why both event classes
// share one NATS subject in the first place.
export function isLiveCountFrame(raw: string): boolean {
  try {
    const data = JSON.parse(raw) as { type?: unknown }
    return data.type === 'live-count-changed'
  } catch {
    return false
  }
}
