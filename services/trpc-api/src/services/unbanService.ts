// Lifting a ban (rbacRouter.ts's users.unban). The mirror of
// banService.ts: the identity bans are marked lifted (never deleted — the
// record of the earlier decision stays, see migrations/0013), the live
// block on the user row is cleared, the moderator's reasoning goes into
// the member's history for whoever reviews them next, and the member is
// told they can come back. The note is required and internal; the email
// says only that the account is open again.

export class UnbanNoteRequiredError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export class UserNotBannedError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export interface UnbanUserDeps {
  isBanned(): Promise<boolean>
  listIdentities(): Promise<{ provider: string; subjectHash: string }[]>
  liftBans(identityHashes: string[], note: string): Promise<number>
  clearBannedAt(): Promise<void>
  addMemberNote(note: string): Promise<void>
  // Best-effort — the router's implementation never throws.
  notifyUnbanned(): Promise<void>
}

export async function unbanUser(deps: UnbanUserDeps, params: { userId: string; note: string; liftedBy: string }): Promise<void> {
  const note = params.note.trim()
  if (!note) {
    throw new UnbanNoteRequiredError('lifting a ban needs a note explaining it')
  }
  if (!(await deps.isBanned())) {
    throw new UserNotBannedError('this member is not banned')
  }
  const identities = await deps.listIdentities()
  await deps.liftBans(
    identities.map((i) => i.subjectHash),
    note,
  )
  await deps.clearBannedAt()
  await deps.addMemberNote(note)
  await deps.notifyUnbanned()
}
