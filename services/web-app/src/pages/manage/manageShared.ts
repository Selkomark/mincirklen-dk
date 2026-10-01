import { redirectToAdminLoginForExpiredSession } from './sessionExpiry'

// Small local postTrpc/getTrpc pair — this codebase has no central trpc
// client module, each area that needs one keeps its own copy (see
// pages/sessionShared.tsx, components/Table). Nested router paths (e.g.
// "rbac.roles.list") pass straight through as dot-separated tRPC paths.
//
// A 401 here means the session was valid enough to reach this page but
// has since gone stale — most commonly a role's idle-session policy
// (sessionPolicyService.ts) expiring mid-use, since every /manage role
// goes through here. There's no way (and no need) to distinguish that
// from the other causes of a 401 (banned, deroled) — all of them should
// redirect the same way, so this checks ahead of the existing 403
// handling rather than trying to special-case idle expiry specifically.
function handleUnauthorized(status: number): void {
  if (status === 401) redirectToAdminLoginForExpiredSession()
}

export async function postTrpc<T>(path: string, input: unknown): Promise<T> {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    handleUnauthorized(res.status)
    throw new Error(res.status === 403 ? 'forbidden' : 'error')
  }
  const body = (await res.json()) as { result: { data: T } }
  return body.result.data
}

export async function getTrpc<T>(path: string, input: unknown): Promise<T> {
  const search = new URLSearchParams({ input: JSON.stringify(input) })
  const res = await fetch(`/api/trpc/${path}?${search.toString()}`)
  if (!res.ok) {
    handleUnauthorized(res.status)
    throw new Error(res.status === 403 ? 'forbidden' : 'error')
  }
  const body = (await res.json()) as { result: { data: T } }
  return body.result.data
}
