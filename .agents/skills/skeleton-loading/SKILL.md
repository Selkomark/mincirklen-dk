---
name: skeleton-loading
description: Use whenever a page or section fetches data before its first real render — a list, a card, a chip row. Applies to services/web-app; render Skeleton-built placeholders shaped like the eventual content instead of a spinner or "Loading..." text.
---

A spinner or a bare "Loading…" string tells the user something is
happening but nothing about what's about to appear, and the layout jumps
once real content lands. A skeleton shaped like the real content avoids
both problems.

## The pattern

Use `Skeleton` (`services/web-app/src/components/Skeleton`) to compose a
placeholder that mirrors the actual layout — same rough dimensions, same
count of rows/chips — not a single generic block:

```tsx
{loadingInitial &&
  Array.from({ length: 3 }, (_, i) => (
    <div key={i} style={{ border: '0.5px solid var(--border-subtle)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Skeleton width="60%" height={14} />
      <Skeleton width="40%" height={11} />
    </div>
  ))}
```

`StartJoinPage.tsx`'s circle-list-row skeleton and `StartNewPage.tsx`'s
topic-chip skeleton row are the reference implementations — each one
copies the real content's container styling so nothing visually shifts
when the fetch resolves and skeletons are swapped for real rows.

## Where this doesn't apply

- A short-lived pending state on a button click (create/join/submit) is
  the `async-action-buttons` skill's job (`Button`'s `isPending` +
  `Spinner`), not a skeleton — skeletons are for content that hasn't
  rendered yet at all, not for re-affirming an in-flight action.
- Loading a *second* page of an already-visible list (infinite scroll)
  can use a lighter-weight version of the same row skeleton appended
  below existing content — still shaped like a row, not a generic
  spinner — see `StartJoinPage.tsx`'s `loadingMore` state.
