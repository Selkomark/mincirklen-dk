import { useEffect, useState } from 'react'
import type { Key } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { DialogTrigger, Popover, Dialog } from 'react-aria-components'
import { Button } from '../components/Button'
import { Switch } from '../components/Switch'
import { IconButton } from '../components/IconButton'
import { Modal } from '../components/Modal'
import { TextField } from '../components/TextField'
import { Select, SelectItem } from '../components/Select'
import { Alert } from '../components/Alert'
import { Skeleton } from '../components/Skeleton'
import { Spinner } from '../components/Spinner'
import { addToast } from '../components/Toast'
import { useTheme } from '../components/ThemeProvider'
import { usePreferences } from '../PreferencesProvider'
import { publicPagePath } from '../publicPages/pages'
import { COUNTRIES } from '../countries'
import { GENDERS } from '../genders'
import { SUPPORTED_LANGUAGES, detectDefaultLanguage, type SupportedLanguage } from '../languages'
import { landingPath, useLocale, useSetLanguage } from '../App'
import type { Locale } from '../locale'
import { logout } from '../logout'
import './AccountModal.css'

// Session pages have their own layout (no SiteHeader) — the account menu
// next to the brand logo in the sidebar (DashLogoHeader) is this page's
// equivalent of SiteHeader's "Log out" button. Same shared network call,
// same hard navigation on success; failure surfaces as a toast (not an
// inline Alert like SiteHeader's — a closed dropdown menu has no
// card/section left to put one in).
async function handleLogout(t: (key: string) => string, locale: Locale) {
  try {
    await logout()
    window.location.href = landingPath(locale)
  } catch {
    addToast(t('errors.logoutFailed'), { variant: 'urgent' })
  }
}

type AccountModalSection = 'preferences' | 'profile' | 'privacy'

const SYSTEM_TIMEZONE_KEY = 'system'
const SYSTEM_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const SUPPORTED_TIME_ZONES = Intl.supportedValuesOf('timeZone').sort((a, b) => a.localeCompare(b))

// "GMT+1"-style short offset per zone, computed once against today's date
// (not per-render — formatting ~400 zones on every keystroke would be
// wasteful) so the open dropdown can show the hour difference next to
// each name — the raw IANA name alone ("America/New_York") doesn't tell
// a user how far off their day that actually is.
const TIME_ZONE_OFFSETS: Record<string, string> = Object.fromEntries(
  SUPPORTED_TIME_ZONES.map((tz) => [
    tz,
    new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')
      ?.value ?? '',
  ]),
)

// Two-column account modal — a left-hand nav (Preferences / Profile /
// Settings / Privacy & data, plus Log out as a separate exit action rather
// than a section with its own content) and a right-hand panel that swaps
// based on the selected section. Replaces the old "⋯" dropdown menu, which
// only ever held a single "Log out" item.
// Every field the Profile/Preferences form's shared save button submits —
// used to snapshot "what's currently saved" so the button can tell
// whether the draft actually differs from it (see AccountModal's
// savedSnapshot/isDirty below), not just whether the required fields
// happen to be filled in.
interface ProfileDraft {
  firstName: string
  lastName: string
  gender: Key | null
  country: Key | null
  mobile: string
  stayAnonymous: boolean
  language: SupportedLanguage
  timezone: string | null
  trainingConsent: boolean
}

function draftsEqual(a: ProfileDraft, b: ProfileDraft): boolean {
  return (
    a.firstName === b.firstName &&
    a.lastName === b.lastName &&
    a.gender === b.gender &&
    a.country === b.country &&
    a.mobile === b.mobile &&
    a.stayAnonymous === b.stayAnonymous &&
    a.language === b.language &&
    a.timezone === b.timezone &&
    a.trainingConsent === b.trainingConsent
  )
}

