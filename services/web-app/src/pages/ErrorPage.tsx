import { useTranslation } from 'react-i18next'
import { LinkButton } from '../LinkButton'
import { SiteHeader } from '../SiteHeader'
import { SiteFooter } from '../SiteFooter'
import { landingPath } from '../App'
import { useDocumentTitle } from '../useDocumentTitle'

// Shared shell for every full-page error state (404 not-found, the 500
// ErrorBoundary catches, and any future status the app needs its own
// page for) — one layout, one recovery action, so a new error case is a
// one-line call site rather than a new near-duplicate page file.
export function ErrorPage({ code, title, message }: { code: number; title: string; message: string }) {
  const { t } = useTranslation('errors')
  useDocumentTitle(`${title} — MinCirklen`)

  return (
    <div style={{ minHeight: '100vh', fontFamily: 'var(--font-family-base)' }}>
      <SiteHeader />

      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: 'clamp(20px, 6vw, 64px) clamp(16px, 5vw, 24px)',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 'clamp(20px, 4vw, 28px)', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-secondary)', letterSpacing: '0.04em' }}>
              {t('errorCode', { code })}
            </div>
            <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-primary)', marginTop: 4 }}>
              {title}
            </div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 6 }}>{message}</div>
          </div>

          <div>
            <LinkButton href={landingPath()}>{t('backToHome')}</LinkButton>
          </div>
        </div>
      </div>

      <SiteFooter />
    </div>
  )
}
