# Same pattern as services/*/dev.Dockerfile — deps only, source is
# bind-mounted (see docker-compose.yml) so Vite's own dev server picks up
# changes and hot-reloads exactly like running `bun run dev` on the host.
FROM oven/bun:1.3-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install

EXPOSE 5190

# --host so Vite binds 0.0.0.0 inside the container, not just localhost —
# otherwise it's unreachable from Caddy/the host.
CMD ["bun", "run", "dev", "--", "--host", "0.0.0.0"]
