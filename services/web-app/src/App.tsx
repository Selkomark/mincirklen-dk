import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
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
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { ModerationTransparencyPage } from './pages/ModerationTransparencyPage'
import { ManagePage } from './pages/manage/ManagePage'
import { ErrorPage } from './pages/ErrorPage'
import { MarketUnavailablePage } from './pages/MarketUnavailablePage'
import { ErrorBoundary } from './ErrorBoundary'
import { PUBLIC_PAGES, PUBLIC_PAGE_ORDER, type PublicPageId } from './publicPages/pages'
import { PublicPageView } from './publicPages/PublicPageView'
import { CookieConsentBanner } from './CookieConsentBanner'
import {
  fallbackLocale,
  formatLocaleSegment,
  isOperatingMarket,
  looksLikeLocaleSegment,
  parseLocaleSegment,
  storeMarket,
  type Locale,
} from './locale'
import type { SupportedLanguage } from './languages'
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

// Every path builder takes the current `locale` explicitly (see useLocale
// below) and splices its URL segment in right after BASE — the one thing
// standing between "the URL is authoritative for locale" and every link
// in the app silently regressing to a bare, unprefixed path.
export const landingPath = (locale: Locale) => `${BASE}${formatLocaleSegment(locale)}`
export const systemDesignPath = (locale: Locale) => `${BASE}${formatLocaleSegment(locale)}/system-design`
export const pPath = (locale: Locale) => `${BASE}${formatLocaleSegment(locale)}/p`
export const pJoinPath = (locale: Locale) => `${BASE}${formatLocaleSegment(locale)}/p/join`
export const pNewPath = (locale: Locale) => `${BASE}${formatLocaleSegment(locale)}/p/new`
export const sessionPath = (locale: Locale, sessionId: string) => `${BASE}${formatLocaleSegment(locale)}/s/${sessionId}`
export const loginPath = (locale: Locale) => `${BASE}${formatLocaleSegment(locale)}/login`
export const registerPath = (locale: Locale) => `${BASE}${formatLocaleSegment(locale)}/register`
export const moderationTransparencyPath = (locale: Locale) => `${BASE}${formatLocaleSegment(locale)}/moderation-transparency`
export type ManageSection = 'review' | 'roles' | 'users'
export const managePath = (locale: Locale, section?: ManageSection) =>
  `${BASE}${formatLocaleSegment(locale)}/${ADMIN_ROUTE_SEGMENT}${section ? `/${section}` : ''}`

// The current page's resolved locale — provided once, near the root of
// the routed tree (see Shell below), by the same value every path
// builder call site needs to pass to those functions above. Throws
// outside that tree on purpose: every route that can render at all
// (including 404 and the market-unavailable page) has a resolved locale
// by the time anything reads this, so a missing provider is a real bug,
// not a legitimate "no locale yet" state.
const LocaleContext = createContext<Locale | null>(null)

export function useLocale(): Locale {
  const locale = useContext(LocaleContext)
  if (!locale) throw new Error('useLocale() called outside a locale-resolved route')
  return locale
}

// Non-throwing counterpart for the handful of components that can render
// both inside Shell's routed tree AND outside it entirely (ErrorPage,
// mounted directly by ErrorBoundary on a top-level crash with no route
// resolved at all) — null here means "compute locale.ts's fallbackLocale
// instead", not a bug.
export function useOptionalLocale(): Locale | null {
  return useContext(LocaleContext)
}

type NavigateFn = (path: string, opts?: { replace?: boolean }) => void

// Provided alongside LocaleContext (see RouteProviders below) — lets a
// component several levels below Shell (LanguageSwitcher, in particular)
// perform a real client-side navigation without Shell having to thread a
// callback down through every intermediate layer.
const NavigateContext = createContext<NavigateFn | null>(null)

export function useAppNavigate(): NavigateFn {
  const navigate = useContext(NavigateContext)
  if (!navigate) throw new Error('useAppNavigate() called outside a locale-resolved route')
  return navigate
}

