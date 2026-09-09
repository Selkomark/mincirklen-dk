import { useEffect } from 'react'
import { SITE_ORIGIN, SITE_NAME } from './siteConfig'

export interface PageMetaOptions {
  title: string
  description: string
  /** Route path including the app's base, e.g. from publicPagePath()/landingPath(). */
  path: string
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

// Sets title + description + canonical + Open Graph + Twitter Card tags for a public
// page. Meant for pages search engines and AI crawlers should actually index — app-flow
// pages (login, session, etc.) just use useDocumentTitle and stay out of the sitemap.
export function usePageMeta({ title, description, path, image, type = 'website' }: PageMetaOptions) {
  useEffect(() => {
    document.title = title

    const url = `${SITE_ORIGIN}${path}`

    upsertMeta('name', 'description', description)
    upsertLink('canonical', url)

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
  }, [title, description, path, image, type])
}
