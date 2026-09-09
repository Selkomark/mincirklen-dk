# Production image — this is what IaC/modules/cloud-run's `image` variable
# should eventually point at (built and pushed by this service's own CI
# pipeline, per tech spec section 7.3), not something docker-compose uses.
#
# Build context is the repo root (not this service's own directory) so
# `bun install`/`bun build` can resolve the `@mincirklen/shared` workspace
# package. `bun build` bundles it into dist/index.js, so the final runtime
# stage doesn't need packages/shared at all.
FROM oven/bun:1.3-alpine AS build

WORKDIR /app
COPY package.json bun.lock ./
COPY packages/proto/package.json packages/proto/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY services/trpc-api/package.json services/trpc-api/package.json
COPY services/websocket-service/package.json services/websocket-service/package.json
RUN bun install --frozen-lockfile
COPY packages/proto packages/proto
COPY packages/shared packages/shared
COPY services/trpc-api services/trpc-api
WORKDIR /app/services/trpc-api
RUN bun run build

FROM oven/bun:1.3-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/services/trpc-api/dist ./dist

EXPOSE 8787

CMD ["bun", "run", "dist/index.js"]
