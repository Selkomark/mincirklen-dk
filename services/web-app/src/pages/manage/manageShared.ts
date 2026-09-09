// Small local postTrpc/getTrpc pair — this codebase has no central trpc
// client module, each area that needs one keeps its own copy (see
// pages/sessionShared.tsx, components/Table). Nested router paths (e.g.
// "rbac.roles.list") pass straight through as dot-separated tRPC paths.
export async function postTrpc<T>(path: string, input: unknown): Promise<T> {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(res.status === 403 ? 'forbidden' : 'error')
  const body = (await res.json()) as { result: { data: T } }
  return body.result.data
}

export async function getTrpc<T>(path: string, input: unknown): Promise<T> {
  const search = new URLSearchParams({ input: JSON.stringify(input) })
  const res = await fetch(`/api/trpc/${path}?${search.toString()}`)
  if (!res.ok) throw new Error(res.status === 403 ? 'forbidden' : 'error')
  const body = (await res.json()) as { result: { data: T } }
  return body.result.data
}
