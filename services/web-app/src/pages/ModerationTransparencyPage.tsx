import { useEffect, useState, type ReactNode } from 'react'
import { PublicHeader } from '../PublicHeader'
import { SiteFooter } from '../SiteFooter'
import { Button } from '../components/Button'
import { Alert } from '../components/Alert'
import { GitHubIcon } from '../GitHubIcon'
import { usePageMeta } from '../usePageMeta'
import { useJsonLd } from '../useJsonLd'
import { SITE_ORIGIN } from '../siteConfig'
import { moderationTransparencyPath } from '../App'

interface TransparencyMetrics {
  falsePositiveRate: number | null
  falseNegativeRate: number | null
  incidentsReviewed: number
}

function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

// Fetched from moderation.transparencyMetrics — public, aggregate-only, no
// auth needed (see services/trpc-api/src/controllers/moderationRouter.ts).
// Falls back to "—" everywhere on a fetch failure, same as "no data yet" —
// this section never has anything urgent to say if it can't load.
function useTransparencyMetrics(): TransparencyMetrics | null {
  const [metrics, setMetrics] = useState<TransparencyMetrics | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/trpc/moderation.transparencyMetrics')
        if (!res.ok) return
        const body = (await res.json()) as { result: { data: TransparencyMetrics } }
        if (!cancelled) setMetrics(body.result.data)
      } catch {
        // Stays null — rendered the same as "no data yet".
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return metrics
}

const PLATFORM_REPO_URL = 'https://github.com/Selkomark/MinCirklen.dk'

const ACCESS_REQUEST_EMAIL = 'mahan@selkomark.com'
const ACCESS_REQUEST_SUBJECT = 'MinCirklen Source Access Request'
// Fixed subject line + labeled body so requests stay easy to filter and triage on
// the receiving end (email rules, or an AI pass) without needing an in-app intake form.
const ACCESS_REQUEST_BODY = `Organization name:


Organization type (NGO / registered nonprofit, university or research institution, government health body, or accredited safety researcher):


Stated purpose (audit, self-hosting evaluation, academic research, etc.):


Named contact (full name and email):
`

const ACCESS_REQUEST_MAILTO = `mailto:${ACCESS_REQUEST_EMAIL}?subject=${encodeURIComponent(ACCESS_REQUEST_SUBJECT)}&body=${encodeURIComponent(ACCESS_REQUEST_BODY)}`

const DESCRIPTION =
  'How MinCirklen keeps circles safe, what stays private and why, and how an outside organization can independently verify the crisis-escalation guarantee.'

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 style={{ margin: 0, marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-primary)' }}>
      {children}
    </h2>
  )
}

function Body({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-secondary)', lineHeight: 'var(--line-height-base)', marginBottom: 'var(--space-3)' }}>
      {children}
    </div>
  )
}

