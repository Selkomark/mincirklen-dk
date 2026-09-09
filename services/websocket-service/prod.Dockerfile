# Production image — this is what would eventually get pushed and run as a
# GKE Autopilot workload (tech spec section 5), not deployed via this
# Dockerfile directly — GKE needs the image built and pushed to a registry
# the cluster can pull from.
#
# Build context is the repo root (not this service's own directory) so
# `bun install`/`bun build` can resolve the `@mincirklen/shared` workspace
# package — same pattern as trpc-api/prod.Dockerfile, see that file's
# comment.
FROM oven/bun:1.3-alpine AS build

WORKDIR /app
COPY package.json bun.lock ./
COPY packages/proto/package.json packages/proto/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY services/websocket-service/package.json services/websocket-service/package.json
COPY services/trpc-api/package.json services/trpc-api/package.json
RUN bun install --frozen-lockfile
COPY packages/proto packages/proto
COPY packages/shared packages/shared
COPY services/websocket-service services/websocket-service
WORKDIR /app/services/websocket-service
RUN bun run build

FROM oven/bun:1.3-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/services/websocket-service/dist ./dist

EXPOSE 8080

CMD ["bun", "run", "dist/index.js"]
