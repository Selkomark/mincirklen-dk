import { randomUUID } from 'node:crypto'
import { createSessionToken, verifySessionToken } from '@mincirklen/shared'
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { GoogleOAuthError, buildAuthorizationUrl, exchangeCodeForTokens, verifyIdToken } from '../adapters/googleOAuthAdapter'
import { encryptField } from '../adapters/kmsAdapter'
import { hashIdentitySubject } from '../auth/identityHash'
import { SESSION_COOKIE_NAME, buildLegacySessionCookieClear, buildSessionCookie, sessionCookieDomain, type AppEnv } from '../context'
import { findBanByIdentityHash } from '../repositories/accountBanRepository'
import {
  assignRoleToUser,
  findRoleByName,
  isAdminBootstrapCompleted,
  markAdminBootstrapCompleted,
} from '../repositories/rbacRepository'
import { findUserIdByIdentity, linkIdentity } from '../repositories/userIdentityRepository'
import { insertUser, setEmail, userExists } from '../repositories/userRepository'
import { userProfileExists } from '../repositories/userProfileRepository'
import { bootstrapAdminIfMasterEmail } from '../services/adminBootstrapService'
import { resolveGoogleLogin } from '../services/googleAuthService'

const OAUTH_STATE_COOKIE_NAME = 'mc_oauth_state'
const OAUTH_STATE_MAX_AGE_SECONDS = 600 // 10 minutes
const GOOGLE_PROVIDER = 'google'

function redirectUriFor(env: AppEnv): string {
  return `${env.publicBaseUrl}/api/auth/callback/google`
}

// Every failure branch below sends the browser back to a page it can
// render, never a raw framework error page — a user mid-login (stale
// OAuth state, an expired code, a KMS hiccup, a DB blip) should land on a
// "try again" screen, not a blank "Internal Server Error".
function loginErrorRedirect(c: Context, env: AppEnv, code: string) {
  return c.redirect(`${env.publicBaseUrl}/login?error=${code}`, 302)
}

function configFor(env: AppEnv, clientId: string, clientSecret: string) {
  return {
    clientId,
    clientSecret,
    redirectUri: redirectUriFor(env),
    endpoints: env.googleOAuthEndpoints,
  }
}

