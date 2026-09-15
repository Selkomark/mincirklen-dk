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
import { useGateStatus } from './useGateStatus'
import { postTrpc } from './gateShared'
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
export type ManageSection = 'review' | 'roles' | 'users' | 'gates'
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

// `html`/`body` are deliberately overflow:hidden app-wide (index.css —
// a mobile on-screen-keyboard fix) — `.ds-shell-view--scroll` is the
// actual scroll container every route needs, not just the ones under
// Shell's main return below. Every route rendered *without* this (a
// public page, the transparency report, a 404, a blocked-market page)
// has no scroll container at all, so any content taller than the
// viewport is simply clipped, unreachable, with no visible scrollbar to
// hint why.
function ScrollableView({ children }: { children: ReactNode }) {
  return (
    <div className="ds-shell-root" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="ds-shell-view ds-shell-view--scroll">{children}</div>
    </div>
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
    if (sub === 'review' || sub === 'roles' || sub === 'users' || sub === 'gates') return { name: 'manage', section: sub }
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

// Routes the platform_launch gate never touches: public-page and
// moderation-transparency are already backend-public (publicPagePath's
// content, moderationRouter.ts's transparencyMetrics), and gating the
// transparency report specifically would contradict CHARTER.md principle
// 5 (radical transparency as a safety mechanism) — it's meant to build
// trust *before* launch, not after. 'landing' is handled separately
// below (it renders a waitlist-signup variant instead of redirecting).
const PLATFORM_GATE_EXEMPT_ROUTE_NAMES = new Set(['landing', 'public-page', 'moderation-transparency'])

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
  const platformGateStatus = useGateStatus('platform_launch')
  // Guards the *render* of every gated route below, not just the
  // redirect effect further down — the effect only fires after a
  // render has already happened, which without this would let e.g.
  // LoginPage flash its real "Continue with Google" button for one
  // frame while platformGateStatus is still loading, before the
  // redirect away from it lands. Deliberately false while loading
  // (fails closed) rather than only false once we positively know the
  // gate is closed.
  const platformGateOk = platformGateStatus.kind === 'loaded' && (platformGateStatus.open || platformGateStatus.hasAccess)

  // A `?invite=<token>` query param redeems a grant into the mc_gate_
  // cookie (gatesRouter.ts's redeemInvite) — reached most naturally via a
  // bare link to `/`, but handled here regardless of route so a shared
  // link with extra path segments still works. Hard-navigates to the
  // same URL with the param stripped once redeemed, rather than trying
  // to force useGateStatus to re-fetch — same "just reload" precedent
  // SiteHeader.tsx's logout already uses for a session-cookie change.
  // Silently ignores an invalid/expired token: the visitor just stays on
  // whatever the gate would otherwise show them, no error UI to build for
  // a token nobody but an admin ever hands out.
  useEffect(() => {
    if (!window.location.search.includes('invite=')) return
    const token = new URLSearchParams(window.location.search).get('invite')
    if (!token) return

    let cancelled = false
    void (async () => {
      try {
        await postTrpc('gates.redeemInvite', { token })
      } catch {
        // See comment above — an invalid token just leaves the gate as-is.
      }
      if (!cancelled) {
        const url = new URL(window.location.href)
        url.searchParams.delete('invite')
        window.location.href = `${url.pathname}${url.search}`
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Everything except the exempt routes above stays unreachable while
  // platform_launch is closed for this visitor — redirect to the landing
  // page, which renders the waitlist-signup variant below instead of
  // this route. This is UX only, same relationship the auth-status
  // redirect effect below has to protectedProcedure/verifiedProcedure —
  // the real enforcement is requireGateAccess (controllers/trpc.ts).
  useEffect(() => {
    if (routeResult.kind !== 'page' || platformGateStatus.kind === 'loading') return
    if (platformGateStatus.open || platformGateStatus.hasAccess) return
    if (PLATFORM_GATE_EXEMPT_ROUTE_NAMES.has(routeResult.page.name)) return
    navigate(landingPath(routeResult.locale))
  }, [routeResult, platformGateStatus, navigate])

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
        <ScrollableView>
          <MarketUnavailablePage />
        </ScrollableView>
      </RouteProviders>
    )
  }

  const { locale, page: route } = routeResult

  if (route.name === 'public-page') {
    return (
      <RouteProviders locale={locale} navigate={navigate}>
        <ScrollableView>
          <PublicPageView id={route.id} />
        </ScrollableView>
      </RouteProviders>
    )
  }

  if (route.name === 'moderation-transparency') {
    return (
      <RouteProviders locale={locale} navigate={navigate}>
        <ScrollableView>
          <ModerationTransparencyPage />
        </ScrollableView>
      </RouteProviders>
    )
  }

  if (route.name === 'not-found') {
    return (
      <RouteProviders locale={locale} navigate={navigate}>
        <ScrollableView>
          <ErrorPage code={404} title={t('notFound.title')} message={t('notFound.message')} />
        </ScrollableView>
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
          {route.name === 'landing' && (
            // Keyed on `unlocked`, not `open` and not `hasAccess`:
            // - A real visitor who redeemed a valid invite link has
            //   `unlocked: true` (their own gate cookie verifies) even
            //   while the gate's global mode is still invite-only — they
            //   see the real page, not the waitlist form, the moment
            //   their link works.
            // - An admin with no gate cookie of their own has
            //   `hasAccess: true` (the admin.access bypass) but
            //   `unlocked: false`, so they still see the waitlist
            //   variant here as a preview of what a real visitor sees —
            //   `hasAccess` alone would incorrectly hide that from them.
            // The redirect effect above still uses `hasAccess`, so an
            // admin can always reach every other route regardless of
            // what renders here.
            <LandingPage waitlistMode={platformGateStatus.kind === 'loaded' && !platformGateStatus.unlocked} />
          )}
          {authStatus.kind === 'verified' &&
            platformGateOk &&
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
          {route.name === 'login' && authStatus.kind === 'anonymous' && platformGateOk && <LoginPage />}
          {route.name === 'register' && authStatus.kind === 'needs-profile' && platformGateOk && (
            <RegisterPage onComplete={() => navigate(pPath(locale))} />
          )}
          {route.name === 'manage' && authStatus.kind === 'verified' && platformGateOk && (
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
