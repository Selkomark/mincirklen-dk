# Tech spec section 10.1 calls for SSR on initial page loads. There's no
# server entry point yet — this builds and serves the current client-only
# SPA build (same output as build:docs) until SSR exists, so
# IaC/environments/prod's web-app Cloud Run shell has something real to run
# locally/in CI before that upgrade lands.
FROM oven/bun:1.3-alpine AS build

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build:docs

FROM oven/bun:1.3-alpine

WORKDIR /app
RUN bun add -g serve@14
COPY --from=build /app/dist-docs ./dist-docs

EXPOSE 8080

CMD ["serve", "-s", "dist-docs", "-l", "8080"]