export function ModerationTransparencyPage() {
  const path = moderationTransparencyPath()
  const metrics = useTransparencyMetrics()

  usePageMeta({
    title: 'Moderation & Transparency — MinCirklen',
    description: DESCRIPTION,
    path,
    type: 'article',
  })

  useJsonLd({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Moderation & Transparency',
    description: DESCRIPTION,
    url: `${SITE_ORIGIN}${path}`,
    isPartOf: { '@type': 'WebSite', name: 'MinCirklen', url: SITE_ORIGIN },
  })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface-app)', fontFamily: 'var(--font-family-base)' }}>
      <PublicHeader />

      <main
        style={{
          maxWidth: 680,
          margin: '0 auto',
          padding: 'clamp(24px, 6vw, 48px) clamp(16px, 5vw, 24px) 80px',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-7)',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-primary)' }}>
            Moderation & Transparency
          </h1>
          <div style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-secondary)', marginTop: 'var(--space-3)', lineHeight: 'var(--line-height-base)' }}>
            How we keep circles safe, what we do and don't make public about it, and how an outside
            organization can independently verify our biggest safety claim.
          </div>
        </div>

        <section>
          <SectionHeading>The platform code</SectionHeading>
          <Body>
            The application and UI you're using — everything except the moderation service itself — is
            open source. Any organization can read it, audit it, or self-host their own instance for
            full data privacy.
          </Body>
          <a
            href={PLATFORM_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="ds-button ds-button--secondary"
            style={{ textDecoration: 'none', width: 'fit-content' }}
          >
            <GitHubIcon />
            View on GitHub
          </a>
        </section>

        <section>
          <SectionHeading>How moderation works</SectionHeading>
          <Body>
            Every message in a circle passes through automated moderation before a human ever needs to
            see it, tuned to catch four categories of harmful content:
          </Body>
          <ul style={{ margin: 0, marginBottom: 'var(--space-3)', paddingLeft: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <li style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-secondary)', lineHeight: 'var(--line-height-base)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>Predatory contact</strong> — attempts to
              extract contact details, groom, or move a conversation off-platform
            </li>
            <li style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-secondary)', lineHeight: 'var(--line-height-base)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>Solicitation</strong> — advertising,
              recruiting, scams, or using the space for anything other than peer support
            </li>
            <li style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-secondary)', lineHeight: 'var(--line-height-base)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>Crisis language</strong> — signs of
              self-harm, suicidal ideation, or a risk to someone else
            </li>
            <li style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-secondary)', lineHeight: 'var(--line-height-base)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>Harassment</strong> — abuse directed at
              another user
            </li>
          </ul>
          <Body>
            We publish what we look for, not how we look for it. The exact detection rules, thresholds,
            and prompts stay private — publishing them would hand a blueprint to the people most
            motivated to slip past detection.
          </Body>
        </section>

        <section>
          <SectionHeading>The escalation guarantee</SectionHeading>
          <Body>
            If moderation ever flags crisis language, it always triggers the same fixed response: a
            crisis-resource card shown immediately, and a human reviewer alerted. Every time, without
            exception.
          </Body>
          <Body>
            This doesn't run through the part of the system that makes judgment calls. It's a separate,
            hard-wired path with no discretion built in — the model can't override it, delay it, or
            decide it isn't serious enough.
          </Body>
          <Alert variant="safe">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <span>
                We think a guarantee like this shouldn't rest on "trust us" alone — so unlike the rest of
                our moderation system, the escalation-routing code itself is meant to be open source and
                independently auditable, kept separate from anything that does content detection.
              </span>
              <div>
                <Button variant="secondary" isDisabled>
                  View escalation-routing code
                </Button>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 6 }}>
                  Not public yet — we're an early pilot and this repository isn't live. This will link
                  directly to it the moment it is.
                </div>
              </div>
            </div>
          </Alert>
        </section>

        <section>
          <SectionHeading>Transparency metrics</SectionHeading>
          <Body>
            Our moderation false-positive and false-negative rates and a running summary of safety
            incidents — kept current, not published once and forgotten. We don't publish placeholder
            numbers dressed up as real ones: a rate reads as "—" until there's enough reviewed data
            behind it to mean something.
          </Body>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-4)' }}>
            {[
              { label: 'False-positive rate', value: formatRate(metrics?.falsePositiveRate ?? null) },
              { label: 'False-negative rate', value: formatRate(metrics?.falseNegativeRate ?? null) },
              { label: 'Incidents reviewed', value: metrics ? String(metrics.incidentsReviewed) : '—' },
            ].map((metric) => (
              <div
                key={metric.label}
                style={{
                  border: '1px dashed var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-4)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-secondary)' }}>
                  {metric.value}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 4 }}>{metric.label}</div>
              </div>
            ))}
          </div>
          {(metrics?.incidentsReviewed ?? 0) === 0 && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 'var(--space-3)' }}>
              No pilot data yet.
            </div>
          )}
        </section>

        <section>
          <SectionHeading>Request independent verification</SectionHeading>
          <Body>
            Organizations with a genuine safety or public-work affiliation — NGOs, universities and
            research institutions, government health bodies, or accredited safety researchers — can
            request gated access to the moderation source for audit or evaluation purposes.
          </Body>
          <Body>
            This is a request, not a grant. Every request is reviewed manually — there's no automated
            approval. Access, if granted, follows a legal agreement (an NDA and acceptable-use terms)
            that we haven't published yet, since it's still being drafted with a lawyer.
          </Body>

          <a href={ACCESS_REQUEST_MAILTO} className="ds-button ds-button--safe" style={{ textDecoration: 'none', width: 'fit-content' }}>
            Email a request
          </a>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 6 }}>
            Opens your email client with a template addressed to {ACCESS_REQUEST_EMAIL} — organization
            name, type, stated purpose, and a named contact.
          </div>
        </section>

        <section>
          <SectionHeading>Where this falls short</SectionHeading>
          <Body>
            This is controlled transparency, not full transparency. It satisfies "independently
            verifiable" for organizations willing to request access, but a skeptical funder, journalist,
            or user can fairly characterize it as "trust us, but only for the vetted few." That's a
            real trade-off, not a solved problem — we'd rather say so plainly than have someone catch us
            not saying it.
          </Body>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
