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

// A revoked grant (GatesTab.tsx's Revoke button) needs to actually cut a
// visitor off, not just block a future invite redemption while a tab
// they already had open keeps trusting a one-time-fetched
// `hasAccess: true` forever — gatesRouter.ts's getStatus re-checks the
// signup's live status on every call specifically so polling here has
// something real to catch. 30s, not instant: a revoke is a rare admin
// action, not something that needs sub-second reaction time.
const GATE_STATUS_POLL_INTERVAL_MS = 30000

// gates.getStatus is public and computes all three fields server-side —
// this hook never needs its own logic, it just reflects back what the
// backend already decided (same relationship useAuthStatus in App.tsx
// has to verifiedProcedure).
export function useGateStatus(gateKey: GateKey): GateStatus {
  const [status, setStatus] = useState<GateStatus>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function load(isInitial: boolean) {
      try {
        const result = await getTrpc<{ open: boolean; unlocked: boolean; hasAccess: boolean }>('gates.getStatus', { gateKey })
        if (!cancelled) setStatus({ kind: 'loaded', ...result })
      } catch {
        // Only the initial load fails safe as fully closed — a signed-out
        // visitor with a flaky request should see the waitlist landing,
        // never the real app by accident. A later poll's transient
        // network blip must not silently boot someone who was already
        // legitimately unlocked; it just tries again next tick instead of
        // overwriting a good status with a bad one.
        if (isInitial && !cancelled) setStatus({ kind: 'loaded', open: false, unlocked: false, hasAccess: false })
      }
    }

    void load(true)
    const interval = setInterval(() => void load(false), GATE_STATUS_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [gateKey])

  return status
}
