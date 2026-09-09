import type { Redis } from 'ioredis'
import { onlineKey } from './redisPresenceAdapter'

// Redis is the live authority for round/roster state (Stage 2 of the
// websocket-owned-turn-state redesign) — Postgres's session_users/sessions
// columns stay the durable "who has ever joined" record and are only
// used to seed this the first time a session's turn state is touched
// (see seedTurnState below); from that point on, this is authoritative.
function turnKey(sessionId: string): string {
  return `session:${sessionId}:turn`
}
function rosterKey(sessionId: string): string {
  return `session:${sessionId}:roster`
}

// Safety net alongside clearTurnState below: clearTurnState only runs
// when a departure is observed cleanly bringing online count to zero —
// a crashed/killed process, a dev-server restart, or a race between
// concurrent departures never gets a chance to run it, and until now
// these keys had no other expiry, so they'd accumulate in Redis forever.
// Refreshed on every touch (seed/claim/advance/heal/append) below, and
// healStuckTurn's touch alone fires on every ~20s heartbeat for any
// session with even one connected viewer — so an actively-used session's
// state never expires out from under it. Short on purpose: this is only
// ever a stale reconstructible cache of Postgres once it does lapse (see
// seedTurnState), so there's no reason to let dead sessions' debris sit
// around any longer than it takes to be sure they're really abandoned.
const TURN_STATE_TTL_SECONDS = 60 * 5

export interface RosterEntry {
  userId: string
  turnOrder: number
}

export interface TurnState {
  currentTurnUserId: string | null
  roster: RosterEntry[]
}

export type ClaimTurnResult = 'ok' | 'not_found' | 'not_your_turn' | 'already_claimed'

// Empty string, not the literal string "null" — Lua's `false`/nil doesn't
// round-trip through HSET/HGET the way an empty string does, and this
// needs to be unambiguous from a real userId (which is always a UUID).
function encodeUserId(userId: string | null): string {
  return userId ?? ''
}
function decodeUserId(value: string | undefined): string | null {
  return value && value.length > 0 ? value : null
}

export async function getTurnState(redis: Redis, sessionId: string): Promise<TurnState | null> {
  const hash = await redis.hgetall(turnKey(sessionId))
  if (Object.keys(hash).length === 0) return null

  const members = await redis.zrange(rosterKey(sessionId), 0, -1, 'WITHSCORES')
  const roster: RosterEntry[] = []
  for (let i = 0; i < members.length; i += 2) {
    roster.push({ userId: members[i] as string, turnOrder: Number(members[i + 1]) })
  }

  return { currentTurnUserId: decodeUserId(hash.currentTurnUserId), roster }
}

// SETNX-guarded (checked via EXISTS on the turn hash, atomically with the
// write via a single script) — a race between two pods seeding the same
// session concurrently is a harmless no-op on the loser. Returns whether
// this call actually seeded anything, so a caller (e.g. the join
// endpoint) knows whether it still needs to appendToRoster for a member
// who joined after the session was already seeded.
const SEED_TURN_STATE_SCRIPT = `-- SCRIPT:seedTurnState
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 0
end
redis.call('HSET', KEYS[1], 'currentTurnUserId', ARGV[1], 'turnClaimedAt', '')
for i = 2, #ARGV, 2 do
  redis.call('ZADD', KEYS[2], ARGV[i + 1], ARGV[i])
end
redis.call('EXPIRE', KEYS[1], ${TURN_STATE_TTL_SECONDS})
redis.call('EXPIRE', KEYS[2], ${TURN_STATE_TTL_SECONDS})
return 1`

export async function seedTurnState(redis: Redis, sessionId: string, initial: TurnState): Promise<boolean> {
  const argv: (string | number)[] = [encodeUserId(initial.currentTurnUserId)]
  for (const entry of initial.roster) {
    argv.push(entry.userId, entry.turnOrder)
  }

  const result = await redis.eval(SEED_TURN_STATE_SCRIPT, 2, turnKey(sessionId), rosterKey(sessionId), ...argv)
  return result === 1
}

// Called for a join that lands after the session's turn state has already
// been seeded — the turn cursor is deliberately untouched (a new joiner
// goes to the end of the round; nobody else's position moves).
export async function appendToRoster(redis: Redis, sessionId: string, userId: string, turnOrder: number): Promise<void> {
  await redis.multi().zadd(rosterKey(sessionId), turnOrder, userId).expire(rosterKey(sessionId), TURN_STATE_TTL_SECONDS).exec()
}

// Single round trip, atomic: check-then-set can't race with another
// claimTurn/advanceTurn for the same session, matching the guarantee
// Postgres's FOR UPDATE lock gave the old implementation.
const CLAIM_TURN_SCRIPT = `-- SCRIPT:claimTurn
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 'not_found'
end
redis.call('EXPIRE', KEYS[1], ${TURN_STATE_TTL_SECONDS})
local current = redis.call('HGET', KEYS[1], 'currentTurnUserId')
if current ~= ARGV[1] then
  return 'not_your_turn'
end
local claimedAt = redis.call('HGET', KEYS[1], 'turnClaimedAt')
if claimedAt and claimedAt ~= '' then
  local age = tonumber(ARGV[2]) - tonumber(claimedAt)
  if age < tonumber(ARGV[3]) then
    return 'already_claimed'
  end
end
redis.call('HSET', KEYS[1], 'turnClaimedAt', ARGV[2])
return 'ok'`

export async function claimTurn(redis: Redis, sessionId: string, userId: string, staleAfterMs: number): Promise<ClaimTurnResult> {
  const result = await redis.eval(CLAIM_TURN_SCRIPT, 1, turnKey(sessionId), userId, Date.now(), staleAfterMs)
  return result as ClaimTurnResult
}

