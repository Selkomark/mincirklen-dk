import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { I18nProvider as RACI18nProvider } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import './i18n'
import { ThemeProvider } from './components/ThemeProvider'
import { SessionSocketProvider } from './SessionSocketProvider'
import { PreferencesProvider } from './PreferencesProvider'
import { ToastRegionRoot } from './components/Toast'
import { Catalog } from './Catalog'
import { LandingPage } from './LandingPage'
import { SessionPage } from './pages/SessionPage'
import { StartPage } from './pages/start/StartPage'
import { StartJoinPage } from './pages/start/StartJoinPage'
import { StartNewPage } from './pages/start/StartNewPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { ModerationTransparencyPage } from './pages/ModerationTransparencyPage'
import { ManagePage } from './pages/manage/ManagePage'
import { ErrorPage } from './pages/ErrorPage'
import { ErrorBoundary } from './ErrorBoundary'
import { PUBLIC_PAGES, PUBLIC_PAGE_ORDER, type PublicPageId } from './publicPages/pages'
import { PublicPageView } from './publicPages/PublicPageView'
import { CookieConsentBanner } from './CookieConsentBanner'
import './App.css'

const BASE = import.meta.env.BASE_URL

// Configurable so the real production admin path never has to appear in
// this open-source repo — set VITE_ADMIN_ROUTE per deployment to whatever
// segment that environment actually uses; local dev falls back to
// "manage" when it's unset. Note the honest limit of this: it keeps the
// path out of the source someone reads on GitHub, but a built JS bundle
// still ships this string to every visitor's browser — it's not a secret
// from anyone actually inspecting the live site, only from casual
// repo/source review.
const ADMIN_ROUTE_SEGMENT = import.meta.env.VITE_ADMIN_ROUTE || 'manage'

export const landingPath = () => BASE
export const systemDesignPath = () => `${BASE}system-design`
export const startPath = () => `${BASE}start`
export const startJoinPath = () => `${BASE}start/join`
export const startNewPath = () => `${BASE}start/new`
export const sessionPath = (sessionId: string) => `${BASE}s/${sessionId}`
export const loginPath = () => `${BASE}login`
export const registerPath = () => `${BASE}register`
export const moderationTransparencyPath = () => `${BASE}moderation-transparency`
export type ManageSection = 'review' | 'roles' | 'users'
export const managePath = (section?: ManageSection) => `${BASE}${ADMIN_ROUTE_SEGMENT}${section ? `/${section}` : ''}`

type Route =
  | { name: 'landing' }
  | { name: 'system-design' }
  | { name: 'start' }
  | { name: 'start-join' }
  | { name: 'start-new' }
  | { name: 'session'; sessionId: string }
  | { name: 'public-page'; id: PublicPageId }
  | { name: 'login' }
  | { name: 'register' }
  | { name: 'moderation-transparency' }
  | { name: 'manage'; section: ManageSection | null }
  | { name: 'not-found' }

// Top-level path segments the app itself owns. Public page slugs (privacy-policy, etc.)
// live at the top level too ("/privacy-policy", not "/p/privacy-policy") for cleaner
// public URLs, so this list is the one thing standing between a new page id and silently
// shadowing a real app route (or vice versa) — checked at module load below, not just here.
const RESERVED_TOP_LEVEL_SEGMENTS = [
  'system-design',
  'start',
  's',
  'login',
  'register',
  'moderation-transparency',
  ADMIN_ROUTE_SEGMENT,
]

const publicPageCollision = PUBLIC_PAGE_ORDER.find((id) => RESERVED_TOP_LEVEL_SEGMENTS.includes(id))
if (publicPageCollision) {
  throw new Error(
    `Public page id "${publicPageCollision}" collides with a reserved app route (${RESERVED_TOP_LEVEL_SEGMENTS.join(', ')}) — rename the page.`,
  )
}

