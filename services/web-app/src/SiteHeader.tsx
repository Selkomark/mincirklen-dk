import { useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Navbar } from './components/Navbar'
import { Button } from './components/Button'
import { Alert } from './components/Alert'
import { ThemeToggle } from './ThemeToggle'
import { LanguageSwitcher } from './LanguageSwitcher'
import { LinkButton } from './LinkButton'
import { publicPagePath } from './publicPages/pages'
import { loginPath, landingPath, pPath, useAuthStatus, useLocale } from './App'
import { useGateStatus } from './useGateStatus'
import type { Locale } from './locale'
import { logout } from './logout'

// The landing page's waitlist form lives at this id (LandingPage.tsx) —
// exported so both sides of the link (the anchor's target id and the
// header's href) stay in sync by construction, not by matching a literal
// string in two files.
export const WAITLIST_ANCHOR_ID = 'waitlist'

const navLinkStyle: CSSProperties = { textDecoration: 'none' }

function LogoutButton({ locale }: { locale: Locale }) {
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
      window.location.href = landingPath(locale)
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
  const locale = useLocale()
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

  // Whether *this visitor* can actually get past platform_launch — an
  // admin's own bypass makes this true regardless of the gate's mode
  // (see requireGateAccess, controllers/trpc.ts), which is exactly what
  // should let an admin keep using the real "Start"/login CTA. Everyone
  // else, logged in or not, gets routed to the waitlist form instead of
  // a Google-login button that leads nowhere real: completing OAuth
  // wouldn't be blocked (auth.google.start/callback are ungated Hono
  // routes), but every actual feature past it is, so offering that path
  // at all is misleading, not just eventually futile.
  const platformGateStatus = useGateStatus('platform_launch')
  // Fails closed while the status is still loading — a one-frame flash
  // of "Join the waitlist" instead of "Start" is a fine default; flashing
  // a real Google-login button for an instant before finding out the
  // visitor isn't actually let in is not.
  const platformGated = platformGateStatus.kind !== 'loaded' || !platformGateStatus.hasAccess

  const logo = (
    <a href={landingPath(locale)} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'inherit', textDecoration: 'none' }}>
      <div style={{ width: 20, height: 20, borderRadius: 'var(--radius-full)', border: '1.5px solid var(--text-primary)', flex: 'none' }} />
      <span>MinCirklen</span>
    </a>
  )

  return (
    <Navbar logo={logo}>
      <div className="ds-navbar__group">
        <a href={publicPagePath('about', locale)} className="ds-text ds-text--small ds-navbar__link" style={navLinkStyle}>
          {t('header.about')}
        </a>
        <a href={publicPagePath('safety-and-moderation', locale)} className="ds-text ds-text--small ds-navbar__link" style={navLinkStyle}>
          {t('header.safety')}
        </a>
      </div>
      {platformGated
        ? showJoinCta && (
            <div className="ds-navbar__group">
              <LinkButton href={`${landingPath(locale)}#${WAITLIST_ANCHOR_ID}`}>{t('header.joinWaitlist')}</LinkButton>
              {isLoggedIn && <LogoutButton locale={locale} />}
            </div>
          )
        : (isLoggedIn || (showJoinCta && authStatus.kind === 'anonymous')) && (
            <div className="ds-navbar__group">
              {isLoggedIn ? (
                <>
                  <LinkButton href={pPath(locale)}>{t('header.start')}</LinkButton>
                  <LogoutButton locale={locale} />
                </>
              ) : (
                <LinkButton href={loginPath(locale)}>{t('header.joinNow')}</LinkButton>
              )}
            </div>
          )}
      <div className="ds-navbar__group ds-navbar__group--settings">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
    </Navbar>
  )
}
