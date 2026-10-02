import { useEffect, useRef } from 'react'
import { redirectToAdminLoginForExpiredSession } from './sessionExpiry'

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'] as const

// setTimeout takes a signed 32-bit millisecond delay (~24.8 days). A
// larger value is NOT clamped — browsers overflow it and fire the
// callback immediately. The platform default (180 days, what every role
// without its own session policy resolves to) is ~15.5 billion ms, so
// handing it straight to setTimeout redirected the page the instant it
// mounted, in a loop (each redirect nests another ?returnTo= until the
// URL is too long for the proxy). Hence the deadline-based chaining
// below: arm at most this much at a time and re-check against the real
// deadline when it fires.
const MAX_TIMEOUT_MS = 2 ** 31 - 1

// The primary idle-expiry trigger (useAccess's periodic poll is the
// defense-in-depth backstop for when this is defeated — dev tools, a
// backgrounded tab, a bug). Mirrors the server's own sliding-expiration
// idea client-side: a single deadline re-armed on activity, not a
// ticking countdown, so there's nothing to keep in sync with the server
// beyond the one duration value rbac.myAccess already returned. The
// server's own per-request check (not this timer) is the real
// enforcement, so a bug here can only ever fire a redirect early, never
// let a stale session through.
export function useIdleLogout(maxIdleSeconds: number | null): void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (maxIdleSeconds === null) return

    let deadline = 0

    const arm = () => {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        redirectToAdminLoginForExpiredSession()
        return
      }
      timeoutRef.current = setTimeout(arm, Math.min(remaining, MAX_TIMEOUT_MS))
    }

    const reset = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      deadline = Date.now() + maxIdleSeconds * 1000
      arm()
    }

    reset()
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, reset, { passive: true })
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, reset)
      }
    }
  }, [maxIdleSeconds])
}
