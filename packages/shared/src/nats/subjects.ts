// The single source of truth for NATS subject naming, so the trpc-api
// publisher and the websocket-service subscriber can never drift apart on
// the subject scheme.
export function roomSubject(sessionId: string): string {
  return `room.${sessionId}.messages`
}

// Cross-pod fanout for roster/turn/join events — separate from
// roomSubject (chat messages) so a client that only cares about presence
// (e.g. the /start/join browse list watching a session's live count)
// never has to also subscribe to its message stream.
export function presenceSubject(sessionId: string): string {
  return `room.${sessionId}.presence`
}
