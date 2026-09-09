import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/MinCirklen.dk/' : '/',
  build: {
    outDir: 'dist-docs',
  },
  server: {
    port: 5190,
    strictPort: true,
    // Vite's dev-server host check (anti DNS-rebinding) otherwise rejects
    // requests proxied through Caddy under the local dev-mincirklen.dk
    // domain (docker-compose.yml + infra/caddy/Caddyfile) with a 403.
    allowedHosts: ['dev-mincirklen.dk', 'mincirklen.dk'],
  },
}))
