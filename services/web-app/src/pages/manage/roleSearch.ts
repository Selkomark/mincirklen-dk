// Client-side search for RolesTab.tsx — the Roles table and, inside the
// edit-role modal, the permission list. Both lists are small and fully
// loaded, so this runs in the browser. For roles it searches everything
// we know about one — not just its name — to answer "which role lets
// someone do X" as much as "find the role called Y":
//
//   - name, description, attached session-policy name
//   - every permission the role holds: slug parts and description
//
// "Semantic" here is deliberately lightweight, not a model: tokens are
// stemmed so "policies" finds "policy", a synonym table maps everyday
// words onto the vocabulary the slugs actually use ("edit" → update,
// "view" → read, "timeout" → session, "ban" → users), prefixes match so
// a partial word works while typing, and a small edit distance absorbs
// typos. Every query word must match somewhere (AND); results rank by
// how directly they matched.
//
// Languages: slugs and descriptions are English data, so English
// synonyms always apply. The admin's own language (i18n.language) adds
// its synonym table on top, so a Swedish admin can type "redigera
// användare" or "edit users" and reach users.update either way.

export interface SearchablePermission {
  slug: string
  description: string | null
}

export interface SearchableRole {
  name: string
  description: string | null
  sessionPolicyName: string | null
  permissions: SearchablePermission[]
}

type Synonyms = Record<string, string[]>

// Everyday word → the slug vocabulary it most likely means. Values are
// stemmed on load along with everything else, so plural/singular
// spelling here doesn't matter.
const SYNONYMS_EN: Synonyms = {
  edit: ['update'],
  modify: ['update'],
  change: ['update'],
  write: ['update', 'create'],
  view: ['read'],
  see: ['read'],
  list: ['read'],
  show: ['read'],
  add: ['create'],
  new: ['create'],
  make: ['create'],
  remove: ['delete', 'revoke'],
  timeout: ['session', 'idle'],
  idle: ['session'],
  expire: ['session'],
  expiry: ['session'],
  logout: ['session'],
  permission: ['roles'],
  mod: ['moderation'],
  moderate: ['moderation'],
  moderator: ['moderation', 'review'],
  flag: ['moderation', 'review'],
  report: ['moderation', 'review', 'reports'],
  complaint: ['reports'],
  queue: ['review'],
  user: ['users'],
  people: ['users'],
  member: ['users'],
  account: ['users'],
  ban: ['users'],
  email: ['users', 'pii'],
  unmask: ['pii'],
  address: ['pii'],
  invite: ['gates'],
  waitlist: ['gates'],
  signup: ['gates'],
  gate: ['gates'],
  launch: ['gates'],
  early: ['gates'],
  full: ['admin'],
  everything: ['admin'],
  manage: ['admin', 'manage'],
}

const SYNONYMS_DA: Synonyms = {
  rediger: ['update'],
  redigere: ['update'],
  ændre: ['update'],
  ændr: ['update'],
  opdater: ['update'],
  skriv: ['update', 'create'],
  se: ['read'],
  vis: ['read'],
  læs: ['read'],
  læse: ['read'],
  opret: ['create'],
  oprette: ['create'],
  ny: ['create'],
  nye: ['create'],
  tilføj: ['create'],
  fjern: ['delete', 'revoke'],
  slet: ['delete', 'revoke'],
  tilbagekald: ['revoke'],
  inaktiv: ['session', 'idle'],
  inaktivitet: ['session', 'idle'],
  session: ['session'],
  udløb: ['session'],
  udløber: ['session'],
  log: ['session'],
  rettighed: ['roles'],
  rettigheder: ['roles'],
  rolle: ['roles'],
  roller: ['roles'],
  moderation: ['moderation'],
  moderer: ['moderation'],
  moderator: ['moderation', 'review'],
  markering: ['moderation', 'review'],
  markeret: ['moderation', 'review'],
  anmeld: ['moderation', 'review'],
  gennemgang: ['review'],
  kø: ['review'],
  rapport: ['reports'],
  rapporter: ['reports'],
  anmeldelse: ['reports'],
  klage: ['reports'],
  krise: ['moderation', 'review'],
  bruger: ['users'],
  brugere: ['users'],
  medlem: ['users'],
  medlemmer: ['users'],
  konto: ['users'],
  udeluk: ['users'],
  udelukket: ['users'],
  mail: ['users', 'pii'],
  adresse: ['pii'],
  invitation: ['gates'],
  venteliste: ['gates'],
  tilmelding: ['gates'],
  tilmeldinger: ['gates'],
  port: ['gates'],
  adgangsport: ['gates'],
  adgangsporte: ['gates'],
  lancering: ['gates'],
  tidlig: ['gates'],
  fuld: ['admin'],
  alt: ['admin'],
  administrer: ['admin', 'manage'],
  administration: ['admin', 'manage'],
  adgang: ['access'],
  // Seeded session policies are named in English ("10 hours"), so the
  // Danish unit words need to reach them.
  minut: ['minute'],
  minutter: ['minute'],
  time: ['hour'],
  timer: ['hour'],
  dag: ['day'],
  dage: ['day'],
  uge: ['week'],
  uger: ['week'],
}

