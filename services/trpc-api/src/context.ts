import type { Database } from '@mincirklen/shared'
import { verifySessionToken } from '@mincirklen/shared'
import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch'
import { getCookie } from 'hono/cookie'
import type { Context as HonoContext } from 'hono'
import type { Kysely } from 'kysely'
import type { GcsConfig } from './adapters/gcsAdapter'
import type { GoogleOAuthEndpoints } from './adapters/googleOAuthAdapter'
import type { KmsConfig } from './adapters/kmsAdapter'
import type { PubSubConfig } from './adapters/pubsubAdapter'
import { getUserRolesAndPermissions } from './repositories/rbacRepository'
import { isUserBanned, touchUser } from './repositories/userRepository'
import { resolveSession } from './services/authService'

export const SESSION_COOKIE_NAME = 'mc_session'
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180 // 180 days

// Without an explicit Domain, a cookie is host-only to whatever exact host
// set it — it would never reach a sibling subdomain like
// socket.dev-mincirklen.dk (websocket-service, a separate host per
// local-infra/caddy/Caddyfile and docs/tech_spec.md's prod Load Balancer
// routing). Derived from publicBaseUrl rather than a new env var, since
// that's already the one place each environment's own domain is
// configured (services/trpc-api/src/index.ts).
export function sessionCookieDomain(publicBaseUrl: string): string {
  return new URL(publicBaseUrl).hostname
}

// Shared by authRouter.ts (anonymous login) and oauthController.ts (Google
// login) — both issue the same token format for the same cookie, so the
// attributes must never drift between the two call sites.
export function buildSessionCookie(token: string, publicBaseUrl: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; Domain=${sessionCookieDomain(publicBaseUrl)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`
}

// Same name/attributes as buildSessionCookie (a browser matches a cookie to
// clear by name+domain+path, not just name) with Max-Age=0 — used by
// authRouter.ts's logout mutation.
export function buildLogoutCookie(publicBaseUrl: string): string {
  return `${SESSION_COOKIE_NAME}=; Domain=${sessionCookieDomain(publicBaseUrl)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

// Every login/logout response must send this alongside buildSessionCookie
// or buildLogoutCookie above. Before this file added the Domain attribute,
// mc_session was host-only (no Domain=); a browser that got that cookie
// pre-migration and then logs in again now ends up holding BOTH the old
// host-only cookie and the new Domain-scoped one under the same name. A
// browser sends both on every request (RFC 6265 puts the more specific,
// host-only one first in the Cookie header), and getCookie() silently
// reads that first, stale entry forever — the user is signed in
// server-side but every request 401s, with no visible error to explain
// why. This targets and clears exactly the pre-migration shape (no
// Domain=) so it stops shadowing the real cookie; it's a permanent
// no-op once a browser's legacy cookie is gone.
export function buildLegacySessionCookieClear(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

export interface AppEnv {
  db: Kysely<Database>
  authSecret: string
  moderationServiceUrl: string
  // websocket-service's base URL and the shared secret trpc-api presents
  // on every call to its /internal/* routes (websocketServiceAdapter.ts) —
  // trpc-api never talks to NATS/Redis directly; those are internal to
  // websocket-service (its own cross-pod fanout and shared memory).
  websocketServiceUrl: string
  internalServiceSecret: string
  publicBaseUrl: string
  // Encryption-as-a-service for user_profiles PII (Vault Transit locally,
  // a cloud KMS in prod) — see adapters/kmsAdapter.ts.
  vault: KmsConfig
  // Publish-only client for the data-export request pipeline (a local
  // Pub/Sub emulator in dev, real Pub/Sub in prod) — see
  // adapters/pubsubAdapter.ts and services/dataExportRequestService.ts.
  pubsub: PubSubConfig
  // Keys the OAuth subject hash in user_identities (auth/identityHash.ts)
  // — separate from authSecret (key separation: a leak of one shouldn't
  // compromise the other).
  identityHashKey: string
  // Optional only in the sense that the app boots without them — trpc-api
  // has no login path that doesn't go through Google (see
  // oauthController.ts / googleAuthService.ts); a real deployment always
  // sets these.
  googleClientId?: string
  googleClientSecret?: string
  // Test-only override — defaults to the real Google endpoints
  // (googleOAuthAdapter.ts) when omitted; lets integration tests point at
  // a fake in-process Google, mirroring session.integration.test.ts's
  // fake moderation-service.
  googleOAuthEndpoints?: GoogleOAuthEndpoints
  // The master-admin bootstrap (adminBootstrapService.ts) — optional, so
  // the app boots fine with no admin configured yet. Compared against the
  // verified email a user logs in with, never persisted anywhere itself.
  masterUserEmail?: string
  // Read-only access to the data-export bucket — trpc-api never writes
  // here (data-export-service owns uploads), only proxies a completed
  // export's bytes back through its own token-gated route. See
  // adapters/gcsAdapter.ts and controllers/exportDownloadController.ts.
  gcs: GcsConfig
  // Signs the short-lived (1 day), freshly-minted-per-click download
  // token in the exportDownloadController.ts URL — separate from
  // authSecret (key separation, same rationale as identityHashKey).
  downloadTokenSecret: string
  // This service's own public origin (the trpc.* subdomain), used to
  // build the absolute download-proxy URL returned to the browser — the
  // main app's publicBaseUrl points at a different host entirely.
  trpcPublicBaseUrl: string
}

export interface AppContext {
  // @hono/trpc-server's createContext option is typed to return
  // Record<string, unknown> — an index signature keeps this assignable
  // without losing the named properties' specific types. Note: the
  // property name can't be `env` — @hono/trpc-server unconditionally
  // overwrites an `env` key on the returned context with Hono's own
  // `c.env` (undefined on Bun), clobbering anything we put there.
  [key: string]: unknown
  resHeaders: Headers
  userId: string | null
  appEnv: AppEnv
  // Hydrated fresh per request in createContextFactory (empty for
  // anonymous/no-role users) — see rbacRepository.ts::getUserRolesAndPermissions
  // and controllers/trpc.ts::hasPermission, which reads this.
  roles: { id: string; name: string }[]
  permissions: string[]
}

function bearerToken(c: HonoContext): string | null {
  const header = c.req.header('authorization')
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length)
}

export function createContextFactory(env: AppEnv) {
  return async function createContext(
    opts: FetchCreateContextFnOptions,
    c: HonoContext,
  ): Promise<AppContext> {
    const token = getCookie(c, SESSION_COOKIE_NAME) ?? bearerToken(c)

    const userId = await resolveSession(
      {
        verifyToken: (t) => verifySessionToken(t, env.authSecret),
        touchUser: (userId) => touchUser(env.db, userId),
        isBanned: (userId) => isUserBanned(env.db, userId),
      },
      token,
    )

    const { roles, permissions } = userId
      ? await getUserRolesAndPermissions(env.db, userId)
      : { roles: [], permissions: [] }

    return { resHeaders: opts.resHeaders, userId, appEnv: env, roles, permissions }
  }
}
