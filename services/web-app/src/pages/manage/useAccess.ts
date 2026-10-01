import { useEffect, useState } from 'react'
import { getTrpc } from './manageShared'

export interface Access {
  roles: { id: string; name: string }[]
  permissions: string[]
  // The idle-session ceiling actually in force for this request (see
  // sessionPolicyService.ts) — seeds ManagePage.tsx's client-side idle
  // timer, which is the primary expiry trigger. This poll is the
  // defense-in-depth backstop for when that timer is defeated (dev
  // tools, a backgrounded/paused tab, a bug) — real enforcement is the
  // server's own per-request check either way, independent of this poll.
  maxIdleSeconds: number
}

export type AccessStatus = { kind: 'loading' } | { kind: 'loaded'; access: Access } | { kind: 'error' }

const POLL_INTERVAL_MS = 30_000

// rbac.myAccess is the UI-side convenience only — every real /manage
// action is independently gated server-side by hasPermission()
// (controllers/trpc.ts). This just lets the page hide controls a user
// can't use rather than showing them a wall of 403s. Re-polled on an
// interval while mounted so a genuinely idle tab (no clicks to otherwise
// trigger a 401) still redirects once its session expires — see
// manageShared.ts's own 401 handling, which this poll's underlying
// getTrpc call shares with every other /manage request.
export function useAccess(): AccessStatus {
  const [status, setStatus] = useState<AccessStatus>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const access = await getTrpc<Access>('rbac.myAccess', undefined)
        if (!cancelled) setStatus({ kind: 'loaded', access })
      } catch {
        if (!cancelled) setStatus({ kind: 'error' })
      }
    }

    void load()
    const interval = setInterval(() => void load(), POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return status
}

export function hasAccess(access: Access, slug: string): boolean {
  return access.permissions.includes(slug)
}
