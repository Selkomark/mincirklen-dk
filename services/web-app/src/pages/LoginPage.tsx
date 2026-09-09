import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { Alert } from '../components/Alert'
import { publicPagePath } from '../publicPages/pages'
import { SiteHeader } from '../SiteHeader'
import { SiteFooter } from '../SiteFooter'
import { GoogleIcon } from '../GoogleIcon'
import { useDocumentTitle } from '../useDocumentTitle'

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

function loginErrorKey(): string | null {
  const code = new URLSearchParams(window.location.search).get('error')
  if (!code) return null
  return LOGIN_ERROR_KEYS[code] ?? LOGIN_ERROR_KEYS.login_failed ?? null
}

// Google is the only working provider. The others are kept (not deleted)
// but hidden behind this flag so the layout/code is ready to re-enable
// them once they're wired up — flip to true, don't re-add the list.
const SHOW_OTHER_PROVIDERS = false

const OTHER_PROVIDERS = [
  { id: 'apple', labelKey: 'otherProviders.apple' },
  { id: 'microsoft', labelKey: 'otherProviders.microsoft' },
]

export function LoginPage() {
  const { t } = useTranslation('auth')
  useDocumentTitle(t('login.documentTitle'))
  const errorKey = loginErrorKey()

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
            {errorKey && <Alert variant="urgent">{t(errorKey)}</Alert>}

            <Button
              variant="secondary"
              onPress={() => {
                window.location.href = '/api/auth/google/start'
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
            <a href={publicPagePath('terms-and-conditions')} className="ds-inline-link">
              {t('login.termsAndConditions')}
            </a>{' '}
            {t('login.and')}{' '}
            <a href={publicPagePath('privacy-policy')} className="ds-inline-link">
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
