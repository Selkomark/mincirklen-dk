import { OAuth2Client } from 'google-auth-library'

// The one place this service pulls in a real GCP client library rather
// than following adapters/kmsAdapter.ts's (trpc-api) raw-fetch
// convention — deliberately. Verifying an inbound signed token correctly
// (RS256 signature, issuer, audience, expiry, key rotation via Google's
// JWKS) is genuinely security-critical and easy to get subtly wrong by
// hand; unlike kmsAdapter.ts's simple "call an API with a bearer token"
// problem, this is the harder direction (verifying a token someone else
// signed), so it uses the well-vetted library Google's own Pub/Sub push
// documentation recommends instead.
export class PushAuthError extends Error {
  constructor(message: string) {
    super(message)
  }
}

// 'none' is local-dev only — the Pub/Sub emulator (docker-compose.yml's
// `pubsub` service) can't issue real signed OIDC tokens, so there's
// nothing to verify against it. 'oidc' is required in production; the
// audience must match whatever the real push subscription is configured
// to mint tokens for (this service's own push endpoint URL).
export type PushAuthConfig = { mode: 'none' } | { mode: 'oidc'; audience: string }

const client = new OAuth2Client()

// Throws on any failure — missing header, bad signature, wrong
// audience, expired token. Never resolves for an invalid request; there
// is no "probably fine" path here, same fail-closed posture as the rest
// of this codebase's auth checks.
export async function verifyPushRequest(config: PushAuthConfig, authorizationHeader: string | null): Promise<void> {
  if (config.mode === 'none') return

  if (!authorizationHeader?.startsWith('Bearer ')) {
    throw new PushAuthError('missing bearer token')
  }
  const token = authorizationHeader.slice('Bearer '.length)

  const ticket = await client.verifyIdToken({ idToken: token, audience: config.audience })
  if (!ticket.getPayload()) {
    throw new PushAuthError('token verified but carried no payload')
  }
}
