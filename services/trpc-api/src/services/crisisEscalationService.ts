// CHARTER.md principle 3: a crisis disclosure always triggers a
// deterministic resource-card + human-escalation response, independent of
// what the moderation model decided, with no conditional bypass anywhere in
// the call chain. This module is that guarantee — kept small and isolated
// deliberately, so it can be audited without touching detection internals
// (roadmap Addendum D.1).

export interface CrisisResource {
  type: 'crisis_resource'
  message: string
  resources: { name: string; phone: string; url?: string }[]
}

// Pure, no dependencies — cannot fail. This is what makes the guarantee
// unconditional: the response the sender receives never depends on any I/O
// succeeding.
//
// Ordered Denmark first (primary market), then the rest of the Nordics —
// shown in full to every user regardless of locale/session, deliberately
// not location-inferred (Charter §4: no location tracking). Phone
// numbers/orgs sourced and verified at the time this was written
// (2026-09) — re-verify before any of these change, hotline info being
// wrong is a real safety failure, not just stale content.
export function buildCrisisResource(): CrisisResource {
  return {
    type: 'crisis_resource',
    message:
      'It sounds like things are really hard right now. Please reach out to one of the resources below, or call your local emergency number if you or someone else is in immediate danger — 112 in Denmark, Sweden, Finland and Iceland, or 113 for medical emergencies in Norway.',
    resources: [
      { name: 'Livslinien (Denmark)', phone: '70 201 201', url: 'https://livslinien.dk' },
      { name: 'Mind Självmordslinjen (Sweden)', phone: '90101', url: 'https://mind.se' },
      { name: 'Mental Helse Hjelpetelefonen (Norway)', phone: '116 123', url: 'https://mentalhelse.no' },
      { name: 'MIELI Kriisipuhelin (Finland)', phone: '09 2525 0111', url: 'https://mieli.fi' },
      { name: 'Hjálparsími Rauða krossins (Iceland)', phone: '1717', url: 'https://www.raudikrossinn.is' },
    ],
  }
}

export interface EscalationParams {
  sessionId: string
  userId: string
}

export interface EscalateDeps {
  // Persists the message body (moderation_status: 'crisis') and the
  // moderation event, atomically — see messageRepository.ts's
  // recordCrisisMessage. Never broadcast to the group; the sender picks
  // it back up via their own next listMessages refresh, same as a flag.
  recordCrisisMessage: () => Promise<void>
  // The seam a future human-paging integration hooks into — there's
  // nothing real to page yet, so this is a structured, clearly-marked log
  // line, not a fake integration.
  logEscalation: (params: EscalationParams) => void
  logCriticalFailure: (err: unknown, params: EscalationParams) => void
}

export async function escalate(deps: EscalateDeps, params: EscalationParams): Promise<CrisisResource> {
  const resource = buildCrisisResource()

  deps.logEscalation(params)

  try {
    await deps.recordCrisisMessage()
  } catch (err) {
    // Withholding the resource-card response because persistence hiccuped
    // would be a worse outcome than a logged, catchable persistence gap —
    // the response firing unconditionally is the actual guarantee here,
    // logging is secondary. Deliberately swallowed, not rethrown.
    deps.logCriticalFailure(err, params)
  }

  return resource
}
