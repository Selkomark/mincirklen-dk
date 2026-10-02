import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { Alert } from '../components/Alert'
import { publicPagePath } from '../publicPages/pages'
import { SiteHeader } from '../SiteHeader'
import { SiteFooter } from '../SiteFooter'
import { GoogleIcon } from '../GoogleIcon'
import { useDocumentTitle } from '../useDocumentTitle'
import { useLocale } from '../App'

// oauthController.ts's callback redirects here with ?error=<code> instead
// of ever showing its own error page — this is the only place that code
// is translated into copy a user can act on. Keyed to i18n keys, not
// literal English strings — resolved via t() in the component below.
const LOGIN_ERROR_KEYS: Record<string, string> = {
  oauth_state: 'errors.oauthState',
  google_failed: 'errors.googleFailed',
  login_failed: 'errors.loginFailed',
  account_banned: 'errors.accountBanned',
}

function loginErrorCode(): string | null {
  return new URLSearchParams(window.location.search).get('error')
}

function loginErrorKey(): string | null {
  const code = loginErrorCode()
  if (!code) return null
  return LOGIN_ERROR_KEYS[code] ?? LOGIN_ERROR_KEYS.login_failed ?? null
}

// A closed account gets a statement, not an error alert: a large mark,
// that the account was closed for breaking the terms (never the specific
// reason — that's between us and the person, by email), and where to ask
// for the record behind it (docs/gdpr-runbook.md). The sign-in card stays
// fully usable underneath: a shared machine — a library, a school — may
// well have someone else signing in next.
function BannedNotice({ locale }: { locale: ReturnType<typeof useLocale> }) {
  const { t } = useTranslation('auth')
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-5) var(--space-4)',
        background: 'var(--surface-raised)',
        border: '0.5px solid var(--signal-urgent)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 72,
          height: 72,
          borderRadius: 'var(--radius-full)',
          background: 'var(--signal-urgent-surface)',
          color: 'var(--signal-urgent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
          <path d="M5.6 5.6l12.8 12.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </div>
      <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-primary)' }}>{t('banned.title')}</div>
      <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 'var(--line-height-base)' }}>{t('banned.body')}</p>
      <a href={`${publicPagePath('privacy-policy', locale)}#closed-accounts`} className="ds-inline-link" style={{ fontSize: 'var(--font-size-sm)' }}>
        {t('banned.recordLink')}
      </a>
    </div>
  )
}

// Set by manage/sessionExpiry.ts's hard redirect when a /manage session
// expires mid-use (idle timeout or any other cause of a 401) — carries
// the exact page to return to once re-authenticated. Deliberately a
// separate param from `nextPath` below, not folded into it: `nextPath`
// only ever names the bare /manage root (App.tsx's inline login), while
// this names an arbitrary sub-path captured at the moment of expiry.
// Validated as a same-origin relative path (leading single slash, no
// scheme/host) before ever being trusted — never pass an unvalidated
// query param straight into a redirect target.
function returnToParam(): string | null {
  const raw = new URLSearchParams(window.location.search).get('returnTo')
  if (!raw) return null
  return /^\/(?!\/)[A-Za-z0-9/_\-.~:?&=%]*$/.test(raw) ? raw : null
}

// Google is the only working provider. The others are kept (not deleted)
// but hidden behind this flag so the layout/code is ready to re-enable
// them once they're wired up — flip to true, don't re-add the list.
const SHOW_OTHER_PROVIDERS = false

const OTHER_PROVIDERS = [
  { id: 'apple', labelKey: 'otherProviders.apple' },
  { id: 'microsoft', labelKey: 'otherProviders.microsoft' },
]

export interface LoginPageProps {
  // Set only by /manage's inline login (App.tsx) — appended to the
  // Google OAuth start request so oauthController.ts's callback lands
  // the browser back on /manage instead of the default /p once signed
  // in. Every other LoginPage render (the shared /login route) omits
  // this and gets the default.
  nextPath?: string
}

export function LoginPage({ nextPath }: LoginPageProps = {}) {
  const { t } = useTranslation('auth')
  const locale = useLocale()
  useDocumentTitle(t('login.documentTitle'))
  const errorKey = loginErrorKey()
  const isBanned = loginErrorCode() === 'account_banned'
  // returnTo (an idle-expiry redirect's exact sub-path) takes precedence
  // over nextPath (always just the bare /manage root) — nextPath winning
  // would silently discard the specific page a user was bounced from.
  const effectiveNext = returnToParam() ?? nextPath

  return (
    <div style={{ minHeight: '100vh', fontFamily: 'var(--font-family-base)' }}>
      <SiteHeader showJoinCta={false} />

      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: 'clamp(20px, 6vw, 64px) clamp(16px, 5vw, 24px)',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 'clamp(20px, 4vw, 28px)' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-primary)' }}>
              {t('login.title')}
            </div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 6 }}>
              {t('login.subtitle')}
            </div>
          </div>

          {isBanned && <BannedNotice locale={locale} />}

          <div
            style={{
              background: 'var(--surface-raised)',
              border: '0.5px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: 'clamp(20px, 4vw, 32px)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {errorKey && !isBanned && <Alert variant="urgent">{t(errorKey)}</Alert>}

            <Button
              variant="secondary"
              onPress={() => {
                window.location.href = effectiveNext
                  ? `/api/auth/google/start?next=${encodeURIComponent(effectiveNext)}`
                  : '/api/auth/google/start'
              }}
              style={{ width: '100%' }}
            >
              <GoogleIcon />
              {t('login.continueWithGoogle')}
            </Button>

            {SHOW_OTHER_PROVIDERS &&
              OTHER_PROVIDERS.map((provider) => (
                <Button
                  key={provider.id}
                  variant="secondary"
                  isDisabled
                  style={{ width: '100%', justifyContent: 'space-between' }}
                >
                  <span>{t(provider.labelKey)}</span>
                  <span style={{ fontSize: 'var(--font-size-xs)' }}>{t('login.comingSoon')}</span>
                </Button>
              ))}

            <Alert variant="safe" style={{ marginTop: 8 }}>
              {t('login.privacyNote')}
            </Alert>
          </div>

          <div style={{ textAlign: 'center', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
            {t('login.agreeToTermsPrefix')}{' '}
            <a href={publicPagePath('terms-and-conditions', locale)} className="ds-inline-link">
              {t('login.termsAndConditions')}
            </a>{' '}
            {t('login.and')}{' '}
            <a href={publicPagePath('privacy-policy', locale)} className="ds-inline-link">
              {t('login.privacyPolicy')}
            </a>
            .
          </div>
        </div>
      </div>

      <SiteFooter />
    </div>
  )
}
