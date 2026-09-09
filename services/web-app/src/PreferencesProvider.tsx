import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

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

// Module-level, not component state — deliberately survives
// PreferencesProvider being unmounted and remounted mid-session. App.tsx's
// Shell drops this provider for one render whenever `gateKey` changes
// (switching between /start, /s/:id, /start/join, /start/new — see
// useAuthStatus's key-mismatch fallback to `{ kind: 'loading' }`), which
// remounts this component and would otherwise re-run the sync effect
// below on every such navigation — silently reverting a language the
// user picked live via the header switcher back to whatever's saved in
// their profile. Applying the saved preference once per real page load
// (this flag only resets on an actual reload, e.g. after logout's hard
// navigation) is the intended behavior; reapplying it on every remount
// isn't.
let hasSyncedLanguageFromProfile = false

// Mounted once per verified session (App.tsx's Shell, alongside
// SessionSocketProvider) — the single fetch of auth.myProfile that
// AccountModal, date formatting, and (once wired) the active i18next
// language all read from, instead of each doing their own fetch.
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
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

  // The user's stored language preference is authoritative on first load —
  // overrides whatever the browser-language detector guessed for this
  // session. A null preference (never set) leaves the detector's guess in
  // place rather than forcing a language. Only ever applied once (see
  // hasSyncedLanguageFromProfile above) — after that, the header
  // switcher and the Preferences panel's own explicit changeLanguage()
  // call are the only things allowed to change the active language.
  useEffect(() => {
    if (profile?.language && !hasSyncedLanguageFromProfile) {
      hasSyncedLanguageFromProfile = true
      if (profile.language !== i18n.language) void i18n.changeLanguage(profile.language)
    }
  }, [profile?.language, i18n])

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
