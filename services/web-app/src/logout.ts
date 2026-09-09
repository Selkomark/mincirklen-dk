// Shared by SiteHeader.tsx's LogoutButton and SessionPage.tsx's account
// menu — both trigger the exact same backend call and recovery
// navigation, so the request itself lives in one place. Each call site
// still owns its own pending/error UI, per the async-action-buttons
// pattern — this only does the network call.
export async function logout(): Promise<void> {
  const res = await fetch('/api/trpc/auth.logout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!res.ok) throw new Error('Something went wrong logging out.')
}
