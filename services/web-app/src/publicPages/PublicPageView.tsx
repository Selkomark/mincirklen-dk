import { PublicHeader } from '../PublicHeader'
import { SiteFooter } from '../SiteFooter'
import { usePageMeta } from '../usePageMeta'
import { useJsonLd } from '../useJsonLd'
import { SITE_ORIGIN } from '../siteConfig'
import { PUBLIC_PAGES, publicPagePath, type PublicPageId } from './pages'

export function PublicPageView({ id }: { id: PublicPageId }) {
  const page = PUBLIC_PAGES[id]
  const path = publicPagePath(id)

  usePageMeta({
    title: `${page.title} — MinCirklen`,
    description: page.intro,
    path,
    type: 'article',
  })

  useJsonLd({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.title,
    description: page.intro,
    url: `${SITE_ORIGIN}${path}`,
    isPartOf: { '@type': 'WebSite', name: 'MinCirklen', url: SITE_ORIGIN },
  })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface-app)', fontFamily: 'var(--font-family-base)' }}>
      <PublicHeader />

      <main
        style={{
          maxWidth: 640,
          margin: '0 auto',
          padding: 'clamp(24px, 6vw, 48px) clamp(16px, 5vw, 24px) 80px',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-6)',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as unknown as number, color: 'var(--text-primary)' }}>
            {page.title}
          </h1>
          <div style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-secondary)', marginTop: 'var(--space-3)', lineHeight: 'var(--line-height-base)' }}>
            {page.intro}
          </div>
        </div>

        {page.urgent && (
          <div
            style={{
              background: 'var(--signal-urgent-surface)',
              border: '1px solid var(--signal-urgent)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-4)',
              color: 'var(--signal-urgent)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--font-weight-medium)' as unknown as number,
            }}
          >
            If you or someone else is in immediate danger, contact your local emergency number right away — don't wait for a session or a report to be reviewed.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {page.sections.map((s) => (
            <div key={s.heading}>
              <h2 style={{ margin: 0, marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as unknown as number, color: 'var(--text-primary)' }}>
                {s.heading}
              </h2>
              <div style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-secondary)', lineHeight: 'var(--line-height-base)' }}>
                {s.body}
              </div>
            </div>
          ))}
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
