import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import resourcesToBackend from 'i18next-resources-to-backend'

// Namespaces mirror the app's major surfaces so each stays a manageable
// size and loads independently — a visitor on the landing page never
// pulls in session.json. `publicPages` is scaffolded here but only ever
// populated for `en` — the long-form legal/policy prose is explicitly
// excluded from this pass (mistranslating it carries real liability) and
// stays English-only pending human/professional translation.
export const NAMESPACES = ['common', 'landing', 'auth', 'start', 'session', 'moderation', 'errors', 'publicPages'] as const
export type Namespace = (typeof NAMESPACES)[number]

// Norwegian ('nb') and Finnish ('fi') were dropped from here (2026-09) —
// current focus is English/Danish/Swedish; Norwegian is next-phase
// scaling, not current scope. Their locale files were removed, not just
// unlisted here — re-add both when that phase starts, not just this line.
export const SUPPORTED_LNGS = ['en', 'sv', 'da'] as const

void i18next
  .use(LanguageDetector)
  .use(
    // Vite's native `import()` code-splitting handles the lazy-loading —
    // no bundler config needed (confirmed: this app's vite.config.ts has
    // no manualChunks setup, and doesn't need one for this to work).
    resourcesToBackend((language: string, namespace: string) => import(`./locales/${language}/${namespace}.json`)),
  )
  .use(initReactI18next)
  .init({
    // Cast: i18next's own types want a real Backend/Module already
    // registered before `.init` narrows them — safe here since `.use()`
    // above already registered LanguageDetector + resourcesToBackend.
    supportedLngs: SUPPORTED_LNGS,
    // Strips region subtags (navigator.language is often "en-US", not
    // "en") so the resolved language always matches one of SUPPORTED_LNGS
    // exactly — nothing downstream (the language <select>, the RAC locale
    // map in App.tsx) has to separately normalize it.
    load: 'languageOnly',
    ns: NAMESPACES,
    defaultNS: 'common',
    fallbackLng: 'en',
    detection: {
      // Anonymous visitors (no account yet, e.g. public marketing pages)
      // get their language from localStorage once they've picked one, or
      // their browser's language otherwise. A logged-in user's stored
      // `language` preference (Preferences section, PreferencesProvider)
      // takes over via an explicit i18next.changeLanguage() call once
      // their profile loads — this detector never overrides that.
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    interpolation: {
      // React already escapes — double-escaping would corrupt e.g. an
      // apostrophe rendered through dangerouslySetInnerHTML-free JSX.
      escapeValue: false,
    },
    // Renders the key synchronously while a namespace's dynamic import is
    // in flight, then re-renders once it resolves — avoids wrapping the
    // whole app in <Suspense> just for this. The import is a same-origin,
    // build-time-known chunk (not a real network fetch of user content),
    // so in practice this window is a single React render, not a visible
    // flash.
    react: { useSuspense: false },
  })

export default i18next