// The language switcher's whole implementation: swap the URL's language
// segment, keep the market and the rest of the path exactly as they are,
// and navigate. i18n.changeLanguage() itself isn't called here — Shell's
// own effect (below) reacts to the URL's resolved language changing and
// calls it, the same path a shared link with a different language
// segment or the browser back/forward buttons already go through. That's
// the point: the switcher doesn't get its own special case for changing
// the active language, it just changes the URL like everything else does.
export function useSetLanguage(): (language: SupportedLanguage) => void {
  const locale = useLocale()
  const navigate = useAppNavigate()
  return useCallback(
    (language: SupportedLanguage) => {
      const rest = window.location.pathname.slice(BASE.length).split('/').filter(Boolean).slice(1).join('/')
      navigate(`${BASE}${formatLocaleSegment({ language, market: locale.market })}${rest ? `/${rest}` : ''}`)
    },
    [locale, navigate],
  )
}

function RouteProviders({ locale, navigate, children }: { locale: Locale; navigate: NavigateFn; children: ReactNode }) {
  return (
    <LocaleContext.Provider value={locale}>
      <NavigateContext.Provider value={navigate}>{children}</NavigateContext.Provider>
    </LocaleContext.Provider>
  )
}

type PageRoute =
  | { name: 'landing' }
  | { name: 'system-design' }
  | { name: 'p' }
  | { name: 'p-join' }
  | { name: 'p-new' }
  | { name: 'session'; sessionId: string }
  | { name: 'public-page'; id: PublicPageId }
  | { name: 'login' }
  | { name: 'register' }
  | { name: 'moderation-transparency' }
  | { name: 'manage'; section: ManageSection | null }
  | { name: 'not-found' }

type RouteResult =
  // No (or an unsupported-language) locale segment at the front of the
  // path — Shell's redirect effect inserts one (stored/detected language,
  // stored/default market) and re-enters via history.replaceState, so
  // this is only ever a one-render flash, never something that itself
  // renders content.
  | { kind: 'redirect'; targetPath: string }
  // A real, locale-shaped, supported-language segment, but its market
  // isn't one MinCirklen operates in yet (OPERATING_MARKETS, locale.ts).
  | { kind: 'market-unavailable'; locale: Locale }
  | { kind: 'page'; locale: Locale; page: PageRoute }

