import { useTranslation } from 'react-i18next'
import { Footer, FooterColumn } from './components/Footer'
import { publicPagePath } from './publicPages/pages'
import { pPath, moderationTransparencyPath, useLocale } from './App'
import { showCookiePreferences } from './CookieConsentBanner'
import { X_URL } from './siteConfig'

export function SiteFooter() {
  const { t } = useTranslation('landing')
  const locale = useLocale()
  return (
    <Footer
      bottom={
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-4)' }}>
          <span>{t('footer.copyright')}</span>
          <button
            type="button"
            onClick={showCookiePreferences}
            className="ds-inline-link"
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' }}
          >
            {t('footer.cookiePreferences')}
          </button>
        </div>
      }
    >
      <FooterColumn title={t('footer.product')}>
        <a href={pPath(locale)}>{t('footer.circles')}</a>
        <a href={publicPagePath('how-it-works', locale)}>{t('footer.howItWorks')}</a>
        <a href={publicPagePath('pricing', locale)}>{t('footer.pricing')}</a>
        <a href={publicPagePath('safety-and-moderation', locale)}>{t('footer.safety')}</a>
        <a href={moderationTransparencyPath(locale)}>{t('footer.moderationTransparency')}</a>
      </FooterColumn>
      <FooterColumn title={t('footer.company')}>
        <a href={publicPagePath('about', locale)}>{t('footer.about')}</a>
        <a href={publicPagePath('facilitators', locale)}>{t('footer.facilitators')}</a>
      </FooterColumn>
      <FooterColumn title={t('footer.support')}>
        <a href={publicPagePath('crisis-resources', locale)}>{t('footer.crisisResources')}</a>
        <a href={publicPagePath('account-and-data', locale)}>{t('footer.accountAndData')}</a>
        <a href={publicPagePath('contact', locale)}>{t('footer.contact')}</a>
        <a
          href={X_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          {t('footer.followOnX')}
        </a>
      </FooterColumn>
      <FooterColumn title={t('footer.legal')}>
        <a href={publicPagePath('privacy-policy', locale)}>{t('footer.privacyPolicy')}</a>
        <a href={publicPagePath('community-guidelines', locale)}>{t('footer.communityGuidelines')}</a>
        <a href={publicPagePath('terms-and-conditions', locale)}>{t('footer.termsAndConditions')}</a>
      </FooterColumn>
    </Footer>
  )
}
