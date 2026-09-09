// Roadmap Section 5's MVP cohort size (6-8 people) — the specific number
// targeted for this milestone. Tech spec's "6-12" is the later-scale range,
// not this milestone's target.
export const MAX_USERS_PER_SESSION = 8

// A turn claim older than this is treated as stale and reclaimable — self-
// heals a crashed request without needing a timer/cron sweep.
export const TURN_CLAIM_STALE_AFTER_SECONDS = 15

// A connection's live-presence entry older than this no longer counts
// toward a session's live participant count — self-heals from a pod
// crash or dropped connection that never fired a clean close, the same
// way TURN_CLAIM_STALE_AFTER_SECONDS self-heals a crashed claim. The
// client-side heartbeat interval (see web-app's SessionSocketProvider)
// is well under half of this, so a couple of missed beats don't drop a
// still-open connection's presence.
export const PRESENCE_STALE_AFTER_SECONDS = 45