const SYNONYMS_SV: Synonyms = {
  redigera: ['update'],
  ändra: ['update'],
  uppdatera: ['update'],
  skriv: ['update', 'create'],
  visa: ['read'],
  se: ['read'],
  läs: ['read'],
  läsa: ['read'],
  skapa: ['create'],
  ny: ['create'],
  nya: ['create'],
  lägg: ['create'],
  radera: ['delete', 'revoke'],
  bort: ['delete', 'revoke'],
  återkalla: ['revoke'],
  inaktiv: ['session', 'idle'],
  inaktivitet: ['session', 'idle'],
  session: ['session'],
  utgång: ['session'],
  logga: ['session'],
  behörighet: ['roles'],
  behörigheter: ['roles'],
  roll: ['roles'],
  roller: ['roles'],
  moderering: ['moderation'],
  moderera: ['moderation'],
  moderator: ['moderation', 'review'],
  flagga: ['moderation', 'review'],
  flaggad: ['moderation', 'review'],
  anmäl: ['moderation', 'review'],
  granskning: ['review'],
  kö: ['review'],
  rapport: ['reports'],
  rapporter: ['reports'],
  klagomål: ['reports'],
  kris: ['moderation', 'review'],
  användare: ['users'],
  medlem: ['users'],
  medlemmar: ['users'],
  konto: ['users'],
  avstäng: ['users'],
  avstängd: ['users'],
  mejl: ['users', 'pii'],
  epost: ['users', 'pii'],
  adress: ['pii'],
  inbjudan: ['gates'],
  väntelista: ['gates'],
  anmälan: ['gates', 'reports'],
  anmälningar: ['gates'],
  grind: ['gates'],
  åtkomstgrind: ['gates'],
  åtkomstgrindar: ['gates'],
  lansering: ['gates'],
  tidig: ['gates'],
  full: ['admin'],
  allt: ['admin'],
  hantera: ['admin', 'manage'],
  administration: ['admin', 'manage'],
  åtkomst: ['access'],
  minut: ['minute'],
  minuter: ['minute'],
  timme: ['hour'],
  timmar: ['hour'],
  dag: ['day'],
  dagar: ['day'],
  vecka: ['week'],
  veckor: ['week'],
}

const SYNONYMS_BY_LANGUAGE: Record<string, Synonyms> = { en: SYNONYMS_EN, da: SYNONYMS_DA, sv: SYNONYMS_SV }

// Field weights — a hit on the role's own name should outrank the same
// word buried in one permission's description.
const WEIGHT_NAME = 5
const WEIGHT_SLUG = 3
const WEIGHT_DESCRIPTION = 2
const WEIGHT_POLICY = 2
const WEIGHT_PERMISSION_DESCRIPTION = 1

