// The single source of truth for which feature gates exist. A gate locks
// a slice of the platform (or, today, the whole platform) behind an
// invite-only waitlist until an admin flips its mode in /manage — see
// controllers/trpc.ts::requireGateAccess (trpc-api) and
// pages/manage/GatesTab.tsx (web-app), both of which key off this
// registry rather than anything admin-entered. Adding a future gate is
// one entry here; nothing else needs to change for it to show up in
// /manage with its own signup list and invite links.
export interface GateDefinition {
  name: string
  description: string
  defaultMode: 'open' | 'invite_only'
}

export const GATE_REGISTRY = {
  platform_launch: {
    name: 'Platform launch',
    description: 'Locks the whole platform behind an invite-only waitlist until public launch.',
    defaultMode: 'invite_only',
  },
} as const satisfies Record<string, GateDefinition>

export type GateKey = keyof typeof GATE_REGISTRY

export function isKnownGateKey(key: string): key is GateKey {
  return Object.hasOwn(GATE_REGISTRY, key)
}
