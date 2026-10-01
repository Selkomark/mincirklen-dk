import { useEffect, useRef } from 'react'
import { redirectToAdminLoginForExpiredSession } from './sessionExpiry'

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'] as const

// The primary idle-expiry trigger (useAccess's periodic poll is the
// defense-in-depth backstop for when this is defeated — dev tools, a
// backgrounded tab, a bug). Mirrors the server's own sliding-expiration
// idea client-side: a single timer re-armed on activity, not a ticking
// countdown, so there's nothing to keep in sync with the server beyond
// the one duration value rbac.myAccess already returned.
//
// Known limitation, not a bug: browsers clamp a single setTimeout delay
// to ~24.8 days (the signed 32-bit ms limit) — a role on the platform
// default (180 days) or a deliberately long policy gets redirected to
// re-authenticate somewhat earlier than that on a tab left truly
// untouched the whole time. Harmless either way: the server's own
// per-request check (not this timer) is the real enforcement, so this
// can only ever fire a redirect early, never let a stale session through.
export function useIdleLogout(maxIdleSeconds: number | null): void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (maxIdleSeconds === null) return

    const reset = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(redirectToAdminLoginForExpiredSession, maxIdleSeconds * 1000)
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
