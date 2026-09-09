import type { Classification } from '@mincirklen/shared'
import type { MessageRow } from '../repositories/messageRepository'
import type { CrisisResource } from './crisisEscalationService'

// Explicit constructor: see the same note in repositories/sessionRepository.ts.
export class NotAMemberError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export interface SentResult {
  status: 'sent'
  message: MessageRow
}

export interface HeldResult {
  status: 'held'
}

export interface CrisisResult {
  status: 'crisis'
  resource: CrisisResource
}

export type SendMessageResult = SentResult | HeldResult | CrisisResult

export interface SendMessageDeps {
  isSessionMember(): Promise<boolean>
  claimTurn(): Promise<void>
  releaseTurnClaim(): Promise<void>
  classify(body: string): Promise<Classification>
  // Each of these three maps 1:1 to a single atomic Repository/Service call
  // the controller wires up — see services/trpc-api/src/repositories/messageRepository.ts
  // for how the 'pass'/'flag'/'crisis' cases persist the message/moderation
  // event. 'flag' and 'crisis' both persist the message now (moderation_status
  // 'flag'/'crisis') — never published to the group either way, but visible
  // back to the sender on their own next refresh (see messageRepository.ts's
  // listMessages).
  recordPassedMessage(body: string): Promise<MessageRow>
  recordFlaggedMessage(body: string): Promise<void>
  escalateCrisis(): Promise<CrisisResource>
  publish(message: MessageRow): void
  // Turn advancement is now owned by websocket-service (Redis is the live
  // authority — see adapters/websocketServiceAdapter.ts), no longer part
  // of recordPassedMessage/recordFlaggedMessage's own transaction. Called
  // explicitly below for all three classifications — a passed message, a
  // flag, and (as of this change) a crisis too, so the sender doesn't keep
  // the room waiting on them; the resource-card response still fires
  // unconditionally regardless.
  advanceTurn(): Promise<void>
}

export async function sendMessage(deps: SendMessageDeps, body: string): Promise<SendMessageResult> {
  if (!(await deps.isSessionMember())) {
    throw new NotAMemberError('user is not a member of this session')
  }

  await deps.claimTurn()

  let classification: Classification
  try {
    classification = await deps.classify(body)
  } catch (err) {
    // Fail closed: an unclassifiable message never falls through to
    // "sent" — release the claim so the sender can retry, and propagate.
    await deps.releaseTurnClaim()
    throw err
  }

  switch (classification) {
    case 'pass': {
      const message = await deps.recordPassedMessage(body)
      deps.publish(message)
      await deps.advanceTurn()
      return { status: 'sent', message }
    }
    case 'flag': {
      await deps.recordFlaggedMessage(body)
      await deps.advanceTurn()
      return { status: 'held' }
    }
    case 'crisis': {
      const resource = await deps.escalateCrisis()
      // Turn advances the same as a flag — the sender doesn't stall the
      // room while their own crisis-resource response and, separately,
      // human escalation are handled. This is a deliberate product
      // decision, not a CHARTER.md §3 concern: the deterministic
      // resource-card/escalation guarantee is about the response the
      // sender gets and the human alert firing, not about turn-taking
      // mechanics.
      await deps.advanceTurn()
      return { status: 'crisis', resource }
    }
    default: {
      // Compile-time exhaustiveness check, not a separate helper function —
      // TS rejects this assignment if a Classification value ever stops
      // being handled above. Not reachable at runtime with a valid
      // Classification; see moderationServiceAdapter.classifyMessage's
      // fail-closed parsing for why nothing else can reach here.
      const unreachable: never = classification
      throw new Error(`unexpected classification: ${JSON.stringify(unreachable)}`)
    }
  }
}

export interface SkipTurnDeps {
  isSessionMember(): Promise<boolean>
  claimTurn(): Promise<void>
  advanceTurn(): Promise<void>
}

// The client-side inactivity countdown's "auto-skip" outcome (see
// sessionShared.tsx's useTurnCountdown) — the turn holder let a full
// countdown pass with nothing drafted, so their turn is forfeited and
// passed to the next (online) member, exactly like a sent message would
// advance it, but with no message persisted and no moderation call.
// claimTurn() alone is what makes this safe to expose as its own
// mutation: only the genuine current turn holder can ever successfully
// call it, same guarantee sendMessage relies on.
export async function skipTurn(deps: SkipTurnDeps): Promise<void> {
  if (!(await deps.isSessionMember())) {
    throw new NotAMemberError('user is not a member of this session')
  }
  await deps.claimTurn()
  await deps.advanceTurn()
}