export function createOAuthController(env: AppEnv): Hono {
  const app = new Hono()

  app.get('/auth/google/start', (c) => {
    // Google login is an optional layer on top of anonymous auth (roadmap's
    // threat model) — trpc-api boots and works without it configured;
    // only this route itself errors.
    if (!env.googleClientId || !env.googleClientSecret) {
      return c.text('Google login is not configured', 503)
    }

    const state = randomUUID()
    setCookie(c, OAUTH_STATE_COOKIE_NAME, state, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
    })

    const url = buildAuthorizationUrl(configFor(env, env.googleClientId, env.googleClientSecret), state)

    return c.redirect(url, 302)
  })

  app.get('/auth/callback/google', async (c) => {
    if (!env.googleClientId || !env.googleClientSecret) {
      return c.text('Google login is not configured', 503)
    }

    const stateParam = c.req.query('state')
    const stateCookie = getCookie(c, OAUTH_STATE_COOKIE_NAME)
    deleteCookie(c, OAUTH_STATE_COOKIE_NAME, { path: '/' })

    if (!stateParam || !stateCookie || stateParam !== stateCookie) {
      return loginErrorRedirect(c, env, 'oauth_state')
    }

    const code = c.req.query('code')
    if (!code) {
      return loginErrorRedirect(c, env, 'oauth_state')
    }

    const config = configFor(env, env.googleClientId, env.googleClientSecret)

    // Read the browser's *current* mc_session, if any — this is how a
    // Google login "upgrades" a user already active in this
    // browser. Read at callback time, not at /start time: a multi-tab
    // race (tab A starts login, tab B creates a fresh anonymous session
    // before A's redirect completes) can upgrade the "wrong" tab's
    // session — a session-confusion edge case, not a security issue
    // (only cookies already in this browser's own jar are ever read).
    const existingToken = getCookie(c, SESSION_COOKIE_NAME)
    const existingUserId = existingToken
      ? (verifySessionToken(existingToken, env.authSecret)?.userId ?? null)
      : null

    try {
      const { idToken } = await exchangeCodeForTokens(config, code)
      const { subject, email } = await verifyIdToken(config, idToken)
      const subjectHash = hashIdentitySubject(subject, env.identityHashKey)

      // The piece that actually survives account deletion: this identity
      // hash is recomputed fresh on every login attempt, so even a
      // banned account that was fully deleted (users row and everything
      // cascading from it) is still recognized here — account_bans is
      // deliberately never foreign-keyed to `users.id`. Checked before
      // resolveGoogleLogin ever runs, so a banned identity never creates
      // or links a new user row at all.
      const ban = await findBanByIdentityHash(env.db, GOOGLE_PROVIDER, subjectHash)
      if (ban) {
        deleteCookie(c, SESSION_COOKIE_NAME, { path: '/', domain: sessionCookieDomain(env.publicBaseUrl) })
        return loginErrorRedirect(c, env, 'account_banned')
      }

      // An established Google identity always wins over the active
      // anonymous session (see googleAuthService.ts) — if this identity is
      // already linked to a *different* user than whatever's active
      // in the browser, mc_session silently switches to it. Flagged, not
      // fixed, this pass — see the plan for why.
      const { userId, hasProfile } = await resolveGoogleLogin(
        {
          findUserIdByIdentity: () => findUserIdByIdentity(env.db, GOOGLE_PROVIDER, subjectHash),
          createUser: () => insertUser(env.db),
          linkIdentity: (id) => linkIdentity(env.db, id, GOOGLE_PROVIDER, subjectHash),
          // Existence-only, no decrypt — this is a routing decision
          // (/start vs /register), not a read of the profile data, so it must
          // never depend on KMS/Vault being reachable or on the right key
          // version being available. See userProfileExists's comment.
          hasProfile: (id) => userProfileExists(env.db, id),
          userExists: (id) => userExists(env.db, id),
        },
        existingUserId,
      )

      // Essential account-operation data (CHARTER.md §4's carved-out
      // exception) — kept in sync with Google on every login, not just
      // set once. Encrypted the same way as user_profiles.pii_ciphertext.
      const emailCiphertext = await encryptField(env.vault, email)
      await setEmail(env.db, userId, emailCiphertext)

      // One-time master-admin bootstrap — see adminBootstrapService.ts.
      // No-op if MASTER_USER_EMAIL is unset or already claimed by another
      // user.
      await bootstrapAdminIfMasterEmail(
        {
          isBootstrapCompleted: () => isAdminBootstrapCompleted(env.db),
          findRoleByName: (name) => findRoleByName(env.db, name),
          assignRole: (uid, roleId) => assignRoleToUser(env.db, uid, roleId),
          markBootstrapCompleted: () => markAdminBootstrapCompleted(env.db),
        },
        { userId, email, masterEmail: env.masterUserEmail },
      )

      const token = createSessionToken(userId, env.authSecret)
      c.header('set-cookie', buildSessionCookie(token, env.publicBaseUrl), { append: true })
      c.header('set-cookie', buildLegacySessionCookieClear(), { append: true })

      // Based on whether a profile actually exists, not on whether the
      // identity link is new — a user who linked Google but abandoned the
      // registration form must be sent back to it on their next login too.
      const destination = hasProfile ? '/start' : '/register?welcome=1'
      return c.redirect(`${env.publicBaseUrl}${destination}`, 302)
    } catch (err) {
      // Anything downstream of the code exchange — a bad/expired code, a
      // KMS/Vault hiccup decrypting an existing profile, a transient DB
      // error — must never surface as a raw framework error page. Log
      // server-side for debugging, send the browser back to a page it can
      // render.
      console.error('[OAUTH] google callback failed', err)
      const errorCode = err instanceof GoogleOAuthError ? 'google_failed' : 'login_failed'

      // Whatever mc_session the browser walked in with was implicated in
      // (or at least present for) a failed login — carrying it into the
      // retry risks the exact same failure on the next attempt. Clearing
      // it drops the browser back to a clean anonymous state so a retry
      // has a real chance of succeeding.
      deleteCookie(c, SESSION_COOKIE_NAME, { path: '/', domain: sessionCookieDomain(env.publicBaseUrl) })
      return loginErrorRedirect(c, env, errorCode)
    }
  })

  return app
}
