import type { CreateUserProfileInput } from '@mincirklen/shared'

export interface CompleteUserProfileDeps {
  upsertUserProfile: (params: CreateUserProfileInput & { termsAcceptedAt: Date }) => Promise<{ id: string }>
}

// The only real logic here: `termsAcceptedAt` is stamped by the server at
// submission time, never trusted from the client.
export async function completeUserProfile(
  deps: CompleteUserProfileDeps,
  input: CreateUserProfileInput,
): Promise<{ id: string }> {
  return deps.upsertUserProfile({ ...input, termsAcceptedAt: new Date() })
}
