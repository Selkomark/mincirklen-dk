# Dev image: install deps only. Source is bind-mounted at runtime (see
# docker-compose.yml) so edits on the host are picked up immediately by
# `bun --watch` — no image rebuild, no restart needed for a code change.
#
# Build context is the repo root (not this service's own directory) so
# `bun install` can resolve the `@mincirklen/shared` workspace package —
# same pattern as trpc-api/dev.Dockerfile, see that file's comment. `bun
# install` validates every workspace listed in the root package.json, not
# just this service's, so every member's package.json has to be present.
FROM oven/bun:1.3-alpine

WORKDIR /app

COPY package.json bun.lock ./
COPY packages/proto/package.json packages/proto/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY services/trpc-api/package.json services/trpc-api/package.json
COPY services/websocket-service/package.json services/websocket-service/package.json
COPY services/data-export-service/package.json services/data-export-service/package.json
RUN bun install

WORKDIR /app/services/data-export-service

EXPOSE 8083

CMD ["bun", "run", "dev"]
