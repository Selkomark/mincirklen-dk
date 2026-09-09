import { useTranslation } from 'react-i18next'
import { Badge } from './components/Badge'
import { Row } from './components/Row'
import { Col } from './components/Col'
import { Heading } from './components/Heading'
import { Text } from './components/Text'
import { Section } from './components/Section'
import { Hero } from './components/Hero'
import { Feature } from './components/Feature'
import { Testimonial } from './components/Testimonial'
import { Stat } from './components/Stat'
import { CTASection } from './components/CTASection'
import { PricingCard } from './components/PricingCard'
import { publicPagePath } from './publicPages/pages'
import { loginPath, landingPath } from './App'
import { SiteHeader } from './SiteHeader'
import { SiteFooter } from './SiteFooter'
import { LinkButton } from './LinkButton'
import { usePageMeta } from './usePageMeta'
import { useJsonLd } from './useJsonLd'
import { SITE_ORIGIN, SITE_NAME } from './siteConfig'
import heroImage from './assets/hero-circle.webp'

export function LandingPage() {
  const { t } = useTranslation('landing')
  const pageUrl = `${SITE_ORIGIN}${landingPath()}`
  const imageUrl = `${SITE_ORIGIN}${heroImage}`
  // No hreflang routing (one canonical URL for every language), so a
  // crawler doing a single fetch still only ever sees whichever language
  // it happened to request — but a real visitor's browser tab
  // title/meta should match whatever language they're actually looking
  // at, so this is translated the same as the page body rather than
  // left as a permanent English snapshot.
  const description = t('meta.description')

  usePageMeta({
    title: t('meta.title'),
    description,
    path: landingPath(),
    image: imageUrl,
  })

  useJsonLd({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: SITE_NAME,
        url: pageUrl,
        description,
        logo: imageUrl,
      },
      {
        '@type': 'WebSite',
        name: SITE_NAME,
        url: pageUrl,
        description,
      },
    ],
  })

  return (
    <div>
      <SiteHeader />

      <Hero
        align="left"
        media={
          <img
            src={heroImage}
            width={640}
            height={640}
            alt={t('hero.imageAlt')}
            // Lowercase via spread, not a typed fetchPriority prop — this
            // React version (18.3) doesn't recognize the camelCase prop yet
            // (that mapping arrived in React 19) and warns on it; lowercase
            // passes straight through as the plain HTML attribute, which
            // browsers honor regardless. The Record<string, string> spread
            // sidesteps ImgHTMLAttributes not knowing this key yet either.
            {...({ fetchpriority: 'high' } as Record<string, string>)}
          />
        }
      >
        <Badge variant="safe">{t('hero.badge')}</Badge>
        <Heading level={1}>{t('hero.title')}</Heading>
        <Text variant="lead">{t('hero.lead')}</Text>
        <div style={{ display: 'flex', gap: 12 }}>
          <LinkButton href={loginPath()}>{t('hero.joinCircle')}</LinkButton>
          <LinkButton href={publicPagePath('how-it-works')} variant="secondary">
            {t('hero.learnMore')}
          </LinkButton>
        </div>
      </Hero>

      <Section tone="raised" spacing="lg">
        <Row>
          <Col span={12} md={6}>
            <Stat value={t('stats.anonymousValue')} label={t('stats.anonymousLabel')} />
          </Col>
          <Col span={12} md={6}>
            <Stat value={t('stats.zeroValue')} label={t('stats.zeroLabel')} />
          </Col>
        </Row>
      </Section>

      <Section tone="app" spacing="xl">
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-7)' }}>
          <Heading level={2}>{t('features.title')}</Heading>
          <Text variant="lead" style={{ marginTop: 'var(--space-2)' }}>
            {t('features.lead')}
          </Text>
        </div>
        <Row gap={6}>
          <Col span={12} md={4}>
            <Feature icon="🛡" title={t('features.moderatedTitle')}>
              {t('features.moderatedBody')}
            </Feature>
          </Col>
          <Col span={12} md={4}>
            <Feature icon="🤝" title={t('features.anonymousTitle')}>
              {t('features.anonymousBody')}
            </Feature>
          </Col>
          <Col span={12} md={4}>
            <Feature icon="🕊" title={t('features.noPressureTitle')}>
              {t('features.noPressureBody')}
            </Feature>
          </Col>
        </Row>
      </Section>

      <Section tone="sunken" spacing="xl">
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-7)' }}>
          <Heading level={2}>{t('testimonial.title')}</Heading>
        </div>
        <Row>
          <Col span={12} md={8} style={{ margin: '0 auto' }}>
            <Testimonial quote={t('testimonial.quote')} name="Mahan Sagharchi" role={t('testimonial.role')} />
          </Col>
        </Row>
      </Section>

      <Section tone="app" spacing="xl">
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-7)' }}>
          <Heading level={2}>{t('pricing.title')}</Heading>
          <Text variant="lead" style={{ marginTop: 'var(--space-2)' }}>
            {t('pricing.lead')}
          </Text>
        </div>
        <Row gap={6}>
          <Col span={12} md={6}>
            <PricingCard
              name={t('pricing.freeName')}
              price={t('pricing.freePrice')}
              features={[t('pricing.freeFeature1'), t('pricing.freeFeature2'), t('pricing.freeFeature3')]}
              cta={
                <LinkButton href={loginPath()} variant="secondary" style={{ width: '100%' }}>
                  {t('pricing.getStarted')}
                </LinkButton>
              }
            />
          </Col>
          <Col span={12} md={6}>
            <PricingCard
              name={t('pricing.supportName')}
              price={t('pricing.supportPrice')}
              period={t('pricing.supportPeriod')}
              features={[t('pricing.supportFeature1'), t('pricing.supportFeature2'), t('pricing.supportFeature3')]}
              cta={
                <LinkButton href={loginPath()} style={{ width: '100%' }}>
                  {t('pricing.getStarted')}
                </LinkButton>
              }
              highlighted
            />
          </Col>
        </Row>
      </Section>

      <CTASection
        title={t('cta.title')}
        actions={
          <LinkButton href={loginPath()} variant="secondary">
            {t('cta.action')}
          </LinkButton>
        }
      >
        {t('cta.body')}
      </CTASection>

      <SiteFooter />
    </div>
  )
}
