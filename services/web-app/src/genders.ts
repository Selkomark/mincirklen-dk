// Mirrors the backend's GENDERS enum (packages/shared/src/schemas/userProfile.ts)
// — this app isn't in the Bun workspace those packages live in (it talks
// to the API over plain fetch, not a typed client), so this list is kept
// in sync by hand rather than imported, the same way languages.ts/
// countries.ts aren't shared either.
export type Gender = 'male' | 'female' | 'other'

export const GENDERS: Gender[] = ['male', 'female', 'other']
