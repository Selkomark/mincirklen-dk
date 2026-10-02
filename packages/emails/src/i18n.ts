import type { EmailLanguage, TemplateStrings } from './types'

// Picks the strings for a language, falling back to English for any key
// the translation doesn't cover. English copy is the contract; a
// partial Danish or Swedish table is never a rendering error.
export function resolveStrings<S extends Record<string, string>>(strings: TemplateStrings<S>, language: EmailLanguage): S {
  if (language === 'en') return strings.en
  const partial = strings[language]
  if (!partial) return strings.en
  return { ...strings.en, ...stripUndefined(partial) }
}

function stripUndefined<S extends Record<string, string>>(partial: Partial<S>): Partial<S> {
  const out: Partial<S> = {}
  for (const key of Object.keys(partial) as (keyof S)[]) {
    const value = partial[key]
    if (value !== undefined) out[key] = value
  }
  return out
}

// `{{name}}` substitution for copy that carries a variable mid-sentence.
// Unknown placeholders are left as-is so a typo shows up in the preview
// instead of vanishing.
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, name: string) => {
    const value = values[name]
    return value === undefined ? match : String(value)
  })
}