// Shared by both the Profile and Preferences sections (they save the same
// underlying draft — see AccountModal's handleSaveProfile). Shows the
// "Saved" confirmation inline next to the button itself instead of as a
// toast — `justSaved && !isDirty` is what makes it disappear the instant
// the draft diverges from what was actually saved again, without having
// to hook every individual field's onChange to clear a flag.
function SaveProfileRow({
  isPending,
  canSubmit,
  justSaved,
  isDirty,
  savedLabel,
  saveLabel,
  onSave,
}: {
  isPending: boolean
  canSubmit: boolean
  justSaved: boolean
  isDirty: boolean
  savedLabel: string
  saveLabel: string
  onSave: () => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 'var(--space-2)' }}>
      {justSaved && !isDirty && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-xs)', color: 'var(--accent-safe)' }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {savedLabel}
        </span>
      )}
      <Button variant="safe" className="dash-account-modal__save-btn" isPending={isPending} isDisabled={!canSubmit} onPress={onSave}>
        {saveLabel}
      </Button>
    </div>
  )
}

export function AccountModal({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, i18n } = useTranslation('common')
  const { t: dt } = useTranslation('session')
  const locale = useLocale()
  const setLanguage = useSetLanguage()
  const [section, setSection] = useState<AccountModalSection>('profile')
  // Mobile-only "step 2" — see the CSS media query in SessionPage.css.
  // On desktop both the nav and the section content are visible at once,
  // and this stays false/unused. Reset to false (step 1: nav list) every
  // time the modal opens, alongside the other reset effect below.
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const { theme, toggleTheme } = useTheme()
  const { profile, profileLoading, profileError, refetch } = usePreferences()

  // Draft fields for the editable Profile/Preferences form, seeded from
  // `profile` below. Kept separate from `profile` itself so a half-edited
  // form doesn't affect anything else reading `profile`, and so a failed
  // save leaves the user's in-progress edits in place rather than
  // reverting them.
  const [editFirstName, setEditFirstName] = useState('')
  const [editLastName, setEditLastName] = useState('')
  const [editGender, setEditGender] = useState<Key | null>(null)
  const [editCountry, setEditCountry] = useState<Key | null>(null)
  const [editMobile, setEditMobile] = useState('')
  const [editStayAnonymous, setEditStayAnonymous] = useState(true)
  const [editLanguage, setEditLanguage] = useState<SupportedLanguage>('en')
  const [editTimezone, setEditTimezone] = useState<string | null>(null)
  // Consent to AI training use — defaults false (not consented, matches
  // the DB column default) until the real profile loads.
  const [editTrainingConsent, setEditTrainingConsent] = useState(false)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [saveProfileError, setSaveProfileError] = useState<string | null>(null)
  // What's actually saved right now — diffed against the live draft below
  // to decide whether the Save button has anything to do. Set both by the
  // re-seed effect (on load/reopen) and by a successful save itself, so
  // the button goes right back to disabled once the draft it just
  // submitted becomes the new "saved" baseline.
  const [savedSnapshot, setSavedSnapshot] = useState<ProfileDraft | null>(null)
  // Shows the inline "Saved" confirmation next to the button in place of
  // a toast — cleared implicitly the moment the draft diverges from
  // savedSnapshot again (see the `justSaved && !isDirty` check at each
  // render site below), not by hooking every individual field's onChange.
  const [justSaved, setJustSaved] = useState(false)

  // "Download your data" (GDPR Article 20) — mirrors
  // DataExportRequestSummary from trpc-api's dataExportRequestService.ts.
  // null means "hasn't fetched this open yet"; an empty array means
  // "fetched, nothing requested yet" — both show the request button, only
  // the former also withholds the list itself while loading.
  interface ExportRequestSummary {
    id: string
    status: 'pending' | 'processing' | 'ready' | 'failed' | 'expired'
    requestedAt: string
    expiresAt: string | null
  }
  const [exportRequests, setExportRequests] = useState<ExportRequestSummary[] | null>(null)
  const [isRequestingExport, setIsRequestingExport] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  // Which row's Download button is mid-request — a fresh, short-lived
  // token is minted on every click (never reused/cached), so this is
  // strictly a per-click pending state, not tied to the request's own
  // 'ready' status.
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  // "Delete account" (GDPR Article 17) — immediate, no grace period (see
  // the plan this shipped with). Type-to-confirm friction before the
  // actual irreversible call, same pattern as the registration page's
  // training-consent confirm modal.
  const [deleteAccountConfirmOpen, setDeleteAccountConfirmOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null)

  const currentDraft: ProfileDraft = {
    firstName: editFirstName,
    lastName: editLastName,
    gender: editGender,
    country: editCountry,
    mobile: editMobile,
    stayAnonymous: editStayAnonymous,
    language: editLanguage,
    timezone: editTimezone,
    trainingConsent: editTrainingConsent,
  }
  const isDirty = savedSnapshot !== null && !draftsEqual(currentDraft, savedSnapshot)

  // Reset to the default tab/step and clear any stale save error every
  // time the modal opens — mirrors the old fetch-driven effect's reset,
  // now that the fetch itself lives one level up in PreferencesProvider.
  useEffect(() => {
    if (!isOpen) return
    setSection('profile')
    setMobileDetailOpen(false)
    setSaveProfileError(null)
    setJustSaved(false)
    setExportRequests(null)
    setExportError(null)
    setDeleteAccountConfirmOpen(false)
    setDeleteConfirmText('')
    setDeleteAccountError(null)
  }, [isOpen])

  // Re-seeds the draft fields whenever a freshly (re)loaded profile shows
  // up while the modal is open — on first open once the shared fetch
  // resolves, and again after a save's refetch() — so an abandoned edit
  // never survives a close/reopen, same as the old per-open fetch did.
  // Also (re)establishes savedSnapshot from this same data, so the Save
  // button starts out disabled (nothing dirty yet) whenever the form is
  // freshly (re)seeded, not just right after this component's own save.
  useEffect(() => {
    if (!isOpen || !profile) return
    const snapshot: ProfileDraft = {
      firstName: profile.firstName,
      lastName: profile.lastName,
      gender: profile.gender,
      country: profile.country,
      mobile: profile.mobileNumber,
      stayAnonymous: profile.stayAnonymous,
      language: (profile.language as SupportedLanguage | null) ?? detectDefaultLanguage(),
      timezone: profile.timezone,
      trainingConsent: profile.trainingConsent,
    }
    setEditFirstName(snapshot.firstName)
    setEditLastName(snapshot.lastName)
    setEditGender(snapshot.gender)
    setEditCountry(snapshot.country)
    setEditMobile(snapshot.mobile)
    setEditStayAnonymous(snapshot.stayAnonymous)
    setEditLanguage(snapshot.language)
    setEditTimezone(snapshot.timezone)
    setEditTrainingConsent(snapshot.trainingConsent)
    setSavedSnapshot(snapshot)
  }, [isOpen, profile])

  async function fetchExportRequests() {
    try {
      const res = await fetch('/api/trpc/auth.getDataExportStatus')
      if (!res.ok) return
      const body = (await res.json()) as { result: { data: ExportRequestSummary[] } }
      // Already sorted newest-first by the backend (requestedAt desc).
      setExportRequests(body.result.data)
    } catch {
      // Silent — this is a background status refresh, not a
      // user-initiated action; a failed poll just tries again next tick.
    }
  }

  // Fetch once when the Privacy section becomes visible, and again on
  // every subsequent visit — a request made in an earlier visit to this
  // modal (or a different tab) should still show up.
  useEffect(() => {
    if (!isOpen || section !== 'privacy') return
    void fetchExportRequests()
  }, [isOpen, section])

  // Lightweight polling while any request is in flight on the worker side
  // — this is the ONLY way the UI learns it finished, since trpc-api
  // itself has no way to push that update (see
  // dataExportRequestService.ts's doc comment on why the worker is
  // fully decoupled). Stops itself once nothing is pending/processing.
  const hasInFlightExport = exportRequests?.some((r) => r.status === 'pending' || r.status === 'processing') ?? false
  useEffect(() => {
    if (!isOpen || section !== 'privacy' || !hasInFlightExport) return
    const interval = setInterval(() => void fetchExportRequests(), 4000)
    return () => clearInterval(interval)
  }, [isOpen, section, hasInFlightExport])

  async function handleRequestExport() {
    setExportError(null)
    setIsRequestingExport(true)
    try {
      const res = await fetch('/api/trpc/auth.requestDataExport', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error('request failed')
      const body = (await res.json()) as { result: { data: { id: string; requestedAt: string } } }
      setExportRequests((prev) => [
        { id: body.result.data.id, status: 'pending', requestedAt: body.result.data.requestedAt, expiresAt: null },
        ...(prev ?? []),
      ])
    } catch {
      setExportError(dt('accountModal.dataExportRequestFailed'))
    } finally {
      setIsRequestingExport(false)
    }
  }

  // Mints a fresh, short-lived (1 day) download token on every click —
  // never reuses or caches a URL, matching trpc-api's own design (see
  // authRouter.ts's createExportDownloadToken). A direct navigation, not
  // target="_blank": the proxy route's Content-Disposition: attachment
  // response makes the browser download it in place rather than opening
  // a viewer tab.
  async function handleDownload(requestId: string) {
    setExportError(null)
    setDownloadingId(requestId)
    try {
      const res = await fetch('/api/trpc/auth.createExportDownloadToken', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId }),
      })
      if (!res.ok) throw new Error('download failed')
      const body = (await res.json()) as { result: { data: { url: string } } }
      window.location.href = body.result.data.url
    } catch {
      setExportError(dt('accountModal.dataExportDownloadFailed'))
    } finally {
      setDownloadingId(null)
    }
  }

  async function handleDeleteAccount() {
    setDeleteAccountError(null)
    setIsDeletingAccount(true)
    try {
      const res = await fetch('/api/trpc/auth.deleteAccount', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error('delete failed')
      window.location.href = landingPath(locale)
    } catch {
      setDeleteAccountError(dt('accountModal.deleteAccountFailed'))
      setIsDeletingAccount(false)
    }
  }

  const canSaveProfile =
    editFirstName.trim() !== '' &&
    editLastName.trim() !== '' &&
    editGender != null &&
    editCountry != null &&
    editMobile.trim() !== ''
  // Disabled unless there's both something valid to submit AND something
  // that actually differs from what's already saved — the "keep it
  // disabled until something changed" requirement.
  const canSubmitProfile = canSaveProfile && isDirty

  // Reuses auth.completeProfile — it's an upsert keyed on user_id (see
  // userProfileRepository.ts's own doc comment: "resubmitting the
  // registration form... replaces the previous profile rather than
  // erroring"), already designed to double as an edit path, not just the
  // one-time RegisterPage.tsx flow. Deliberately doesn't re-ask for terms
  // agreement here — that's a one-time consent gate at registration, not
  // something routine edits should have to re-clear every time. Shared by
  // both the Profile and Preferences sections' Save buttons: it's a
  // full-replace upsert either way (see userProfileRepository.ts), so
  // saving from either tab sends every current draft field, not just the
  // ones in that tab.
  async function handleSaveProfile() {
    if (!canSubmitProfile) return
    setSaveProfileError(null)
    setJustSaved(false)
    setIsSavingProfile(true)
    // Trimmed once, reused both for the request body and for the new
    // savedSnapshot/draft baseline below — .trim() on submit must never
    // leave the button looking dirty again just because the raw draft
    // still has the untrimmed whitespace the server won't have stored.
    const trimmed: ProfileDraft = {
      firstName: editFirstName.trim(),
      lastName: editLastName.trim(),
      gender: editGender,
      country: editCountry,
      mobile: editMobile.trim(),
      stayAnonymous: editStayAnonymous,
      language: editLanguage,
      timezone: editTimezone,
      trainingConsent: editTrainingConsent,
    }
    try {
      const res = await fetch('/api/trpc/auth.completeProfile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          firstName: trimmed.firstName,
          lastName: trimmed.lastName,
          gender: String(trimmed.gender),
          country: String(trimmed.country),
          mobileNumber: trimmed.mobile,
          stayAnonymous: trimmed.stayAnonymous,
          language: trimmed.language,
          timezone: trimmed.timezone,
          trainingConsent: trimmed.trainingConsent,
        }),
      })
      if (!res.ok) throw new Error('error')
      // Navigates rather than calling i18n.changeLanguage() directly —
      // the URL's language segment is authoritative (App.tsx's Shell),
      // so a direct changeLanguage() call here would just get overwritten
      // right back by that effect on the next render. useSetLanguage()
      // keeps the current market/page, only swapping the language.
      if (editLanguage !== i18n.language) setLanguage(editLanguage)
      setEditFirstName(trimmed.firstName)
      setEditLastName(trimmed.lastName)
      setEditMobile(trimmed.mobile)
      setSavedSnapshot(trimmed)
      setJustSaved(true)
      refetch()
    } catch {
      setSaveProfileError(t('errors.saveFailed'))
    } finally {
      setIsSavingProfile(false)
    }
  }

  const navItems: { id: AccountModalSection; label: string }[] = [
    { id: 'profile', label: t('nav.profile') },
    { id: 'preferences', label: t('nav.preferences') },
    { id: 'privacy', label: t('nav.privacy') },
  ]

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} title={t('account.title')} className="dash-account-modal">
      <div className="dash-account-modal__viewport">
        <div className={['dash-account-modal__body', mobileDetailOpen && 'dash-account-modal__body--detail'].filter(Boolean).join(' ')}>
          <div className="dash-account-modal__nav">
            <div className="dash-account-modal__nav-title">{t('account.title')}</div>
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="dash-account-modal__nav-item"
                aria-current={section === item.id}
                onClick={() => {
                  setSection(item.id)
                  setMobileDetailOpen(true)
                }}
              >
                {item.label}
              </button>
            ))}
            <div style={{ marginTop: 'auto', paddingTop: 'var(--space-3)', borderTop: '0.5px solid var(--border-subtle)' }}>
              <button
                type="button"
                className="dash-account-modal__nav-item dash-account-modal__nav-item--urgent"
                onClick={() => void handleLogout(t, locale)}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M6 2H3.5A1.5 1.5 0 002 3.5v9A1.5 1.5 0 003.5 14H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M10.5 11l3-3-3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M13.5 8H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t('nav.logOut')}
              </button>
            </div>
          </div>
          <div className="dash-account-modal__content">
            <button type="button" className="dash-account-modal__back" onClick={() => setMobileDetailOpen(false)}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {dt('accountModal.back')}
            </button>
            {section === 'preferences' && (
            <>
              <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as unknown as number }}>
                {t('nav.preferences')}
              </div>
              {profileLoading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Skeleton width="60%" height={14} />
                  <Skeleton width="40%" height={14} />
                </div>
              )}
              {!profileLoading && profileError && <Alert variant="urgent">{profileError}</Alert>}
              {!profileLoading && !profileError && !profile && (
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                  {dt('accountModal.preferencesUnavailable')}
                </div>
              )}
              {!profileLoading && !profileError && profile && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>{dt('accountModal.language')}</div>
                    <Select
                      aria-label={dt('accountModal.language')}
                      selectedKey={editLanguage}
                      onSelectionChange={(key) => setEditLanguage(key as SupportedLanguage)}
                    >
                      {SUPPORTED_LANGUAGES.map((l) => (
                        <SelectItem key={l.code} id={l.code}>
                          {l.nativeName}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>{dt('accountModal.timezone')}</div>
                    <Select
                      aria-label={dt('accountModal.timezone')}
                      selectedKey={editTimezone ?? SYSTEM_TIMEZONE_KEY}
                      onSelectionChange={(key) => setEditTimezone(key === SYSTEM_TIMEZONE_KEY ? null : String(key))}
                    >
                      <SelectItem id={SYSTEM_TIMEZONE_KEY} textValue={dt('accountModal.systemDefaultShort')}>
                        {dt('accountModal.systemDefault', { zone: SYSTEM_TIME_ZONE, offset: TIME_ZONE_OFFSETS[SYSTEM_TIME_ZONE] ?? '' })}
                      </SelectItem>
                      {SUPPORTED_TIME_ZONES.map((tz) => (
                        <SelectItem key={tz} id={tz} textValue={tz}>
                          {`${tz} (${TIME_ZONE_OFFSETS[tz]})`}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>

                  {/* Appearance applies immediately via toggleTheme — it isn't
                      part of the draft/save flow the rest of this section
                      uses, just co-located here since Preferences absorbed
                      the old standalone Settings tab. */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
                    <div>
                      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>{dt('accountModal.appearance')}</div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>{dt('accountModal.appearanceHint')}</div>
                    </div>
                    <Switch isSelected={theme === 'dark'} onChange={toggleTheme} />
                  </div>

                  {saveProfileError && <Alert variant="urgent">{saveProfileError}</Alert>}

                  <SaveProfileRow
                    isPending={isSavingProfile}
                    canSubmit={canSubmitProfile}
                    justSaved={justSaved}
                    isDirty={isDirty}
                    savedLabel={t('actions.saved')}
                    saveLabel={t('actions.saveChanges')}
                    onSave={() => void handleSaveProfile()}
                  />
                </div>
              )}
            </>
          )}
          {section === 'profile' && (
            <>
              <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as unknown as number }}>
                {dt('accountModal.profile')}
              </div>
              {profileLoading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Skeleton width="60%" height={14} />
                  <Skeleton width="40%" height={14} />
                  <Skeleton width="50%" height={14} />
                </div>
              )}
              {!profileLoading && profileError && <Alert variant="urgent">{profileError}</Alert>}
              {!profileLoading && !profileError && !profile && (
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>{dt('accountModal.profileUnavailable')}</div>
              )}
              {!profileLoading && !profileError && profile && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: '1 1 140px' }}>
                      <TextField
                        className="dash-account-modal__field"
                        label={dt('accountModal.firstName')}
                        value={editFirstName}
                        onChange={(e) => setEditFirstName(e.target.value)}
                        autoComplete="given-name"
                      />
                    </div>
                    <div style={{ flex: '1 1 140px' }}>
                      <TextField
                        className="dash-account-modal__field"
                        label={dt('accountModal.lastName')}
                        value={editLastName}
                        onChange={(e) => setEditLastName(e.target.value)}
                        autoComplete="family-name"
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: '1 1 140px' }}>
                      <Select
                        className="dash-account-modal__field"
                        label={dt('accountModal.gender')}
                        placeholder={dt('accountModal.genderPlaceholder')}
                        selectedKey={editGender}
                        onSelectionChange={setEditGender}
                      >
                        {GENDERS.map((g) => (
                          <SelectItem key={g} id={g}>
                            {dt(`accountModal.gender_${g}`)}
                          </SelectItem>
                        ))}
                      </Select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: '1 1 140px' }}>
                      <Select
                        className="dash-account-modal__field"
                        label={dt('accountModal.country')}
                        placeholder={dt('accountModal.countryPlaceholder')}
                        selectedKey={editCountry}
                        onSelectionChange={setEditCountry}
                      >
                        {COUNTRIES.map((c) => (
                          <SelectItem key={c.code} id={c.code}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </Select>
                    </div>
                    <div style={{ flex: '1 1 140px' }}>
                      <TextField
                        className="dash-account-modal__field"
                        label={dt('accountModal.mobileNumber')}
                        type="tel"
                        value={editMobile}
                        onChange={(e) => setEditMobile(e.target.value)}
                        autoComplete="tel"
                      />
                    </div>
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: -8 }}>
                    {dt('accountModal.mobileHint')}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
                    <div>
                      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>{dt('accountModal.stayAnonymous')}</div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>{dt('accountModal.stayAnonymousHint')}</div>
                    </div>
                    <Switch isSelected={editStayAnonymous} onChange={setEditStayAnonymous} />
                  </div>

                  {saveProfileError && <Alert variant="urgent">{saveProfileError}</Alert>}

                  <SaveProfileRow
                    isPending={isSavingProfile}
                    canSubmit={canSubmitProfile}
                    justSaved={justSaved}
                    isDirty={isDirty}
                    savedLabel={t('actions.saved')}
                    saveLabel={t('actions.saveChanges')}
                    onSave={() => void handleSaveProfile()}
                  />
                </div>
              )}
            </>
          )}
          {section === 'privacy' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as unknown as number }}>
                {t('nav.privacy')}
              </div>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', lineHeight: 'var(--line-height-base)' }}>
                {dt('accountModal.privacyNote')}
              </div>
              <a
                href={publicPagePath('privacy-policy', locale)}
                target="_blank"
                rel="noopener noreferrer"
                className="ds-inline-link"
                style={{ fontSize: 'var(--font-size-sm)' }}
              >
                {dt('accountModal.readFullPrivacyPolicy')}
              </a>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>{dt('accountModal.trainingConsent')}</span>
                    <DialogTrigger>
                      <IconButton
                        icon="!"
                        label={dt('accountModal.trainingConsentInfoLabel')}
                        style={{ width: 20, height: 20, fontSize: 'var(--font-size-xs)' }}
                      />
                      <Popover className="ds-tooltip" placement="top">
                        <Dialog style={{ outline: 'none' }}>{dt('accountModal.trainingConsentInfo')}</Dialog>
                      </Popover>
                    </DialogTrigger>
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>{dt('accountModal.trainingConsentHint')}</div>
                </div>
                <Switch isSelected={editTrainingConsent} onChange={setEditTrainingConsent} />
              </div>

              {saveProfileError && <Alert variant="urgent">{saveProfileError}</Alert>}

              <SaveProfileRow
                isPending={isSavingProfile}
                canSubmit={canSubmitProfile}
                justSaved={justSaved}
                isDirty={isDirty}
                savedLabel={t('actions.saved')}
                saveLabel={t('actions.saveChanges')}
                onSave={() => void handleSaveProfile()}
              />

              <div style={{ borderTop: '0.5px solid var(--border-subtle)', paddingTop: 'var(--space-4)' }}>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                  {dt('accountModal.dataExport')}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 10 }}>
                  {dt('accountModal.dataExportHint')}
                </div>

                {exportError && <Alert variant="urgent">{exportError}</Alert>}

                <Button
                  variant="secondary"
                  isPending={isRequestingExport}
                  isDisabled={hasInFlightExport}
                  onPress={() => void handleRequestExport()}
                >
                  {dt('accountModal.dataExportRequest')}
                </Button>

                {exportRequests && exportRequests.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                    {exportRequests.map((request) => (
                      <div
                        key={request.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          padding: '8px 0',
                          borderTop: '0.5px solid var(--border-subtle)',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                            {new Date(request.requestedAt).toLocaleDateString()}
                          </div>
                          {request.status === 'ready' && request.expiresAt ? (
                            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                              {dt('accountModal.dataExportExpiresOn', { date: new Date(request.expiresAt).toLocaleDateString() })}
                            </div>
                          ) : request.status === 'failed' ? (
                            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--signal-urgent)' }}>
                              {dt('accountModal.dataExportFailed')}
                            </div>
                          ) : request.status === 'expired' ? (
                            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                              {dt('accountModal.dataExportExpired')}
                            </div>
                          ) : null}
                        </div>

                        {request.status === 'ready' ? (
                          <Button
                            variant="ghost"
                            isPending={downloadingId === request.id}
                            onPress={() => void handleDownload(request.id)}
                          >
                            {dt('accountModal.dataExportDownload')}
                          </Button>
                        ) : request.status === 'pending' || request.status === 'processing' ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Spinner size={16} />
                            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                              {dt('accountModal.dataExportPreparing')}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ borderTop: '0.5px solid var(--border-subtle)', paddingTop: 'var(--space-4)' }}>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                  {dt('accountModal.deleteAccount')}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 10 }}>
                  {dt('accountModal.deleteAccountHint')}
                </div>
                <Button variant="urgent" onPress={() => setDeleteAccountConfirmOpen(true)}>
                  {dt('accountModal.deleteAccountButton')}
                </Button>
              </div>
            </div>
          )}
          </div>
        </div>
      </div>

      <Modal
        isOpen={deleteAccountConfirmOpen}
        onOpenChange={(open) => {
          setDeleteAccountConfirmOpen(open)
          if (!open) {
            setDeleteConfirmText('')
            setDeleteAccountError(null)
          }
        }}
        title={dt('accountModal.deleteAccountConfirmTitle')}
      >
        {(close) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <Alert variant="urgent">{dt('accountModal.deleteAccountConfirmBody')}</Alert>
            <TextField
              label={dt('accountModal.deleteAccountConfirmLabel')}
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
            />
            {deleteAccountError && <Alert variant="urgent">{deleteAccountError}</Alert>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button variant="secondary" onPress={close}>
                {dt('accountModal.deleteAccountConfirmCancel')}
              </Button>
              <Button
                variant="urgent"
                isPending={isDeletingAccount}
                isDisabled={deleteConfirmText !== 'DELETE'}
                onPress={() => void handleDeleteAccount()}
              >
                {dt('accountModal.deleteAccountConfirmAccept')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Modal>
  )
}
