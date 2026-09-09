import * as Sentry from '@sentry/react'

// Imported first thing in main.tsx, before either the catalog or the real
// App mounts, so it's active for whichever one a given build ships (see
// main.tsx's own comment on why those are separate dynamic imports).
//
// No-ops when VITE_SENTRY_DSN is unset (Vite only exposes VITE_-prefixed
// env vars to client code) — local dev leaves it unset by default so
// day-to-day dev sessions don't get reported as if they were real users;
// set it in .env to opt a local run in for testing this integration
// itself.
const dsn = import.meta.env.VITE_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      // Forwards console.log/warn/error calls as Sentry logs, not just
      // captured exceptions — enableLogs above only turns the underlying
      // capability on, this is what actually feeds it from console.*.
      Sentry.consoleLoggingIntegration({ levels: ['log', 'warn', 'error'] }),
    ],
    tracesSampleRate: 1.0,
    enableLogs: true,
  })
}