export async function releaseTurnClaim(redis: Redis, sessionId: string): Promise<void> {
  await redis.hset(turnKey(sessionId), 'turnClaimedAt', '')
}

// Returns the new current-turn userId, or null for an empty roster.
// Walks forward from the current position (wrapping modulo the
// roster's length, same index math as before) but skips any member who
// isn't currently online — see KEYS[3]/ARGV[1] — so one offline member
// can never stall every other online member's round waiting for a turn
// that will never be claimed. Falls back to the plain next-in-line if
// *nobody* is online (rather than returning null / refusing to
// advance): once anyone reconnects, state is already sane instead of
// stuck on a turn from before everyone left.
const ADVANCE_TURN_SCRIPT = `-- SCRIPT:advanceTurn
local roster = redis.call('ZRANGE', KEYS[2], 0, -1)
local count = #roster
if count == 0 then
  return false
end
redis.call('EXPIRE', KEYS[1], ${TURN_STATE_TTL_SECONDS})
redis.call('EXPIRE', KEYS[2], ${TURN_STATE_TTL_SECONDS})
local current = redis.call('HGET', KEYS[1], 'currentTurnUserId')
local currentIndex = -1
for i, userId in ipairs(roster) do
  if userId == current then
    currentIndex = i - 1
    break
  end
end
local onlineCutoff = tonumber(ARGV[1])
local nextUserId = nil
for offset = 1, count do
  local idx = (currentIndex + offset) % count
  local candidate = roster[idx + 1]
  local score = redis.call('ZSCORE', KEYS[3], candidate)
  if score and tonumber(score) >= onlineCutoff then
    nextUserId = candidate
    break
  end
end
if not nextUserId then
  nextUserId = roster[((currentIndex + 1) % count) + 1]
end
redis.call('HSET', KEYS[1], 'currentTurnUserId', nextUserId, 'turnClaimedAt', '')
return nextUserId`

export async function advanceTurn(redis: Redis, sessionId: string, presenceStaleAfterMs: number): Promise<string | null> {
  const result = await redis.eval(
    ADVANCE_TURN_SCRIPT,
    3,
    turnKey(sessionId),
    rosterKey(sessionId),
    onlineKey(sessionId),
    Date.now() - presenceStaleAfterMs,
  )
  return (result as string | null) ?? null
}

// advanceTurn above only ever skips an offline member while actively
// handing the turn on from someone who just sent/skipped — it never
// helps a round that's *already* stuck on someone offline, since
// nobody else can call claimTurn (it isn't their turn) or advanceTurn
// (there's nothing to advance *from* on their side) to get it moving
// again. This is the other half: a pure "is the current holder actually
// online?" check that, if not, does the exact same skip-forward walk
// and hands the turn to the next online member — a no-op otherwise
// (current holder genuinely online, or nobody else online to hand off
// to). Called from wsController.ts on every presence change (subscribe,
// unsubscribe, and — critically — the ~20s heartbeat), so a round stuck
// on someone who's offline self-heals within one heartbeat interval of
// anyone else still being in the room, without requiring the offline
// holder to ever come back.
const HEAL_STUCK_TURN_SCRIPT = `-- SCRIPT:healStuckTurn
if redis.call('EXISTS', KEYS[1]) == 0 then
  return false
end
redis.call('EXPIRE', KEYS[1], ${TURN_STATE_TTL_SECONDS})
redis.call('EXPIRE', KEYS[2], ${TURN_STATE_TTL_SECONDS})
local current = redis.call('HGET', KEYS[1], 'currentTurnUserId')
if not current or current == '' then
  return false
end
local onlineCutoff = tonumber(ARGV[1])
local currentScore = redis.call('ZSCORE', KEYS[3], current)
if currentScore and tonumber(currentScore) >= onlineCutoff then
  return false
end
local roster = redis.call('ZRANGE', KEYS[2], 0, -1)
local count = #roster
if count == 0 then
  return false
end
local currentIndex = -1
for i, userId in ipairs(roster) do
  if userId == current then
    currentIndex = i - 1
    break
  end
end
local nextUserId = nil
for offset = 1, count do
  local idx = (currentIndex + offset) % count
  local candidate = roster[idx + 1]
  local score = redis.call('ZSCORE', KEYS[3], candidate)
  if score and tonumber(score) >= onlineCutoff and candidate ~= current then
    nextUserId = candidate
    break
  end
end
if not nextUserId then
  return false
end
redis.call('HSET', KEYS[1], 'currentTurnUserId', nextUserId, 'turnClaimedAt', '')
return nextUserId`

export async function healStuckTurn(redis: Redis, sessionId: string, presenceStaleAfterMs: number): Promise<string | null> {
  const result = await redis.eval(
    HEAL_STUCK_TURN_SCRIPT,
    3,
    turnKey(sessionId),
    rosterKey(sessionId),
    onlineKey(sessionId),
    Date.now() - presenceStaleAfterMs,
  )
  return (result as string | null) ?? null
}

// Called once presenceService.ts's leavePresence sees a session's online
// count drop to zero — nobody's connected to read or act on this state
// anymore, so this is the fast path that reclaims it immediately rather
// than waiting out TURN_STATE_TTL_SECONDS' backstop expiry above. Safe
// to drop unconditionally: both are a reconstructible cache of
// Postgres (session_users/sessions), reseeded on first touch the next
// time anyone opens this session — see seedTurnState above and
// turnService.ts's getTurnState/joinTurn. A rejoin racing this cleanup
// is harmless for the same reason: worst case is a redundant reseed
// from the same Postgres row, not a correctness gap or data loss.
export async function clearTurnState(redis: Redis, sessionId: string): Promise<void> {
  await redis.del(turnKey(sessionId), rosterKey(sessionId))
}
