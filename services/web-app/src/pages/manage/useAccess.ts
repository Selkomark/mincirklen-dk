import { useEffect, useState } from 'react'
import { getTrpc } from './manageShared'

export interface Access {
  roles: { id: string; name: string }[]
  permissions: string[]
}

export type AccessStatus = { kind: 'loading' } | { kind: 'loaded'; access: Access } | { kind: 'error' }

// rbac.myAccess is the UI-side convenience only — every real /manage
// action is independently gated server-side by hasPermission()
// (controllers/trpc.ts). This just lets the page hide controls a user
// can't use rather than showing them a wall of 403s.
export function useAccess(): AccessStatus {
  const [status, setStatus] = useState<AccessStatus>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const access = await getTrpc<Access>('rbac.myAccess', undefined)
        if (!cancelled) setStatus({ kind: 'loaded', access })
      } catch {
        if (!cancelled) setStatus({ kind: 'error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return status
}

export function hasAccess(access: Access, slug: string): boolean {
  return access.permissions.includes(slug)
}