// How much a less-direct match is worth relative to an exact one.
const FACTOR_PREFIX = 0.8
const FACTOR_SYNONYM = 0.6
const FACTOR_FUZZY = 0.5

export interface Field {
  tokens: Set<string>
  weight: number
}

// English-shaped suffix stripping. Applied identically to queries,
// documents and the synonym tables, so it only has to be consistent,
// not linguistically right — a Danish or Swedish word that happens to
// lose a trailing "s" loses it on both sides of the comparison.
function stem(word: string): string {
  if (word.length <= 3) return word
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3)
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2)
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2)
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

// \p{L}/\p{N} rather than [a-z0-9] so æ, ø, å, ä, ö survive tokenizing.
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0)
    .map(stem)
}

function stemSynonyms(table: Synonyms): Map<string, string[]> {
  return new Map(Object.entries(table).map(([word, targets]) => [stem(word), targets.map(stem)]))
}

const STEMMED_SYNONYMS_BY_LANGUAGE = new Map(
  Object.entries(SYNONYMS_BY_LANGUAGE).map(([language, table]) => [language, stemSynonyms(table)]),
)

// English always, plus the admin's language when it has a table.
// `language` is i18n.language, which i18n.ts's `load: 'languageOnly'`
// keeps to a bare code ("da", not "da-DK").
function synonymTablesFor(language: string): Map<string, string[]>[] {
  const english = STEMMED_SYNONYMS_BY_LANGUAGE.get('en')!
  const own = language !== 'en' ? STEMMED_SYNONYMS_BY_LANGUAGE.get(language) : undefined
  return own ? [english, own] : [english]
}

// Bounded Levenshtein distance — bails out early once it's clear the
// distance exceeds `max`, since we only care about "close enough".
function withinEditDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost)
      current.push(value)
      if (value < rowMin) rowMin = value
    }
    if (rowMin > max) return false
    previous = current
  }
  return previous[b.length]! <= max
}

function allowedTypos(token: string): number {
  if (token.length >= 7) return 2
  if (token.length >= 4) return 1
  return 0
}

// Slug-vocabulary targets a query token maps to through the synonym
// tables: an exact synonym entry at full synonym weight, or — so a
// partially typed word works in any language ("redig" → "redigera") —
// an entry the token is a prefix of, at prefix weight.
function synonymTargets(queryToken: string, tables: Map<string, string[]>[]): { target: string; factor: number }[] {
  const out: { target: string; factor: number }[] = []
  for (const table of tables) {
    const exact = table.get(queryToken)
    if (exact) for (const target of exact) out.push({ target, factor: FACTOR_SYNONYM })
    if (queryToken.length >= 3) {
      for (const [word, targets] of table) {
        if (word !== queryToken && word.startsWith(queryToken)) {
          for (const target of targets) out.push({ target, factor: FACTOR_SYNONYM * FACTOR_PREFIX })
        }
      }
    }
  }
  return out
}

// Best match factor for one query token against one field's tokens, or
// 0 when nothing in the field resembles it.
function matchFactor(queryToken: string, field: Field, tables: Map<string, string[]>[]): number {
  if (field.tokens.has(queryToken)) return 1

  let best = 0
  const typos = allowedTypos(queryToken)
  for (const token of field.tokens) {
    if (queryToken.length >= 2 && token.startsWith(queryToken)) best = Math.max(best, FACTOR_PREFIX)
    else if (typos > 0 && withinEditDistance(queryToken, token, typos)) best = Math.max(best, FACTOR_FUZZY)
  }

  for (const { target, factor } of synonymTargets(queryToken, tables)) {
    if (field.tokens.has(target)) best = Math.max(best, factor)
    else {
      for (const token of field.tokens) {
        if (token.startsWith(target)) best = Math.max(best, factor * FACTOR_PREFIX)
      }
    }
  }

  return best
}

