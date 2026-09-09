export interface Country {
  code: string
  name: string
}

// Deliberately restricted to countries whose national language is one of
// this app's currently-supported UI languages (languages.ts's
// SUPPORTED_LANGUAGES: en/sv/da), not the full country list this used to
// be. Prevents e.g. someone registering with "Germany" as their country
// when nothing here is meant for that market yet. English isn't tied to
// a specific country the way Danish/Swedish are (it's the
// fallback/international UI language, not a market of its own), so it
// doesn't add any English-speaking countries (US/UK/Ireland/etc.) here.
//
// Norway is excluded for now too, consistent with Norwegian ('nb') being
// next-phase scaling rather than current UI-language scope (see
// languages.ts) — add Norway back alongside 'nb' when that phase starts.
//
// This list alone only prevents claiming an unsupported country at
// signup — it's not a geo-restriction (someone can still register
// claiming Denmark/Sweden from anywhere). See TODO.md ("Restrict
// platform access to supported-language countries") for that follow-up.
export const COUNTRIES: Country[] = [
  { code: 'DK', name: 'Denmark' },
  { code: 'SE', name: 'Sweden' },
]
