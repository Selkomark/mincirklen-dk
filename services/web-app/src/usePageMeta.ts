import { useEffect } from 'react'
import { SITE_ORIGIN, SITE_NAME } from './siteConfig'
import { OPERATING_MARKETS, formatLocaleSegment, type Locale } from './locale'
import { SUPPORTED_LANGUAGES } from './languages'

export interface PageMetaOptions {
  title: string
  description: string
  locale: Locale
  /** Locale-independent path segment(s) after the locale prefix, e.g. "about", "" for landing. No leading/trailing slash. */
  pagePath: string
  /** Resolved asset URL (import a webp/png so Vite gives you the real hashed URL). */
  image?: string
  type?: 'website' | 'article'
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.querySelector(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function upsertLink(rel: string, href: string) {
  let el = document.querySelector(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

const HREFLANG_GROUP_ATTR = 'data-hreflang-group'

// `link[rel=alternate][hreflang]` isn't a one-per-page tag like canonical
// — every locale variant of the current page gets its own — so this
// replaces the *whole set* each call rather than upserting a single
// element the way upsertMeta/upsertLink do. Tagged with
// HREFLANG_GROUP_ATTR so a later call (a different page) can find and
// clear exactly these before writing its own, without touching any other
// <link> the page head happens to have.
function replaceHreflangLinks(alternates: { hreflang: string; href: string }[]) {
  document.querySelectorAll(`link[${HREFLANG_GROUP_ATTR}]`).forEach((el) => el.remove())
  for (const { hreflang, href } of alternates) {
    const el = document.createElement('link')
    el.setAttribute('rel', 'alternate')
    el.setAttribute('hreflang', hreflang)
    el.setAttribute('href', href)
    el.setAttribute(HREFLANG_GROUP_ATTR, '')
    document.head.appendChild(el)
  }
}

function localizedUrl(locale: Locale, pagePath: string): string {
  const path = `${import.meta.env.BASE_URL}${formatLocaleSegment(locale)}${pagePath ? `/${pagePath}` : ''}`
  return `${SITE_ORIGIN}${path}`
}

// Sets title + description + canonical + hreflang alternates + Open Graph + Twitter
// Card tags for a public page. Meant for pages search engines and AI crawlers should
// actually index — app-flow pages (login, session, etc.) just use useDocumentTitle and
// stay out of the sitemap.
export function usePageMeta({ title, description, locale, pagePath, image, type = 'website' }: PageMetaOptions) {
  useEffect(() => {
    document.title = title

    const url = localizedUrl(locale, pagePath)

    upsertMeta('name', 'description', description)
    upsertLink('canonical', url)

    // One alternate per language × operating-market combination this
    // same page id resolves under, plus x-default pointing at the
    // visitor's own locale — lets a crawler discover every locale variant
    // from any one of them, instead of indexing each in isolation with no
    // canonical URL for every language (the old, pre-i18n-prefix state).
    const alternates = SUPPORTED_LANGUAGES.flatMap(({ code: language }) =>
      OPERATING_MARKETS.map((market) => ({
        hreflang: formatLocaleSegment({ language, market }),
        href: localizedUrl({ language, market }, pagePath),
      })),
    )
    alternates.push({ hreflang: 'x-default', href: url })
    replaceHreflangLinks(alternates)

    upsertMeta('property', 'og:title', title)
    upsertMeta('property', 'og:description', description)
    upsertMeta('property', 'og:type', type)
    upsertMeta('property', 'og:url', url)
    upsertMeta('property', 'og:site_name', SITE_NAME)

    upsertMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary')
    upsertMeta('name', 'twitter:title', title)
    upsertMeta('name', 'twitter:description', description)

    if (image) {
      upsertMeta('property', 'og:image', image)
      upsertMeta('name', 'twitter:image', image)
    }
  }, [title, description, locale, pagePath, image, type])
}
