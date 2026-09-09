// Mirrors the backend's SUPPORTED_LANGUAGES enum
// (packages/shared/src/schemas/userProfile.ts) — this app isn't in the Bun
// workspace those packages live in (it talks to the API over plain
// fetch, not a typed client), so this list is kept in sync by hand rather
// than imported, the same way countries.ts's codes aren't shared either.
//
// Norwegian ('nb') and Finnish ('fi') were dropped (2026-09) — current
// focus is English/Danish/Swedish; Norwegian is next-phase scaling, not
// current scope. Re-add both (and their locale files, i18n.ts's
// SUPPORTED_LNGS, and the backend enum) together when that phase starts.
export type SupportedLanguage = 'en' | 'sv' | 'da'

// Each language's own native name, not translated — a language picker
// showing "Svenska"/"Dansk" needs no translation of its own labels, and
// is the standard convention for this kind of control.
export const SUPPORTED_LANGUAGES: { code: SupportedLanguage; nativeName: string }[] = [
  { code: 'en', nativeName: 'English' },
  { code: 'sv', nativeName: 'Svenska' },
  { code: 'da', nativeName: 'Dansk' },
]

// navigator.language is a BCP-47 tag ("en-US", "da-DK", ...) — only the
// primary subtag matters here.
export function detectDefaultLanguage(): SupportedLanguage {
  const primary = navigator.language.slice(0, 2).toLowerCase()
  return SUPPORTED_LANGUAGES.find((l) => l.code === primary)?.code ?? 'en'
}
