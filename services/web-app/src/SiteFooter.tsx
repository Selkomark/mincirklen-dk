import { useTranslation } from 'react-i18next'
import { Footer, FooterColumn } from './components/Footer'
import { publicPagePath } from './publicPages/pages'
import { startPath, moderationTransparencyPath } from './App'
import { showCookiePreferences } from './CookieConsentBanner'

export function SiteFooter() {
  const { t } = useTranslation('landing')
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
        <a href={startPath()}>{t('footer.circles')}</a>
        <a href={publicPagePath('how-it-works')}>{t('footer.howItWorks')}</a>
        <a href={publicPagePath('pricing')}>{t('footer.pricing')}</a>
        <a href={publicPagePath('safety-and-moderation')}>{t('footer.safety')}</a>
        <a href={moderationTransparencyPath()}>{t('footer.moderationTransparency')}</a>
      </FooterColumn>
      <FooterColumn title={t('footer.company')}>
        <a href={publicPagePath('about')}>{t('footer.about')}</a>
        <a href={publicPagePath('facilitators')}>{t('footer.facilitators')}</a>
      </FooterColumn>
      <FooterColumn title={t('footer.support')}>
        <a href={publicPagePath('crisis-resources')}>{t('footer.crisisResources')}</a>
        <a href={publicPagePath('account-and-data')}>{t('footer.accountAndData')}</a>
        <a href={publicPagePath('contact')}>{t('footer.contact')}</a>
      </FooterColumn>
      <FooterColumn title={t('footer.legal')}>
        <a href={publicPagePath('privacy-policy')}>{t('footer.privacyPolicy')}</a>
        <a href={publicPagePath('community-guidelines')}>{t('footer.communityGuidelines')}</a>
        <a href={publicPagePath('terms-and-conditions')}>{t('footer.termsAndConditions')}</a>
      </FooterColumn>
    </Footer>
  )
}
