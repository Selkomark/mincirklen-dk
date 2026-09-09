export interface DeleteAccountDeps {
  deleteUser: () => Promise<void>
}

// GDPR right to erasure (Article 17) — immediate, no grace period. The
// actual cleanup is entirely delegated to the DB's own cascade FKs (see
// userRepository.ts's deleteUser and migrations/0001_init.ts); this
// function has no logic of its own beyond calling it, matching this
// codebase's other thin Service-layer functions (see
// userProfileService.ts's completeUserProfile) — the DI boundary is what
// lets accountDeletionService.test.ts assert the deletion actually
// happens without needing a real Postgres.
export async function deleteAccount(deps: DeleteAccountDeps): Promise<void> {
  await deps.deleteUser()
}
