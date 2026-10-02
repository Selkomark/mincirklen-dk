import { useState, type FormEvent } from 'react'
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
import { TextField } from './components/TextField'
import { Button } from './components/Button'
import { Alert } from './components/Alert'
import { publicPagePath } from './publicPages/pages'
import { loginPath, landingPath, useLocale } from './App'
import { SiteHeader, WAITLIST_ANCHOR_ID } from './SiteHeader'
import { SiteFooter } from './SiteFooter'
import { LinkButton } from './LinkButton'
import { usePageMeta } from './usePageMeta'
import { useJsonLd } from './useJsonLd'
import { SITE_ORIGIN, SITE_NAME } from './siteConfig'
import { postTrpc } from './gateShared'
import heroImage from './assets/hero-circle.webp'

type SubmitState = { kind: 'idle' } | { kind: 'submitting' } | { kind: 'done' } | { kind: 'error' }

// The hero's primary CTA while platform_launch is invite-only — same
// hero/header/footer chrome as the real landing page, "basically the
// same page" per the request, not a separate route/component tree.
// Every other CTA on this page (pricing, the closing section) points
// here too via `ctaHref` once waitlistMode is on, rather than at
// loginPath — a gated visitor should never be offered a path toward
// Google login, only toward the waitlist itself.
function WaitlistForm() {
  const { t } = useTranslation('landing')
  const locale = useLocale()
  const [email, setEmail] = useState('')
  const [state, setState] = useState<SubmitState>({ kind: 'idle' })

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!email.trim() || state.kind === 'submitting') return
    setState({ kind: 'submitting' })
    try {
      await postTrpc('gates.submitSignup', { gateKey: 'platform_launch', email })
      setState({ kind: 'done' })
    } catch {
      setState({ kind: 'error' })
    }
  }

  // A stable id, present regardless of submission state — every other
  // CTA on this page while gated (pricing cards, the closing section,
  // via `ctaHref` below) scrolls straight here (WAITLIST_ANCHOR_ID), so
  // the target must still resolve even after a successful submit
  // collapses the form down to just the success message. SiteHeader
  // used to have its own copy of this same anchor link; removed as
  // redundant with this form being the page's own, more prominent call
  // to action.
  return (
    <div id={WAITLIST_ANCHOR_ID} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420, scrollMarginTop: 96 }}>
      {state.kind === 'done' ? (
        <Alert variant="safe">{t('waitlist.success')}</Alert>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} noValidate>
          {/* A real <form> so Enter in the email field submits, matching
              what every browser trains users to expect; the DS Button
              below is type="submit" for the same reason. noValidate keeps
              the browser's own email bubble out of the way — the server
              validates, and the inline Alert reports failures. */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 240px' }}>
              <TextField
                label={t('waitlist.emailLabel')}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('waitlist.emailPlaceholder')}
              />
            </div>
            {/* Grouped so the button and link wrap onto their own line
                together at narrow widths, instead of the link wrapping
                alone underneath the email field — and alignItems:
                'flex-end' on the row above lines this group up with the
                input itself, not the "Email address" label towering
                over it. alignItems: 'center' here (not on the outer
                row) centers the plain-text link against the much taller
                button next to it, deliberately a lighter-weight text
                link rather than a second button — "Join the waitlist"
                is the one real action on this form. */}
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <Button type="submit" variant="safe" isPending={state.kind === 'submitting'}>
                {t('waitlist.submit')}
              </Button>
              <a href={publicPagePath('how-it-works', locale)} className="ds-inline-link">
                {t('waitlist.howItWorksLink')}
              </a>
            </div>
          </div>
          {state.kind === 'error' && <Alert variant="urgent">{t('waitlist.error')}</Alert>}
        </form>
      )}
    </div>
  )
}

export function LandingPage({ waitlistMode = false }: { waitlistMode?: boolean }) {
  const { t } = useTranslation('landing')
  const locale = useLocale()
  // Every other CTA on this page (pricing cards, the closing section)
  // uses this instead of a bare loginPath(locale) once waitlistMode is
  // on — otherwise they'd still send a gated visitor toward a Google
  // login button that leads nowhere real (see SiteHeader.tsx's identical
  // reasoning for its own CTA).
  const ctaHref = waitlistMode ? `#${WAITLIST_ANCHOR_ID}` : loginPath(locale)
  const pageUrl = `${SITE_ORIGIN}${landingPath(locale)}`
  const imageUrl = `${SITE_ORIGIN}${heroImage}`
  // Real hreflang alternates now (see usePageMeta.ts) — a crawler
  // fetching any one locale's URL can discover every other language's
  // canonical URL for this same page. The tab title/meta description
  // still tracks whatever language the current visitor is actually
  // looking at, same as before.
  const description = t('meta.description')

  usePageMeta({
    title: t('meta.title'),
    description,
    locale,
    pagePath: '',
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
        <Badge variant="safe">{waitlistMode ? t('waitlist.badge') : t('hero.badge')}</Badge>
        <Heading level={1}>{t('hero.title')}</Heading>
        <Text variant="lead">{waitlistMode ? t('waitlist.lead') : t('hero.lead')}</Text>
        {waitlistMode ? (
          <WaitlistForm />
        ) : (
          <div style={{ display: 'flex', gap: 12 }}>
            <LinkButton href={loginPath(locale)}>{t('hero.joinCircle')}</LinkButton>
            <LinkButton href={publicPagePath('how-it-works', locale)} variant="secondary">
              {t('hero.learnMore')}
            </LinkButton>
          </div>
        )}
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
                <LinkButton href={ctaHref} variant="secondary" style={{ width: '100%' }}>
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
                <LinkButton href={ctaHref} style={{ width: '100%' }}>
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
          <LinkButton href={ctaHref} variant="secondary">
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
