import { Container } from './components/Container'
import { ThemeToggle } from './ThemeToggle'
import { LanguageSwitcher } from './LanguageSwitcher'

// The simpler header used by standalone public content pages — just the logo
// (linking home) and the theme toggle, no nav links. Distinct from SiteHeader,
// which is for app-flow pages (landing, login, new session). Wrapped in the
// same Container SiteHeader's Navbar uses, so the header row lines up with
// every other page's header instead of spanning the full viewport width.
export function PublicHeader() {
  return (
    <header style={{ borderBottom: '0.5px solid var(--border-subtle)' }}>
      <Container style={{ padding: 'var(--space-4) var(--space-5)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <a
          href={import.meta.env.BASE_URL}
          style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-primary)', textDecoration: 'none' }}
        >
          <div style={{ width: 22, height: 22, borderRadius: 'var(--radius-full)', border: '1.5px solid var(--text-primary)' }} />
          <span style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-bold)' as unknown as number }}>MinCirklen</span>
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </Container>
    </header>
  )
}
