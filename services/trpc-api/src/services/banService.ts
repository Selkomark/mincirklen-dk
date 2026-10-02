import type { BanReasonCategory } from '@mincirklen/shared'

// Banning from a session report (sessionReportService.ts's 'ban' action).
// Two independent effects, both needed: the account_bans rows refuse the
// person's identity at their next login — recomputed from the OAuth
// subject, so it survives them deleting the account (oauthController.ts)
// — and users.banned_at kills the session they hold right now
// (context.ts's resolveSession). Evidence is snapshotted at decision time
// because the message rows cascade away with the account; the operator
// note is what gets quoted back if they ask what justified it
// (docs/gdpr-runbook.md).

export interface BanEvidenceMessage {
  id: string
  body: string
  createdAt: Date
}

export interface BanUserDeps {
  listIdentities(userId: string): Promise<{ provider: string; subjectHash: string }[]>
  insertBan(params: {
    identityHash: string
    provider: string
    reasonCategory: BanReasonCategory
    decisionSummary: string
    bannedBy: string
    userIdAtBanTime: string
  }): Promise<{ id: string }>
  insertEvidence(params: { banId: string; evidenceType: 'message' | 'operator_note'; snapshot: Record<string, unknown> }): Promise<void>
  setBannedAt(userId: string): Promise<void>
}

export async function banUser(
  deps: BanUserDeps,
  params: { userId: string; reasonCategory: BanReasonCategory; decisionSummary: string; bannedBy: string; messages: BanEvidenceMessage[] },
): Promise<void> {
  const identities = await deps.listIdentities(params.userId)
  for (const identity of identities) {
    const ban = await deps.insertBan({
      identityHash: identity.subjectHash,
      provider: identity.provider,
      reasonCategory: params.reasonCategory,
      decisionSummary: params.decisionSummary,
      bannedBy: params.bannedBy,
      userIdAtBanTime: params.userId,
    })
    await deps.insertEvidence({ banId: ban.id, evidenceType: 'operator_note', snapshot: { note: params.decisionSummary } })
    for (const message of params.messages) {
      await deps.insertEvidence({
        banId: ban.id,
        evidenceType: 'message',
        snapshot: { messageId: message.id, body: message.body, createdAt: message.createdAt.toISOString() },
      })
    }
  }
  await deps.setBannedAt(params.userId)
}