function buildFields(role: SearchableRole): Field[] {
  const fields: Field[] = [{ tokens: new Set(tokenize(role.name)), weight: WEIGHT_NAME }]
  if (role.description) fields.push({ tokens: new Set(tokenize(role.description)), weight: WEIGHT_DESCRIPTION })
  if (role.sessionPolicyName) fields.push({ tokens: new Set(tokenize(role.sessionPolicyName)), weight: WEIGHT_POLICY })

  const slugTokens = new Set<string>()
  const permissionDescriptionTokens = new Set<string>()
  for (const permission of role.permissions) {
    for (const token of tokenize(permission.slug)) slugTokens.add(token)
    if (permission.description) for (const token of tokenize(permission.description)) permissionDescriptionTokens.add(token)
  }
  if (slugTokens.size > 0) fields.push({ tokens: slugTokens, weight: WEIGHT_SLUG })
  if (permissionDescriptionTokens.size > 0) fields.push({ tokens: permissionDescriptionTokens, weight: WEIGHT_PERMISSION_DESCRIPTION })

  return fields
}

// Score > 0 means every query token found something in some field; 0
// means filtered out. Each token contributes its single best
// (weight × factor) hit.
export function scoreFields(fields: Field[], queryTokens: string[], language: string): number {
  if (queryTokens.length === 0) return 1
  const tables = synonymTablesFor(language)
  let total = 0
  for (const queryToken of queryTokens) {
    let best = 0
    for (const field of fields) {
      best = Math.max(best, field.weight * matchFactor(queryToken, field, tables))
    }
    if (best === 0) return 0
    total += best
  }
  return total
}

export function scoreRole(role: SearchableRole, queryTokens: string[], language: string): number {
  return scoreFields(buildFields(role), queryTokens, language)
}

// Filters and ranks. An empty/whitespace query returns the input
// untouched (same order), so the table doesn't reshuffle when the
// field is cleared.
export function searchRoles<T extends SearchableRole>(roles: T[], query: string, language = 'en'): T[] {
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return roles

  return roles
    .map((role, index) => ({ role, index, score: scoreRole(role, queryTokens, language) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.role)
}

// The edit-role modal's permission filter. Groups are the slug-prefix
// categories PermissionEditor already renders, each with the translated
// label it displays — so the label's words count as part of the
// category too ("Sessionspolicyer" finds session_policies). A query
// that matches a category keeps the whole group, so someone can type an
// area and tick everything in it; otherwise a group survives only
// through the individual permissions that match. `matched` flags drive
// the highlight — a category hit highlights the header, an item hit
// highlights the row.
export interface PermissionGroup<P extends SearchablePermission> {
  prefix: string
  label: string
  permissions: P[]
}

export interface PermissionGroupResult<P extends SearchablePermission> {
  prefix: string
  label: string
  categoryMatched: boolean
  permissions: { permission: P; matched: boolean }[]
}

export function searchPermissionGroups<P extends SearchablePermission>(
  groups: PermissionGroup<P>[],
  query: string,
  language = 'en',
): PermissionGroupResult<P>[] {
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) {
    return groups.map(({ prefix, label, permissions }) => ({
      prefix,
      label,
      categoryMatched: false,
      permissions: permissions.map((permission) => ({ permission, matched: false })),
    }))
  }

  const results: PermissionGroupResult<P>[] = []
  for (const { prefix, label, permissions } of groups) {
    const categoryTokens = new Set([...tokenize(prefix), ...tokenize(label)])
    const categoryMatched = scoreFields([{ tokens: categoryTokens, weight: 1 }], queryTokens, language) > 0
    const scored = permissions.map((permission) => {
      const fields: Field[] = [{ tokens: new Set(tokenize(permission.slug)), weight: WEIGHT_SLUG }]
      if (permission.description) fields.push({ tokens: new Set(tokenize(permission.description)), weight: WEIGHT_PERMISSION_DESCRIPTION })
      return { permission, matched: scoreFields(fields, queryTokens, language) > 0 }
    })
    const visible = categoryMatched ? scored : scored.filter((entry) => entry.matched)
    if (visible.length > 0) results.push({ prefix, label, categoryMatched, permissions: visible })
  }
  return results
}