// The whole app's navigation — landing/system-design/new/session/public pages — lives at
// real paths (pushState-driven, no full reloads for the in-app views) so every view is a
// shareable, bookmarkable URL. Public content pages (privacy policy, etc.) are opened via
// target="_blank" as their own full page loads (see publicPages/PublicPageView.tsx), but
// still parsed here so a direct/shared link to one renders correctly too.
function parseRoute(pathname: string): Route {
  if (!pathname.startsWith(BASE)) return { name: 'landing' }
  const rest = pathname.slice(BASE.length)

  if (rest === '' || rest === '/') return { name: 'landing' }

  // Stripped once up front rather than re-running a regex replace per
  // candidate below — every branch needs the same trailing slash gone,
  // and a plain endsWith/slice is both cheaper and clearer than a regex
  // for that.
  const normalized = rest.endsWith('/') ? rest.slice(0, -1) : rest

  if (normalized === 'system-design') return { name: 'system-design' }
  if (normalized === 'start') return { name: 'start' }
  if (normalized === 'start/join') return { name: 'start-join' }
  if (normalized === 'start/new') return { name: 'start-new' }
  if (normalized === 'login') return { name: 'login' }
  if (normalized === 'register') return { name: 'register' }
  if (normalized === 'moderation-transparency') return { name: 'moderation-transparency' }

  // Manual split, not a regex built from ADMIN_ROUTE_SEGMENT — that
  // segment is operator-configured (VITE_ADMIN_ROUTE), not a literal to
  // safely interpolate into a RegExp.
  const adminSegments = normalized.split('/')
  if (adminSegments[0] === ADMIN_ROUTE_SEGMENT && adminSegments.length <= 2) {
    const sub = adminSegments[1]
    if (sub === undefined) return { name: 'manage', section: null }
    if (sub === 'review' || sub === 'roles' || sub === 'users') return { name: 'manage', section: sub }
  }

  const sessionMatch = normalized.match(/^s\/([^/]+)$/)
  if (sessionMatch) return { name: 'session', sessionId: sessionMatch[1] }

  const pageMatch = normalized.match(/^([a-z0-9-]+)$/)
  const pageId = pageMatch?.[1] as PublicPageId | undefined
  if (pageId && pageId in PUBLIC_PAGES) return { name: 'public-page', id: pageId }

  return { name: 'not-found' }
}

// 'anonymous' covers both "no session at all" and "has a session but it's
// never been linked to Google" — both cases need the same thing (go
// through Google login), and neither is ever enough on its own to reach a
// gated page. In-session anonymity (Charter §4, "Stay anonymous in
// circles") is a *display* choice made after this bar is cleared, not a
// substitute for clearing it — the operator's actual requirement is: real
// Google identity + a completed profile, always, no exceptions (that's
// also enforced server-side by verifiedProcedure/googleLinkedProcedure in
// controllers/trpc.ts — this is the UI-side half of the same gate, not a
// replacement for it).
export type AuthStatus = { kind: 'loading' } | { kind: 'anonymous' } | { kind: 'needs-profile' } | { kind: 'verified' }

