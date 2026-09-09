---
name: nats-vs-redis
description: Use before adding any pub/sub, fanout, counter, presence, or shared-ephemeral-state feature to a backend service. This repo runs both NATS and Redis for deliberately different, non-overlapping reasons — picking the wrong one for a new feature misuses infrastructure that's there for a specific purpose.
---

Both message brokers exist in this stack, but they are not
interchangeable and are not both "the pub/sub system" — each is scoped
to one job.

## NATS: horizontal fanout for live chat delivery, and nothing else

NATS exists solely so `websocket-service` can scale to multiple
instances while still delivering a session's chat messages to every
browser connected to that session, regardless of which instance each
browser happens to be connected to. The flow is exactly:

- `trpc-api`'s `session.sendMessage` publishes to a per-session subject
  (`roomSubject(sessionId)`) via `adapters/natsAdapter.ts`'s
  `publishMessage`.
- Every `websocket-service` instance subscribes to that subject for each
  open connection (`adapters/natsAdapter.ts`'s `subscribeToRoom`,
  wired up in `controllers/wsController.ts`) and relays what it
  receives straight to the browser (`services/roomRelayService.ts`).

That's the whole contract. NATS here is a message-relay pipe between
already-connected clients of one specific session's chat — it is not a
general event bus. If a new feature isn't "deliver this message to
whoever currently has a websocket open to this room," it does not
belong on NATS, even if it superficially looks like "just another
pub/sub."

## Redis: shared ephemeral state — counters, presence, anything else

Everything that isn't live message relay — counters, presence/active-
participant tracking, rate limiting, cross-request shared state — is
Redis's job. The `ioredis` client and `adapters/redisAdapter.ts` already
exist in `trpc-api` for this (currently just a health-check ping;
`services/healthService.ts` is the only consumer so far).

The concrete case this distinction came from: `/start/join`'s browse
list needs live "N of capacity" joined-counts as people join/leave
sessions while the list is on screen. That's a shared counter/pub-sub
concern scoped to arbitrary sessions a browsing (not-yet-joined) user
happens to have on screen — not a chat-delivery concern to a room's
existing members — so it's designed to run through Redis, not NATS. See
the TODOs at:

- `services/trpc-api/src/repositories/sessionRepository.ts`'s
  `joinSession` (the publish side)
- `services/web-app/src/pages/start/shared.tsx`'s `useOpenSessions` (the
  subscribe/unsubscribe side, keyed to exactly which sessions are
  currently rendered)

## The one-question test

Before wiring a new pub/sub, ask: "does this only need to reach browsers
that already have a live websocket connection to this exact chat room?"
Yes → NATS, following the existing `natsAdapter.ts` pattern in both
services. Anything else — counters, presence, cross-cutting shared
state, rate limits — → Redis, following `adapters/redisAdapter.ts`.
