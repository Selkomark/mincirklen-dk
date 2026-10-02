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

// Everyday word → the slug vocabulary it most likely means. Values are
// stemmed on load along with everything else, so plural/singular
// spelling here doesn't matter.
const SYNONYMS: Record<string, string[]> = {
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
  report: ['moderation', 'review'],
  queue: ['review'],
  user: ['users'],
  people: ['users'],
  member: ['users'],
  account: ['users'],
  ban: ['users'],
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

function stem(word: string): string {
  if (word.length <= 3) return word
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3)
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2)
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2)
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
    .map(stem)
}

const STEMMED_SYNONYMS = new Map<string, string[]>(
  Object.entries(SYNONYMS).map(([word, targets]) => [stem(word), targets.map(stem)]),
)

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

// Best match factor for one query token against one field's tokens, or
// 0 when nothing in the field resembles it.
function matchFactor(queryToken: string, field: Field): number {
  if (field.tokens.has(queryToken)) return 1

  let best = 0
  const typos = allowedTypos(queryToken)
  for (const token of field.tokens) {
    if (queryToken.length >= 2 && token.startsWith(queryToken)) best = Math.max(best, FACTOR_PREFIX)
    else if (typos > 0 && withinEditDistance(queryToken, token, typos)) best = Math.max(best, FACTOR_FUZZY)
  }

  for (const synonym of STEMMED_SYNONYMS.get(queryToken) ?? []) {
    if (field.tokens.has(synonym)) best = Math.max(best, FACTOR_SYNONYM)
    else {
      for (const token of field.tokens) {
        if (token.startsWith(synonym)) best = Math.max(best, FACTOR_SYNONYM * FACTOR_PREFIX)
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
export function scoreFields(fields: Field[], queryTokens: string[]): number {
  if (queryTokens.length === 0) return 1
  let total = 0
  for (const queryToken of queryTokens) {
    let best = 0
    for (const field of fields) {
      best = Math.max(best, field.weight * matchFactor(queryToken, field))
    }
    if (best === 0) return 0
    total += best
  }
  return total
}

export function scoreRole(role: SearchableRole, queryTokens: string[]): number {
  return scoreFields(buildFields(role), queryTokens)
}

// Filters and ranks. An empty/whitespace query returns the input
// untouched (same order), so the table doesn't reshuffle when the
// field is cleared.
export function searchRoles<T extends SearchableRole>(roles: T[], query: string): T[] {
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return roles

  return roles
    .map((role, index) => ({ role, index, score: scoreRole(role, queryTokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.role)
}

// The edit-role modal's permission filter. Groups are the slug-prefix
// categories PermissionEditor already renders. A query that matches a
// category (its prefix, e.g. "policies" → session_policies) keeps the
// whole group, so someone can type an area and tick everything in it;
// otherwise a group survives only through the individual permissions
// that match. `matched` flags drive the highlight — a category hit
// highlights the header, an item hit highlights the row.
export interface PermissionGroupResult<P extends SearchablePermission> {
  prefix: string
  categoryMatched: boolean
  permissions: { permission: P; matched: boolean }[]
}

export function searchPermissionGroups<P extends SearchablePermission>(
  groups: [string, P[]][],
  query: string,
): PermissionGroupResult<P>[] {
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) {
    return groups.map(([prefix, permissions]) => ({
      prefix,
      categoryMatched: false,
      permissions: permissions.map((permission) => ({ permission, matched: false })),
    }))
  }

  const results: PermissionGroupResult<P>[] = []
  for (const [prefix, permissions] of groups) {
    const categoryMatched = scoreFields([{ tokens: new Set(tokenize(prefix)), weight: 1 }], queryTokens) > 0
    const scored = permissions.map((permission) => {
      const fields: Field[] = [{ tokens: new Set(tokenize(permission.slug)), weight: WEIGHT_SLUG }]
      if (permission.description) fields.push({ tokens: new Set(tokenize(permission.description)), weight: WEIGHT_PERMISSION_DESCRIPTION })
      return { permission, matched: scoreFields(fields, queryTokens) > 0 }
    })
    const visible = categoryMatched ? scored : scored.filter((entry) => entry.matched)
    if (visible.length > 0) results.push({ prefix, categoryMatched, permissions: visible })
  }
  return results
}
