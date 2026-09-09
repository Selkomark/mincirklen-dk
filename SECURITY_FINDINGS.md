# Security review findings (for follow-up)

Review date: 2026-08-26. Scope: `services/trpc-api`, `services/websocket-service`,
`services/moderation-service`, `services/web-app`, `packages/shared`, and the
local infra (`docker-compose.yml`, `local-infra/caddy/Caddyfile`).

This is a **reference for a follow-up model/engineer to fix** — nothing here has
been changed. It complements, and does not replace, `SECURITY.md` (which
documents the *intended* repo/CI security posture). Items are ranked by
severity. Each says where it is, why it matters for this specific product
(an anonymous, emotionally-vulnerable user base per `CHARTER.md` / `docs/roadmap.md`
§4.1), and a suggested direction — not a prescribed patch.

Confidence tags: **[confirmed]** = verified in the code this pass;
**[verify]** = strong suspicion, confirm the runtime behavior before fixing.

---

## HIGH

### H1. No rate limiting anywhere on the public API [confirmed]
- **Where:** `services/trpc-api/src/controllers/authRouter.ts`
  (`createAnonymousSession` is `publicProcedure`), `oauthController.ts`
  (`/auth/google/start`, `/auth/callback/google`), `sessionRouter.ts`
  (`sendMessage`). Redis is wired into `AppEnv` (`context.ts`, `index.ts`) but
  used **only** for health checks (`healthService.ts`) — never for throttling.
- **What:** `createAnonymousSession` mints a fresh signed session with zero
  friction and no limit; every other endpoint is likewise uncapped. A script
  can create unlimited sessions, hammer the OAuth callback, or flood
  `sendMessage`.
- **Why it matters:** directly undermines the "real, traceable users" goal — a
  bot can mint identities faster than moderation can act. `docs/roadmap.md` §4.1
  explicitly calls for rate-limiting/shadow-throttling; `TODO.md` scopes a
  CAPTCHA to *register/profile-completion only*, which misses the actual
  zero-friction door (`createAnonymousSession` and the message pipeline).
- **Direction:** per-IP + per-session rate limits (Redis is already available),
  and widen the CAPTCHA/Turnstile plan to cover session creation and first
  message, not just the profile step. Consider a cost/slow-down on
  `createAnonymousSession` specifically.

### H2. Message body length is unbounded [confirmed]
- **Where:** `services/trpc-api/src/controllers/sessionRouter.ts` —
  `sendMessage` input is `sessionIdInput.extend({ body: z.string().min(1) })`.
  No `.max(...)`.
- **What:** a client can send an arbitrarily large `body`. It is persisted
  (`messages.body` is `text`), sent to the moderation service, and fanned out
  over NATS to every member of the room.
- **Why it matters:** single-request DoS / resource-exhaustion vector —
  unbounded DB growth, an oversized payload to the (future real) moderation
  model, and amplified fan-out to all room participants.
- **Direction:** add a `.max(N)` matching the product's real message-length cap;
  enforce the same cap wherever a message can enter the system.

---

## MEDIUM

### M1. No session revocation / logout; long-lived stateless token [confirmed]
- **Where:** `packages/shared/src/auth/sessionToken.ts` (180-day HMAC token,
  `DEFAULT_MAX_AGE_SECONDS`), `services/trpc-api/src/context.ts`
  (`SESSION_COOKIE_MAX_AGE_SECONDS` 180 days; also accepts the token as a
  `Bearer` header via `bearerToken()`). No logout route anywhere
  (`grep logout` → none).
- **What:** the session token is a stateless HMAC valid for 180 days with no
  server-side revocation list. The only way to invalidate a session is to
  delete the `users` row (which makes `touchUser` return false →
  `resolveSession` returns null). There is no per-session logout, and the same
  token works as an `Authorization: Bearer` header (outside cookie
  `HttpOnly`/`SameSite` protections if it leaks).
- **Why it matters:** for a safety-critical platform where the operator may need
  to *forcibly* terminate a specific person's access (predatory behavior,
  compromised account), the absence of a revocation mechanism is a real gap. A
  leaked cookie/token is usable for up to 180 days.
