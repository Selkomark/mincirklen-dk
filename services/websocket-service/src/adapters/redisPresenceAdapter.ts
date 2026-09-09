import type { Redis } from 'ioredis'

// Live "who's actually connected to this session right now" — distinct
// from Postgres's session_users (who has ever joined) and from
// redisTurnStateAdapter's roster (turn order among members). A sorted
// set keyed by userId, scored by last-seen unix ms: ZADD both records a
// fresh connection and refreshes an existing one's heartbeat in one
// call, and staleness is read-time (getOnlineUserIds's `sinceMs` floor)
// rather than needing an explicit expiry sweep — the same
// self-healing-via-staleness shape as redisTurnStateAdapter's claim
// staleness check, applied to presence instead of turn claims.
// Exported so redisTurnStateAdapter.ts's ADVANCE_TURN_SCRIPT can read
// this same set directly (to skip an offline member when picking the
// next turn holder) without a second Redis round trip or duplicating
// the key format.
export function onlineKey(sessionId: string): string {
  return `session:${sessionId}:online`
}

// Safety net beyond the read-time staleness filter above: a connection
// that vanishes without a clean close (crashed tab, killed dev server,
// network partition) never calls markOffline, so its entry would
// otherwise sit in this set forever — physically present in Redis even
// though every reader already treats it as offline. Refreshed on every
// markOnline (join or the ~20s heartbeat), so it only expires once
// nothing has refreshed it in a while; comfortably above the heartbeat
// interval and PRESENCE_STALE_AFTER_SECONDS so it never fires on a
// connection that's genuinely still alive.
const ONLINE_KEY_TTL_SECONDS = 180

export async function markOnline(redis: Redis, sessionId: string, userId: string, now: number): Promise<void> {
  await redis.multi().zadd(onlineKey(sessionId), now, userId).expire(onlineKey(sessionId), ONLINE_KEY_TTL_SECONDS).exec()
}

// A user with more than one live connection to the same session (two
// tabs) is removed on the first one to unsubscribe/close, even if the
// other is still open — no per-connection reference counting. Accepted
// as a bounded MVP inaccuracy (same class of tradeoff as
// sessionStateRepository's async write-back lag): the live count can
// briefly undercount a multi-tab user rather than the added complexity
// of tracking connections separately from users.
export async function markOffline(redis: Redis, sessionId: string, userId: string): Promise<void> {
  await redis.zrem(onlineKey(sessionId), userId)
}

// Anonymized userIds only, in no particular order — callers that need a
// display label (e.g. "Member 3") already have the roster to look one up
// from, same as every other place in this codebase that turns a userId
// into a label (see web-app's SessionPage.tsx memberFor).
export async function getOnlineUserIds(redis: Redis, sessionId: string, sinceMs: number): Promise<string[]> {
  return redis.zrangebyscore(onlineKey(sessionId), sinceMs, '+inf')
}
