import { useTranslation } from 'react-i18next'
import { LinkButton } from '../LinkButton'
import { SiteHeader } from '../SiteHeader'
import { SiteFooter } from '../SiteFooter'
import { publicPagePath } from '../publicPages/pages'
import { useLocale } from '../App'
import { useDocumentTitle } from '../useDocumentTitle'

// Shown for any URL whose locale segment names a real (locale-shaped,
// supported-language) market that isn't in OPERATING_MARKETS (locale.ts)
// — i.e. someone forced a market through the URL that MinCirklen doesn't
// actually run in yet. The CTA links to the contact page, which is the
// one route App.tsx's router deliberately leaves reachable even in a
// non-operating market (see parseRoute's isContactPage carve-out) — the
// whole point of this page is to still give a blocked visitor a way to
// ask for their region.
export function MarketUnavailablePage() {
  const { t } = useTranslation('errors')
  const locale = useLocale()
  useDocumentTitle(`${t('marketUnavailable.title')} — MinCirklen`)

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
            <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-primary)' }}>
              {t('marketUnavailable.title')}
            </div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 6 }}>
              {t('marketUnavailable.message', { market: locale.market })}
            </div>
          </div>

          <div>
            <LinkButton href={publicPagePath('contact', locale)}>{t('marketUnavailable.contactCta')}</LinkButton>
          </div>
        </div>
      </div>

      <SiteFooter />
    </div>
  )
}
