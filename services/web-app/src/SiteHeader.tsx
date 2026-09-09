import { useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Navbar } from './components/Navbar'
import { Button } from './components/Button'
import { Alert } from './components/Alert'
import { ThemeToggle } from './ThemeToggle'
import { LanguageSwitcher } from './LanguageSwitcher'
import { LinkButton } from './LinkButton'
import { publicPagePath } from './publicPages/pages'
import { loginPath, landingPath, useAuthStatus } from './App'
import { logout } from './logout'

const navLinkStyle: CSSProperties = { textDecoration: 'none' }

function LogoutButton() {
  const { t } = useTranslation('landing')
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogout() {
    setError(null)
    setIsLoggingOut(true)
    try {
      await logout()
      // Hard navigation, not client-side: every page holds its own
      // fetched auth status (useAuthStatus), so a full reload is the
      // simplest way to make sure nothing keeps rendering as logged in.
      window.location.href = landingPath()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.logoutFailed'))
      setIsLoggingOut(false)
    }
  }

  return (
    <>
      {error && <Alert variant="urgent">{error}</Alert>}
      <Button variant="secondary" isPending={isLoggingOut} onPress={() => void handleLogout()}>
        {t('header.logOut')}
      </Button>
    </>
  )
}

export function SiteHeader({ showJoinCta = true }: { showJoinCta?: boolean }) {
  const { t } = useTranslation('landing')
  // Unconditional — unlike "Join now" (a prompt some pages redundantly
  // suppress via showJoinCta), "Log out" is never redundant on a page a
  // logged-in user can reach, so it must not be gated behind that flag.
  const authStatus = useAuthStatus('site-header')
  // Any non-anonymous, resolved status counts — the header doesn't care
  // *which* authenticated state (needs-profile vs. verified), only
  // whether there's a real session to log out of. Written as a negation
  // (not "verified || needs-profile") so a future AuthStatus kind that's
  // still "logged in" doesn't silently fall through to "Join now".
  const isLoggedIn = authStatus.kind !== 'anonymous' && authStatus.kind !== 'loading'

  const logo = (
    <a href={landingPath()} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'inherit', textDecoration: 'none' }}>
      <div style={{ width: 20, height: 20, borderRadius: 'var(--radius-full)', border: '1.5px solid var(--text-primary)', flex: 'none' }} />
      <span>MinCirklen</span>
    </a>
  )

  return (
    <Navbar logo={logo}>
      <a href={publicPagePath('about')} className="ds-text ds-text--small" style={navLinkStyle}>
        {t('header.about')}
      </a>
      <a href={publicPagePath('safety-and-moderation')} className="ds-text ds-text--small" style={navLinkStyle}>
        {t('header.safety')}
      </a>
      {isLoggedIn ? (
        <LogoutButton />
      ) : (
        showJoinCta && authStatus.kind === 'anonymous' && <LinkButton href={loginPath()}>{t('header.joinNow')}</LinkButton>
      )}
      <LanguageSwitcher />
      <ThemeToggle />
    </Navbar>
  )
}
