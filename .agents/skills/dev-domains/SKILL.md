---
name: dev-domains
description: Use before opening a browser tab, curling, or configuring a callback/redirect URL against any locally running MinCirklen service. Local dev is reached through dev-mincirklen.dk hostnames via Caddy, not localhost:port.
---

Local dev for this repo is routed through Caddy with real hostnames (TLS via mkcert), configured in `local-infra/caddy/Caddyfile`. Use these instead of `localhost:<port>`:

- `https://dev-mincirklen.dk` — web-app (also proxies `/api/*` to trpc-api)
- `https://trpc.dev-mincirklen.dk` — trpc-api
- `https://socket.dev-mincirklen.dk` — websocket-service
- `https://pg.dev-mincirklen.dk` — adminer (Postgres admin UI)
- `https://redis.dev-mincirklen.dk` — redisinsight
- `https://nats.dev-mincirklen.dk` — nats-nui
- `https://glitchtip.dev-mincirklen.dk` — glitchtip (error/log tracking)

This applies to browser automation, curl/fetch checks, and any callback or redirect URL you configure (e.g. OAuth) — the Google OAuth callback is registered as `https://dev-mincirklen.dk/api/auth/callback/google`, so `localhost` won't work for auth flows.

Requires `./setup-local-dns.sh` and `./setup-local-certs.sh` to have been run once, and the `dns` + `caddy` docker-compose services to be up (see `docker-compose.yml` and `docs/local_dev.md`).