// Top-level path segments the app itself owns. Public page slugs (privacy-policy, etc.)
// live directly under the locale segment too (not under "/p/") for cleaner public URLs,
// so this list is the one thing standing between a new page id and silently shadowing a
// real app route (or vice versa) — checked at module load below, not just here.
const RESERVED_TOP_LEVEL_SEGMENTS = [
  'system-design',
  'p',
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

// Parses everything *after* the locale segment — same shape as the pre-i18n-prefix
// router had, just operating on `normalized` (the path with BASE and the locale
// segment both already stripped) instead of the raw pathname.
function parsePageRoute(normalized: string): PageRoute {
  if (normalized === '') return { name: 'landing' }
  if (normalized === 'system-design') return { name: 'system-design' }
  if (normalized === 'p') return { name: 'p' }
  if (normalized === 'p/join') return { name: 'p-join' }
  if (normalized === 'p/new') return { name: 'p-new' }
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

// The whole app's navigation — landing/system-design/p/session/public pages — lives at
// real paths (pushState-driven, no full reloads for the in-app views) so every view is a
// shareable, bookmarkable URL, every one of them under a /<language>-<MARKET>/ prefix
// (see locale.ts) so the URL is authoritative for locale rather than localStorage/profile
// state. Public content pages (privacy policy, etc.) are opened via target="_blank" as
// their own full page loads (see publicPages/PublicPageView.tsx), but still parsed here
// so a direct/shared link to one renders correctly too.
function parseRoute(pathname: string): RouteResult {
  if (!pathname.startsWith(BASE)) return { kind: 'redirect', targetPath: '' }
  const rest = pathname.slice(BASE.length)
  const segments = rest.split('/').filter(Boolean)
  const [first, ...restSegments] = segments

  if (!first || !looksLikeLocaleSegment(first)) {
    // Nothing locale-shaped up front at all — the whole thing is content
    // to redirect into, untouched (e.g. a bare "/", or a pre-i18n-prefix
    // link like "/s/abc123").
    return { kind: 'redirect', targetPath: rest }
  }

  const locale = parseLocaleSegment(first)
  if (!locale) {
    // Locale-*shaped*, but not a language this app supports — it was
    // never a real path segment either way, so it's dropped, not kept.
    return { kind: 'redirect', targetPath: restSegments.join('/') }
  }

  const page = parsePageRoute(restSegments.join('/'))

  // The contact page is the one route left reachable in a non-operating
  // market — it's how someone the gate below blocks can actually ask for
  // their region to be opened, so it can't itself be behind that same
  // gate.
  const isContactPage = page.name === 'public-page' && page.id === 'contact'
  if (!isOperatingMarket(locale.market) && !isContactPage) {
    return { kind: 'market-unavailable', locale }
  }

  return { kind: 'page', locale, page }
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
// /register -> /p right after completing the form) re-checks instead of
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
  // /register -> /p post-submit), gateKey changes on this render but the
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

// Sensitive routes: real support-circle content (p, p-join, p-new,
// session) and PII collection (register) — every one of these has a
// matching protectedProcedure on the backend (see controllers/trpc.ts),
// this is the UI-side half of the same gate, not a replacement for it.
const GATED_ROUTE_NAMES = new Set(['login', 'register', 'p', 'p-join', 'p-new', 'session', 'manage'])

function useRoute() {
  const [pathname, setPathname] = useState(() => window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((path: string, opts?: { replace?: boolean }) => {
    // `path` may carry a query string (the locale-insertion redirect below
    // preserves one) — the browser URL keeps it, but routing state never
    // does: parseRoute splits on "/" and would otherwise see a bogus final
    // segment like "login?error=oauth_state" and fall through to
    // not-found.
    const pathOnly = path.split('?')[0] ?? path
    if (opts?.replace) {
      window.history.replaceState(null, '', path)
    } else if (pathOnly !== window.location.pathname) {
      window.history.pushState(null, '', path)
    }
    setPathname(pathOnly)
  }, [])

  return { route: parseRoute(pathname), navigate }
}

function Shell() {
  const { t } = useTranslation('errors')
  const { t: ct } = useTranslation('common')
  const { i18n } = useTranslation()
  const { route: routeResult, navigate } = useRoute()

  const gateKey = routeResult.kind === 'page' && GATED_ROUTE_NAMES.has(routeResult.page.name) ? routeResult.page.name : null
  const authStatus = useAuthStatus(gateKey)

  // Inserts a locale segment whenever the URL didn't carry a usable one —
  // stored/detected language (i18n.ts's own LanguageDetector already
  // resolved this before anything here mounts) plus the last remembered
  // (or default) market. A silent, historyless correction: the URL is
  // authoritative for locale from here on, but a first/bare visit still
  // has to land *somewhere*. The query string rides along unchanged — a
  // bare, unprefixed link is exactly what oauthController.ts's redirects
  // are (e.g. `/login?error=oauth_state`), and LoginPage.tsx reads that
  // `?error=` straight off `window.location.search` once it mounts, so
  // losing it here would silently swallow every login-failure message.
  useEffect(() => {
    if (routeResult.kind !== 'redirect') return
    const locale = fallbackLocale(i18n.resolvedLanguage)
    const target = `${BASE}${formatLocaleSegment(locale)}${routeResult.targetPath ? `/${routeResult.targetPath}` : ''}${window.location.search}`
    navigate(target, { replace: true })
  }, [routeResult, navigate, i18n.resolvedLanguage])

  // The URL's language segment is authoritative once present — this is
  // what makes that true rather than aspirational: whenever the resolved
  // route's language and i18next's active language diverge (a fresh
  // locale-prefixed link, browser back/forward onto a different language,
  // or LanguageSwitcher's useSetLanguage navigating to a new one), this
  // brings i18next into line with the URL, never the other way around.
  useEffect(() => {
    if (routeResult.kind === 'redirect') return
    if (routeResult.locale.language !== i18n.language) void i18n.changeLanguage(routeResult.locale.language)
  }, [routeResult, i18n])

  // Remembers the market for the *next* unprefixed visit (a fresh tab, an
  // external link with no locale segment) — the URL segment is always
  // authoritative for the page currently showing; this is only that
  // fallback, the market equivalent of i18next-browser-languagedetector's
  // own localStorage cache for language.
  useEffect(() => {
    if (routeResult.kind === 'page') storeMarket(routeResult.locale.market)
  }, [routeResult])

  useEffect(() => {
    if (routeResult.kind !== 'page' || authStatus.kind === 'loading') return
    const route = routeResult.page
    const locale = routeResult.locale

    if (route.name === 'login') {
      if (authStatus.kind === 'needs-profile') navigate(registerPath(locale))
      else if (authStatus.kind === 'verified') navigate(pPath(locale))
      return
    }

    if (route.name === 'register') {
      // A user who already has a profile has nothing to do here — send
      // them on, don't re-show the registration form.
      if (authStatus.kind === 'anonymous') navigate(loginPath(locale))
      else if (authStatus.kind === 'verified') navigate(pPath(locale))
      return
    }

    if (route.name === 'p' || route.name === 'p-join' || route.name === 'p-new' || route.name === 'session' || route.name === 'manage') {
      if (authStatus.kind === 'anonymous') {
        navigate(loginPath(locale))
      } else if (authStatus.kind === 'needs-profile') {
        navigate(registerPath(locale))
      } else if (route.name === 'p' && authStatus.kind === 'verified') {
        // Bare /p has nothing to show on its own (no option picked yet) —
        // Join is the more common path (browsing existing circles vs.
        // configuring a new one), so land there by default instead of an
        // empty center panel a visitor has to click through.
        navigate(pJoinPath(locale))
      }
    }
  }, [routeResult, authStatus, navigate])

  if (routeResult.kind === 'redirect') return null

  if (routeResult.kind === 'market-unavailable') {
    return (
      <RouteProviders locale={routeResult.locale} navigate={navigate}>
        <MarketUnavailablePage />
      </RouteProviders>
    )
  }

  const { locale, page: route } = routeResult

  if (route.name === 'public-page') {
    return (
      <RouteProviders locale={locale} navigate={navigate}>
        <PublicPageView id={route.id} />
      </RouteProviders>
    )
  }

  if (route.name === 'moderation-transparency') {
    return (
      <RouteProviders locale={locale} navigate={navigate}>
        <ModerationTransparencyPage />
      </RouteProviders>
    )
  }

  if (route.name === 'not-found') {
    return (
      <RouteProviders locale={locale} navigate={navigate}>
        <ErrorPage code={404} title={t('notFound.title')} message={t('notFound.message')} />
      </RouteProviders>
    )
  }

  return (
    <RouteProviders locale={locale} navigate={navigate}>
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
            (route.name === 'session' || route.name === 'p' || route.name === 'p-join' || route.name === 'p-new') && (
              // One persistent connection across every gated page below,
              // not one per page — see SessionSocketProvider.tsx. Mounted
              // here (not higher, e.g. around all of Shell) specifically
              // because it's only meaningful once verified: an anonymous
              // visitor has no sessions to subscribe to, and mc_session
              // may not even be a valid cookie yet.
              <PreferencesProvider>
                <SessionSocketProvider>
                  {route.name === 'session' && (
                    <SessionPage
                      sessionId={route.sessionId}
                      onNavigate={(sessionId) => navigate(sessionPath(locale, sessionId))}
                      onNavigateToP={() => navigate(pPath(locale))}
                    />
                  )}
                  {(route.name === 'p' || route.name === 'p-join' || route.name === 'p-new') && (
                    <StartPage
                      selected={route.name === 'p-join' ? 'join' : route.name === 'p-new' ? 'new' : null}
                      onSelectJoin={() => navigate(pJoinPath(locale))}
                      onSelectNew={() => navigate(pNewPath(locale))}
                      onBack={() => navigate(pPath(locale))}
                      onComplete={(sessionId) => navigate(sessionPath(locale, sessionId))}
                    />
                  )}
                </SessionSocketProvider>
              </PreferencesProvider>
            )}
          {route.name === 'login' && authStatus.kind === 'anonymous' && <LoginPage />}
          {route.name === 'register' && authStatus.kind === 'needs-profile' && (
            <RegisterPage onComplete={() => navigate(pPath(locale))} />
          )}
          {route.name === 'manage' && authStatus.kind === 'verified' && (
            <ManagePage section={route.section} onNavigate={(section) => navigate(managePath(locale, section))} />
          )}
        </div>
        <ToastRegionRoot dismissLabel={ct('toast.dismiss')} />
      </div>
    </RouteProviders>
  )
}

// react-i18next's language codes (SUPPORTED_LNGS in i18n.ts) are bare
// BCP-47 primary tags; react-aria-components' I18nProvider wants a full
// locale for its date/calendar/number formatting internals — this is the
// one place that maps between the two, kept in sync automatically since
// useTranslation()'s `i18n.language` re-renders on every changeLanguage()
// call (Shell's own URL-authoritative-language effect above is the only
// thing that calls it now).
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
