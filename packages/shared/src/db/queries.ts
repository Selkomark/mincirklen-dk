import type { Kysely } from 'kysely'
import type { Database } from './types'

// Shared across trpc-api and websocket-service — both need to answer
// "is this user actually in this session" (message sending in one,
// WebSocket room-subscription authorization in the other), so this lives
// here rather than being duplicated per-service.
export async function isSessionMember(
  db: Kysely<Database>,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const row = await db
    .selectFrom('session_users')
    .select('user_id')
    .where('session_id', '=', sessionId)
    .where('user_id', '=', userId)
    // A member a moderator removed (left_at set — sessionRepository.ts's
    // leaveSession) is no longer a member for any purpose: no reading,
    // no posting, no room subscription.
    .where('left_at', 'is', null)
    .executeTakeFirst()

  return row !== undefined
}
