import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

// Deliberately not the shared package's `UserProfile` type: that one's
// zod-inferred `termsAcceptedAt`/`createdAt` are `Date` (via
// `z.coerce.date()`), but this arrives over `fetch(...).json()` as plain
// ISO strings with no coercion — using the zod type here would silently
// mistype those two fields. This mirrors the fields the frontend actually
// needs, nothing more.
export interface AccountProfile {
  firstName: string
  lastName: string
  gender: string
  country: string
  mobileNumber: string
  stayAnonymous: boolean
  language: string | null
  timezone: string | null
  trainingConsent: boolean
}

interface PreferencesContextValue {
  profile: AccountProfile | null
  profileLoading: boolean
  profileError: string | null
  // Re-fetches `auth.myProfile` — call after a successful save (Profile or
  // Preferences) instead of hand-updating local state, so every consumer
  // (AccountModal, message timestamps, i18n) converges on the same source.
  refetch: () => void
  // `profile.timezone` when the user picked a specific one, else the
  // browser/system timezone — the one thing every date formatter in the
  // app should read instead of leaving `toLocale*` calls to infer it.
  effectiveTimeZone: string
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext)
  if (!ctx) throw new Error('usePreferences must be used within a PreferencesProvider')
  return ctx
}

const SYSTEM_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

// Mounted once per verified session (App.tsx's Shell, alongside
// SessionSocketProvider) — the single fetch of auth.myProfile that
// AccountModal and date formatting both read from, instead of each doing
// their own fetch.
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [refetchNonce, setRefetchNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setProfileLoading(true)
    setProfileError(null)
    void (async () => {
      try {
        const res = await fetch('/api/trpc/auth.myProfile')
        if (!res.ok) throw new Error('error')
        const body = (await res.json()) as { result: { data: { profile: AccountProfile | null } } }
        if (!cancelled) setProfile(body.result.data.profile)
      } catch {
        if (!cancelled) setProfileError('Could not load your profile right now.')
      } finally {
        if (!cancelled) setProfileLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refetchNonce])

  const refetch = useCallback(() => setRefetchNonce((n) => n + 1), [])

  const value: PreferencesContextValue = {
    profile,
    profileLoading,
    profileError,
    refetch,
    effectiveTimeZone: profile?.timezone ?? SYSTEM_TIME_ZONE,
  }

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}
