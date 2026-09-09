# Pre-release scratch notes

This file lives in `tmp/` on purpose — anything under `tmp/` is scratch
space for a release branch's own working notes, and the
`check-temp-cleared` CI check (`.github/workflows/pr-temp-check.yml`)
fails the PR if anything other than `tmp/.gitkeep` is still here when it
targets `main`. Delete this file (or move whatever's worth keeping into a
real doc) before merging.

## Open from this cycle

- Go-live readiness audit (2026-09-08) — tracked in the private
  `mincirklen-core` repo's `PRELAUNCH_CHECKLIST.md`, not here (that repo
  isn't public; this one is).
- UX walkthrough (2026-09-09) — the join/create-circle flow is
  schedule-based, not on-demand; no post-session feedback loop exists yet
  even though the DB already reserves space for ratings. Worth its own
  product-side writeup before it's forgotten.
