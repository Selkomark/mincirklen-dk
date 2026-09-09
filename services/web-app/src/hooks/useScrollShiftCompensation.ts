import { useLayoutEffect, useRef, type RefObject } from 'react'

// Shared by any scrollable, windowed list that can grow *above* the
// viewport (a prepend from loading older content, or an eviction at the
// top of a capped window) — without this, that kind of change visibly
// yanks the scroll position, since the browser doesn't know to hold the
// user's place when content shifts above what they're looking at.
//
// Usage: call `snapshotBeforeShift()` right before triggering a fetch that
// might change content above the viewport, then bump `shiftVersion` once
// that change has actually landed in the DOM (never for a plain bottom
// append — only changes above the viewport need compensating). First used
// by pages/start/shared.tsx's useOpenSessions + StartJoinPage.tsx's
// windowed browse list; reused as-is for SessionPage.tsx's
// scroll-up-for-older-messages pagination.
export function useScrollShiftCompensation(containerRef: RefObject<HTMLElement | null>, shiftVersion: number) {
  // Snapshotted right before a load that might affect content above the
  // viewport — compared against the post-update scrollHeight in the
  // layout effect below to compensate scrollTop so the change doesn't
  // visibly jump it.
  const preShiftScrollHeightRef = useRef<number | null>(null)

  function snapshotBeforeShift() {
    preShiftScrollHeightRef.current = containerRef.current?.scrollHeight ?? null
  }

  // Runs after the DOM has the new/evicted rows but before paint —
  // exactly the window to measure the height change and cancel it out.
  useLayoutEffect(() => {
    const before = preShiftScrollHeightRef.current
    const container = containerRef.current
    if (before == null || !container) return
    container.scrollTop += container.scrollHeight - before
    preShiftScrollHeightRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed only on the version bump, not on scroll state or containerRef
  }, [shiftVersion])

  return { snapshotBeforeShift }
}
