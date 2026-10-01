import { ADMIN_ROUTE_SEGMENT } from '../../App'

// Fired by both the client idle timer (ManagePage.tsx) and the 401
// handling in manageShared.ts's postTrpc/getTrpc — either one noticing
// "this session is no longer good" lands here the same way. A hard
// window.location redirect, not a client-side navigate: the whole point
// is to drop whatever stale in-memory state /manage was holding, same as
// a real logout. App.tsx's own locale-prefixing redirect (triggered on
// the next load) already preserves window.location.search when it
// rewrites a bare path to its locale-prefixed form, so `?returnTo=...`
// survives that rewrite before LoginPage.tsx ever reads it.
export function redirectToAdminLoginForExpiredSession(): void {
  const returnTo = window.location.pathname + window.location.search
  window.location.href = `/${ADMIN_ROUTE_SEGMENT}?returnTo=${encodeURIComponent(returnTo)}`
}
