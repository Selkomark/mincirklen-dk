import { z } from 'zod'

// The platform's supported UI languages (see services/web-app/src/i18n.ts).
// Norwegian ('nb') and Finnish ('fi') were dropped (2026-09) — current
// focus is English/Danish/Swedish; Norwegian is next-phase scaling, not
// current scope. Re-add both together with their locale files when that
// phase starts.
export const SUPPORTED_LANGUAGES = ['en', 'sv', 'da'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const GENDERS = ['male', 'female', 'other'] as const
export type Gender = (typeof GENDERS)[number]

// Intl.supportedValuesOf('timeZone') is the runtime-authoritative IANA zone
// list (Node/Bun both implement it) — validating against it here means a
// bad zone name can never reach the DB, with no hand-maintained zone list.
const isValidTimeZone = (tz: string): boolean => Intl.supportedValuesOf('timeZone').includes(tz)

// Client-supplied fields from the post-login registration page
// (RegisterPage.tsx) — also reused as the edit path from the Account
// modal's Profile/Preferences sections. `termsAcceptedAt` is deliberately
// not here — the server stamps it at submission time, it's never
// client-supplied. `language`/`timezone` are nullable, not just optional:
// `null` is a real, meaningful choice ("use detected language," "use
// system timezone"), distinct from "field omitted."
export const createUserProfileInputSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  gender: z.enum(GENDERS),
  country: z.string().trim().length(2),
  mobileNumber: z.string().trim().min(1).max(32),
  stayAnonymous: z.boolean(),
  language: z.enum(SUPPORTED_LANGUAGES).nullable().optional(),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine(isValidTimeZone, 'Invalid IANA timezone')
    .nullable()
    .optional(),
  // Consent to this user's messages being used as AI training source
  // material — true means consented. Schema-level default is false (not
  // consented) as the safe fallback for any caller that omits this
  // entirely; RegisterPage.tsx's own checkbox default (pre-checked, a
  // deliberate product decision — see TRAINING_CONSIDERATIONS.md in the
  // moderation-engine repo for the known GDPR Recital 32 gap that choice
  // carries) is a separate, UI-level default, not this one. Also
  // editable later from the Account modal's Privacy & data section
  // (SessionPage.tsx's AccountModal), unchecked by default there.
  trainingConsent: z.boolean().optional().default(false),
})

export type CreateUserProfileInput = z.infer<typeof createUserProfileInputSchema>

export const userProfileSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  gender: z.enum(GENDERS),
  country: z.string(),
  mobileNumber: z.string(),
  stayAnonymous: z.boolean(),
  termsAcceptedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  language: z.string().nullable(),
  timezone: z.string().nullable(),
  trainingConsent: z.boolean(),
})

export type UserProfile = z.infer<typeof userProfileSchema>