- **Direction:** add a logout endpoint that clears the cookie; add a
  server-side revocation mechanism (token version/`session_id` claim checked
  against a store, or a per-user `token_epoch` bumped on revoke) so a session
  can be killed without deleting the account. Reconsider the 180-day lifetime.

### M2. WebSocket layer has no equivalent of `verifiedProcedure` [confirmed]
- **Where:** `services/websocket-service/src/controllers/wsController.ts`
  (`createWsGuard`) authorizes on `isSessionMember` **only**; there is no check
  that the user is Google-linked + profiled, nor that the `users` row still
  exists.
- **What:** the tRPC side was just hardened so only fully-verified users can
  create/join/read/send (`controllers/trpc.ts` `verifiedProcedure`). The WS
  service was not given a parallel gate.
- **Why it matters:** currently *mostly* mitigated — you can only become a
  session member by calling the now-verified `session.join` — so an unverified
  session can't subscribe today. But it's fail-by-coincidence, not
  defense-in-depth: if verification is ever revoked (identity/profile removed,
  account deleted) the member keeps live message delivery, and the WS guard
  never re-checks user existence/verification.
- **Direction:** mirror the verification check in the WS guard (share the
  `verificationService` logic via `packages/shared` or a service call), and
  confirm the user still exists on connect.

### M3. tRPC error responses leak internal stack traces / file paths [confirmed]
- **Where:** `services/trpc-api/src/controllers/trpc.ts` —
  `initTRPC.context<AppContext>().create()` with **no** `errorFormatter`. Dev
  Dockerfiles don't set `NODE_ENV` (`services/*/dev.Dockerfile`); only
  `prod.Dockerfile` sets `NODE_ENV=production`.
- **What:** an observed 401 response earlier in development included a full
  stack trace exposing absolute container paths and internal call structure
  (`"stack":"TRPCError: UNAUTHORIZED\n at .../controllers/trpc.ts:11 ..."`).
  tRPC suppresses the stack only when `NODE_ENV === 'production'`, so this
  relies entirely on that env var being set correctly in every deployed
  environment.
- **Why it matters:** leaks internal structure to any caller in any non-prod
  (or misconfigured) deployment — useful reconnaissance. No defense-in-depth if
  `NODE_ENV` drifts.
- **Direction:** add an explicit `errorFormatter` that strips `stack` and other
  internals regardless of environment; confirm `NODE_ENV=production` actually
  flows through the prod runtime.

### M4. WebSocket `ALLOWED_ORIGINS` is fail-open and unset in compose [confirmed]
- **Where:** `services/websocket-service/src/context.ts` — `isAllowedOrigin`
  returns `true` for **all** origins when `allowedOrigins` is empty;
  `docker-compose.yml`'s `websocket-service` sets no `ALLOWED_ORIGINS`, so the
  list is empty.
- **What:** origin checking is effectively disabled by default; the code comment
  acknowledges it leans on `SameSite=Lax` on `mc_session` as the real barrier.
- **Why it matters:** an empty allowlist is fail-*open*. In production this must
  be an explicit allowlist; shipping the empty default there would remove a
  layer of cross-site WebSocket protection.
- **Direction:** require an explicit `ALLOWED_ORIGINS` in production (fail closed
  if unset in prod), and set it in any non-local environment config.

### M5. No security response headers (clickjacking / weak XSS containment) [confirmed]
- **Where:** `local-infra/caddy/Caddyfile` (dev) sets no headers; the web-app
  serves no CSP / `X-Frame-Options` / `frame-ancestors` / `X-Content-Type-Options`
  / `Referrer-Policy`. Prod terminates at the cloud LB (not fully in this repo)
  — confirm there too.
- **What:** authenticated pages that show PII (the register/profile form) and
  live chat can be framed by any site (clickjacking), and there is no CSP to
  contain a future XSS.
- **Why it matters:** clickjacking against a vulnerable user base (tricking a
  logged-in user into actions), and no second line of defense if any XSS is
  ever introduced. Note: React's default escaping is in use and no
  `dangerouslySetInnerHTML`/`innerHTML`/`eval` was found in `web-app` — so this
  is containment/hardening, not an active XSS.