// `gateKey` is the current route's name while it's one of the gated routes
// below, or null otherwise — used as the effect dependency (not a plain
// boolean) so navigating client-side from one gated route to another (e.g.
// /register -> /new right after completing the form) re-checks instead of
// reusing a stale status from before the profile existed. The app's other
// way to become authenticated, the Google OAuth redirect, reloads the page
// and remounts this from scratch, so nothing else needs to keep this in
// sync reactively.
// Exported for SiteHeader.tsx — it needs to know whether to show "Join
// now" or "Log out" on every page it's rendered on, not just the gated
// routes below that already fetch this for their own routing decisions.
export function useAuthStatus(gateKey: string | null): AuthStatus {
  // Keyed on the gateKey the status was fetched *for*, not just the status
  // itself. Right after navigating between two gated routes (e.g.
  // /register -> /new post-submit), gateKey changes on this render but the
  // fetch below hasn't started yet — without this, the render effect that
  // decides where to redirect would read the *previous* route's stale
  // status (e.g. needs-profile) and immediately bounce back to /register.
  // Comparing keys makes render-time staleness explicit instead of
  // depending on effect-ordering to clear it first.
  const [state, setState] = useState<{ key: string | null; status: AuthStatus }>({
    key: null,
    status: { kind: 'loading' },
  })

  useEffect(() => {
    if (gateKey === null) return

    let cancelled = false

    void (async () => {
      // A single call: 401 means no session at all; otherwise the
      // response says both whether Google is linked and whether the
      // profile is complete — see authRouter.ts's myProfile.
      const res = await fetch('/api/trpc/auth.myProfile')
      if (!res.ok) {
        if (!cancelled) setState({ key: gateKey, status: { kind: 'anonymous' } })
        return
      }

      const body = (await res.json()) as {
        result: { data: { hasLinkedIdentity: boolean; hasProfile: boolean } }
      }
      const { hasLinkedIdentity, hasProfile } = body.result.data

      if (!cancelled) {
        setState({
          key: gateKey,
          status: !hasLinkedIdentity ? { kind: 'anonymous' } : !hasProfile ? { kind: 'needs-profile' } : { kind: 'verified' },
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [gateKey])

  return state.key === gateKey ? state.status : { kind: 'loading' }
}

// Sensitive routes: real support-circle content (start, start-join,
// start-new, session) and PII collection (register) — every one of
// these has a matching protectedProcedure on the backend (see
// controllers/trpc.ts), this is the UI-side half of the same gate, not a
// replacement for it.
const GATED_ROUTE_NAMES = new Set(['login', 'register', 'start', 'start-join', 'start-new', 'session', 'manage'])

function useRoute() {
  const [pathname, setPathname] = useState(() => window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((path: string) => {
    if (path !== window.location.pathname) {
      window.history.pushState(null, '', path)
    }
    setPathname(path)
  }, [])

  return { route: parseRoute(pathname), navigate }
}

function Shell() {
  const { t } = useTranslation('errors')
  const { t: ct } = useTranslation('common')
  const { route, navigate } = useRoute()

  const gateKey = GATED_ROUTE_NAMES.has(route.name) ? route.name : null
  const authStatus = useAuthStatus(gateKey)

  useEffect(() => {
    if (authStatus.kind === 'loading') return

    if (route.name === 'login') {
      if (authStatus.kind === 'needs-profile') navigate(registerPath())
      else if (authStatus.kind === 'verified') navigate(startPath())
      return
    }

    if (route.name === 'register') {
      // A user who already has a profile has nothing to do here — send
      // them on, don't re-show the registration form.
      if (authStatus.kind === 'anonymous') navigate(loginPath())
      else if (authStatus.kind === 'verified') navigate(startPath())
      return
    }

    if (
      route.name === 'start' ||
      route.name === 'start-join' ||
      route.name === 'start-new' ||
      route.name === 'session' ||
      route.name === 'manage'
    ) {
      if (authStatus.kind === 'anonymous') {
        navigate(loginPath())
      } else if (authStatus.kind === 'needs-profile') {
        navigate(registerPath())
      }
    }
  }, [route.name, authStatus, navigate])

  if (route.name === 'public-page') {
    return <PublicPageView id={route.id} />
  }

  if (route.name === 'moderation-transparency') {
    return <ModerationTransparencyPage />
  }

  if (route.name === 'not-found') {
    return <ErrorPage code={404} title={t('notFound.title')} message={t('notFound.message')} />
  }

  return (
    <div className="ds-shell-root" style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        className={[
          'ds-shell-view',
          route.name === 'session' || route.name === 'system-design' || route.name === 'manage'
            ? 'ds-shell-view--fixed'
            : 'ds-shell-view--scroll',
        ].join(' ')}
      >
        {route.name === 'system-design' && <Catalog />}
        {route.name === 'landing' && <LandingPage />}
        {authStatus.kind === 'verified' &&
          (route.name === 'session' ||
            route.name === 'start' ||
            route.name === 'start-join' ||
            route.name === 'start-new') && (
            // One persistent connection across every gated page below,
            // not one per page — see SessionSocketProvider.tsx. Mounted
            // here (not higher, e.g. around all of Shell) specifically
            // because it's only meaningful once verified: an anonymous
            // visitor has no sessions to subscribe to, and mc_session
            // may not even be a valid cookie yet.
            <PreferencesProvider>
              <SessionSocketProvider>
                {route.name === 'session' && (
                  <SessionPage sessionId={route.sessionId} onNavigate={(sessionId) => navigate(sessionPath(sessionId))} />
                )}
                {route.name === 'start' && (
                  <StartPage onChooseJoin={() => navigate(startJoinPath())} onChooseNew={() => navigate(startNewPath())} />
                )}
                {route.name === 'start-join' && (
                  <StartJoinPage onBack={() => navigate(startPath())} onComplete={(sessionId) => navigate(sessionPath(sessionId))} />
                )}
                {route.name === 'start-new' && (
                  <StartNewPage onBack={() => navigate(startPath())} onComplete={(sessionId) => navigate(sessionPath(sessionId))} />
                )}
              </SessionSocketProvider>
            </PreferencesProvider>
          )}
        {route.name === 'login' && authStatus.kind === 'anonymous' && <LoginPage />}
        {route.name === 'register' && authStatus.kind === 'needs-profile' && (
          <RegisterPage onComplete={() => navigate(startPath())} />
        )}
        {route.name === 'manage' && authStatus.kind === 'verified' && (
          <ManagePage section={route.section} onNavigate={(section) => navigate(managePath(section))} />
        )}
      </div>
      <ToastRegionRoot dismissLabel={ct('toast.dismiss')} />
    </div>
  )
}

// react-i18next's language codes (SUPPORTED_LNGS in i18n.ts) are bare
// BCP-47 primary tags; react-aria-components' I18nProvider wants a full
// locale for its date/calendar/number formatting internals — this is the
// one place that maps between the two, kept in sync automatically since
// useTranslation()'s `i18n.language` re-renders on every changeLanguage()
// call (PreferencesProvider, or the public-site language switcher).
// nb/fi entries removed alongside SUPPORTED_LNGS (2026-09) — re-add both
// together when Norwegian's next-phase scaling starts.
const RAC_LOCALES: Record<string, string> = { en: 'en-US', sv: 'sv-SE', da: 'da-DK' }

function LocaleSync({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
  return <RACI18nProvider locale={RAC_LOCALES[i18n.language] ?? RAC_LOCALES.en}>{children}</RACI18nProvider>
}

export default function App() {
  return (
    <LocaleSync>
      <ThemeProvider>
        <ErrorBoundary>
          <Shell />
        </ErrorBoundary>
        <CookieConsentBanner />
      </ThemeProvider>
    </LocaleSync>
  )
}
