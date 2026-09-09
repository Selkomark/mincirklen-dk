import type { SupportedLanguage } from './languages'
import { SUPPORTED_LNGS } from './i18n'

// A URL locale segment is `<language>-<MARKET>` (e.g. "en-DK") — lowercase
// language, uppercase market, joined by a hyphen. That's also the
// conventional `hreflang` attribute casing, so a Locale's segment doubles
// as that value directly (see usePageMeta.ts).
export interface Locale {
  language: SupportedLanguage
  market: string
}

// The markets MinCirklen actually operates in today. Every language ×
// market combination is syntactically routable (parseLocaleSegment below
// accepts any two-letter market code paired with a supported language) —
// this is the one list that gates which of those combinations actually
// serve real content vs. a "not available in your region" page (see
// App.tsx's `market-unavailable` route and MarketUnavailablePage.tsx).
// Extend this array, and only this array, to open a new market.
export const OPERATING_MARKETS = ['DK', 'SE']

export const DEFAULT_MARKET = OPERATING_MARKETS[0]!

const LOCALE_SEGMENT_RE = /^([a-z]{2})-([A-Z]{2})$/

// True whenever a path segment is locale-*shaped* (two lowercase letters,
// a hyphen, two uppercase letters) regardless of whether the language is
// one this app actually supports. App.tsx's router uses this to tell "no
// locale segment was ever attempted here" (segment goes back into the
// redirect target untouched) apart from "a locale was attempted but this
// app doesn't know that language" (segment is consumed/dropped either
// way, since it was never a real path segment to begin with).
export function looksLikeLocaleSegment(segment: string): boolean {
  return LOCALE_SEGMENT_RE.test(segment)
}

export function parseLocaleSegment(segment: string): Locale | null {
  const match = LOCALE_SEGMENT_RE.exec(segment)
  if (!match) return null
  const [, language, market] = match
  if (!SUPPORTED_LNGS.includes(language as (typeof SUPPORTED_LNGS)[number])) return null
  return { language: language as SupportedLanguage, market: market! }
}

export function formatLocaleSegment(locale: Locale): string {
  return `${locale.language}-${locale.market}`
}

export function isOperatingMarket(market: string): boolean {
  return OPERATING_MARKETS.includes(market)
}

const MARKET_STORAGE_KEY = 'mincirklen-market'

// Companion to i18next-browser-languagedetector's own localStorage cache
// (i18n.ts) — market isn't a language, so i18next's detector never sees
// or stores it. This is the only other piece of "what locale did this
// visitor last resolve to" the app remembers once the URL segment that
// carried it is gone (a fresh tab, an external link with no prefix).
export function getStoredMarket(): string | null {
  try {
    return window.localStorage.getItem(MARKET_STORAGE_KEY)
  } catch {
    return null
  }
}

export function storeMarket(market: string): void {
  try {
    window.localStorage.setItem(MARKET_STORAGE_KEY, market)
  } catch {
    // Private browsing / storage disabled — the URL segment itself is
    // still the source of truth for the current page, this is only a
    // convenience for the *next* unprefixed visit.
  }
}

// A locale to render with when there's no resolved-route locale to read
// (App.tsx's LocaleContext) at all — the handful of places that can
// render outside Shell's own tree entirely: ErrorBoundary's top-level
// crash page, and CookieConsentBanner (mounted as App()'s own sibling of
// Shell, not inside it). Same inputs App.tsx's own redirect effect uses
// to pick a locale for a bare/unprefixed URL, so this never disagrees
// with where that redirect would actually send the visitor.
export function fallbackLocale(resolvedLanguage: string | undefined): Locale {
  const language = SUPPORTED_LNGS.includes(resolvedLanguage as (typeof SUPPORTED_LNGS)[number])
    ? (resolvedLanguage as SupportedLanguage)
    : 'en'
  return { language, market: getStoredMarket() ?? DEFAULT_MARKET }
}
