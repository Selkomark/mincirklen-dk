// The server->client half of websocket-service's protocol — see that
// service's controllers/wsController.ts and services/wsProtocol.ts for
// the client->server half these are paired with. Kept as its own module
// (not folded into SessionSocketProvider.tsx) so sessionShared.tsx and
// start/shared.tsx can both depend on just the types, not the provider's
// connection-management code.
export interface RosterEntry {
  userId: string
  turnOrder: number
}

export interface RosterUpdateFrame {
  type: 'roster-update'
  sessionId: string
  currentTurnUserId: string | null
  roster: RosterEntry[]
}

export interface ParticipantJoinedFrame {
  type: 'participant-joined'
  sessionId: string
  userId: string
  turnOrder: number
}

// Pushed live whenever a member saves their profile (auth.completeProfile
// — see trpc-api's authRouter.ts and websocket-service's
// createProfileUpdatedHandler), so every other connected viewer's roster
// entry for that member updates immediately instead of waiting on their
// next ~20s getState poll. displayName is already the final, resolved
// value (null means "show as anonymous") — see sessionShared.tsx's
// handleFrame for how this patches just the one roster entry in place.
export interface MemberProfileUpdatedFrame {
  type: 'member-profile-updated'
  sessionId: string
  userId: string
  displayName: string | null
}

// No top-level sessionId — trpc-api's publish payload (see
// websocket-service's rpcServer.ts publishMessage RPC) only ever carries
// it nested under payload.sessionId. SessionSocketProvider
// routes this frame type by payload.sessionId specifically, unlike every
// other frame here which carries sessionId at the top level.
export interface MessageFrame {
  type: 'message'
  // payload.type (distinct from this frame's own `type: 'message'` above)
  // distinguishes a real chat message from a synthetic "X joined the
  // circle" row — see trpc-api's messageRepository.ts and
  // migrations/0001_init.ts. No moderationStatus/falsePositiveReportedAt
  // here — the internal publishMessage RPC (websocketServiceAdapter.ts)
  // only ever carries this fixed field set, and messageService.ts only
  // ever calls publish() for an already-passed message (never
  // flag/crisis — those are withheld from the group entirely, see
  // messageRepository.ts's listMessages). sessionShared.tsx's frame
  // handler fills in moderationStatus: 'pass' explicitly when turning
  // this into a ChatMessage, rather than this type claiming a field the
  // wire payload doesn't actually carry.
  payload: { id: string; sessionId: string; userId: string; body: string; type: 'user' | 'system'; createdAt: string }
}

export interface LiveCountFrame {
  type: 'live-count-changed'
  sessionId: string
  count: number
}

// Session-scope only — a browse-scope viewer (hasn't joined) never
// receives this, only the aggregate LiveCountFrame above. See
// websocket-service's wsController.ts subscribeBrowse.
export interface OnlineUsersFrame {
  type: 'online-users-changed'
  sessionId: string
  userIds: string[]
}

export interface ErrorFrame {
  type: 'error'
  message: string
}

export type SessionFrame =
  | RosterUpdateFrame
  | ParticipantJoinedFrame
  | MemberProfileUpdatedFrame
  | MessageFrame
  | LiveCountFrame
  | OnlineUsersFrame
  | ErrorFrame
  | { type: string }