- **Direction:** add `Content-Security-Policy`, `X-Frame-Options: DENY` (or CSP
  `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, and a
  `Referrer-Policy` at the edge (Caddy dev + prod LB).

---

## LOW / HARDENING

### L1. OAuth: no PKCE, no `nonce` [confirmed]
- **Where:** `services/trpc-api/src/adapters/googleOAuthAdapter.ts` —
  `buildAuthorizationUrl` sets `state` (CSRF ✓) but no `nonce` and no PKCE
  `code_challenge`; `verifyIdToken` validates `iss`/`aud`/`exp`/`sub` but not a
  `nonce`.
- **Why it matters:** `state` covers CSRF for the auth-code flow, and this is a
  confidential client (has `client_secret`), which lowers PKCE urgency — but
  `nonce` (binds the id_token to this login) and PKCE are recommended
  defense-in-depth against code interception / token replay.
- **Direction:** add a `nonce` (stored like `state`, validated in
  `verifyIdToken`) and consider PKCE.

### L2. Identifiers logged to stdout [confirmed]
- **Where:** `sessionRouter.ts` / `crisisEscalationService.ts`
  (`console.error('[ESCALATION] crisis flagged', { sessionId, userId })`),
  `moderation-service/src/index.ts` (logs `sessionId`).
- **Why it matters:** `userId`/`sessionId` are PII-adjacent; ensure log
  retention and access are controlled, especially for the crisis path.
- **Direction:** confirm log access controls; consider redacting/segregating
  crisis-path logs.

### L3. Multi-tab identity-swap / session-confusion [confirmed — already known]
- **Where:** documented in comments in `oauthController.ts` and
  `googleAuthService.ts` as a deliberately-deferred edge case (an established
  Google identity silently switches `mc_session` to a different user in a
  multi-tab race). No cross-user data is exposed.
- **Why it matters:** listed for completeness so the fixer knows it's a
  conscious deferral, not an oversight — revisit if the threat model tightens.

### L4. Dev-only secrets must never reach a shared/prod environment [confirmed — checklist]
- **Where:** `docker-compose.yml` hardcodes `AUTH_SECRET`,
  `IDENTITY_HASH_KEY`, and the Vault dev root token (`VAULT_TOKEN`) as
  `dev-only-not-for-production*`. This is by design for local dev and is
  documented, but there is no guard preventing these placeholder values from
  being used in a deployed environment.
- **Direction:** ensure prod pulls all of these from Secret Manager / real KMS
  (per `SECURITY.md`), and consider a boot-time refusal if a known dev
  placeholder value is detected outside local dev.

---

## Controls already in place (context for the fixer — do not regress)

- Session token: HMAC-SHA256 with **timing-safe** comparison and expiry
  (`packages/shared/src/auth/sessionToken.ts`).
- Layered auth gates on tRPC: `protectedProcedure` → `googleLinkedProcedure`
  → `verifiedProcedure`; all of `session.*` requires full verification
  (`controllers/trpc.ts`, `sessionRouter.ts`).
- OAuth subject stored as **keyed HMAC** (`auth/identityHash.ts`), key separated
  from `AUTH_SECRET`.
- `user_profiles` PII encrypted via KMS/Vault before storage
  (`repositories/userProfileRepository.ts`, `adapters/kmsAdapter.ts`).
- One-identity-per-account enforced by the unique index on
  `(provider, provider_subject_hash)`.
- OAuth `state` CSRF protection; `id_token` verified locally against JWKS with
  `iss`/`aud`/`exp` checks.
- DB access is exclusively parameterized Kysely — no raw string-interpolated SQL
  found; `sessionId` inputs validated as `z.string().uuid()`.
- Frontend: React default escaping; no `dangerouslySetInnerHTML` / `innerHTML` /
  `eval` in `services/web-app/src`.
- Schema isolation (`dev`/`test`, never `public`); secrets gitignored (`.env`
  untracked, confirmed).
