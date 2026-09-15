import { useEffect, useState } from 'react'
import { getTrpc } from './gateShared'

// Mirrors packages/shared/src/gates/registry.ts's GateKey — this app isn't
// in the Bun workspace that package lives in (same reasoning as
// languages.ts's SupportedLanguage), so this is kept in sync by hand.
// Only one gate exists today; add to this union alongside a new
// GATE_REGISTRY entry when a future feature needs its own gate.
export type GateKey = 'platform_launch'

export type GateStatus =
  | { kind: 'loading' }
  // `unlocked` (open, or *this visitor* holds a real, valid grant for
  // this gate) is deliberately separate from `hasAccess` (unlocked, or
  // an admin bypass) — App.tsx's landing-page swap keys off `unlocked`
  // specifically, so a real invited visitor who redeemed their link sees
  // the unlocked page, while an admin with no cookie of their own still
  // sees the waitlist form as a preview of what a real visitor sees, even
  // though `hasAccess` is true for them either way. Use `hasAccess` for
  // "can this visitor reach a gated route at all," `unlocked` for
  // "should this specific page show its real content vs. the waitlist."
  | { kind: 'loaded'; open: boolean; unlocked: boolean; hasAccess: boolean }

// gates.getStatus is public and computes all three fields server-side —
// this hook never needs its own logic, it just reflects back what the
// backend already decided (same relationship useAuthStatus in App.tsx
// has to verifiedProcedure).
export function useGateStatus(gateKey: GateKey): GateStatus {
  const [status, setStatus] = useState<GateStatus>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await getTrpc<{ open: boolean; unlocked: boolean; hasAccess: boolean }>('gates.getStatus', { gateKey })
        if (!cancelled) setStatus({ kind: 'loaded', ...result })
      } catch {
        // Fails safe as fully closed — a signed-out visitor with a flaky
        // request should see the waitlist landing, never the real app by
        // accident.
        if (!cancelled) setStatus({ kind: 'loaded', open: false, unlocked: false, hasAccess: false })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [gateKey])

  return status
}
