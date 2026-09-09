---
name: pre-release-docs
description: Use before opening or merging a pre-release PR to main (e.g. from feature/pre-release, or any branch a launch/version milestone is cut from). Checks that documentation actually reflects what's shipping, and that no scratch/temp content rides along into main.
---

A pre-release merge is the last checkpoint before something is live. Docs
drift fastest right here — code changes get reviewed, the doc that was
supposed to change alongside it often doesn't. Work through this before
opening the PR, not after review comments point it out.

## 1. `tmp/` must be empty before merge

Anything under `tmp/` is scratch space for a release branch's own working
notes — never content meant to survive into `main`. `tmp/.gitkeep` is the
only file allowed to remain; everything else must either be deleted or
promoted into a real doc first (see below for where it likely belongs).

This is enforced, not just convention: `.github/workflows/pr-temp-check.yml`
runs `check-temp-cleared` as a required status check on `main` (see
`SECURITY.md`'s branch protection section) — a PR with anything else under
`tmp/` fails CI and can't merge through the normal path.

## 2. Cross-check every doc this release actually touches

- **`README.md`**'s Documentation index — if anything under `docs/` was
  added, renamed, or removed this cycle, see `.agents/skills/docs-index`.
- **`SECURITY.md`** — if this release touched CI, branch protection, a new
  dependency/Action source, or secrets posture, see
  `.agents/skills/security-guard` and update it in the same PR, not after.
- **`docs/tech_spec.md`** — its own header carries a document version and
  date. If the shipped architecture no longer matches what it describes
  (a new component, a changed scaling model, a cost assumption that's now
  wrong), update the relevant section and bump the version/date — don't
  let it silently go stale the way the NATS/websocket-service deployment
  gap did.
- **`docs/roadmap.md`** — if this release resolves something listed under
  an "Open Questions" / "Open Risks" section, or under one of the dated
  Appendices, add a new dated Addendum entry recording the resolution
  (matching the existing `Addendum — <title> (<date>)` convention) rather
  than quietly editing the original text.
- **`CHARTER.md`** — confirm nothing shipping this release conflicts with
  a non-negotiable principle. If a real judgment call was made and
  accepted, log it in `PROMISING_IDEAS.md` or `REJECTED_IDEAS.md` per that
  existing convention, with the reasoning — don't let the decision live
  only in a PR discussion that gets auto-deleted when the branch merges.
- **`docs/gdpr-runbook.md`** — update if this release changes what data is
  collected, retained, or deletable.
- **Public-facing copy** (`services/web-app/src/publicPages/`, the locale
  files under `services/web-app/src/locales/*`) — read it against what's
  actually shipping. Don't let marketing copy promise a feature, safety
  guarantee, or pricing detail that isn't true yet.

## 3. Cross-repo docs this PR can't fix directly

If this release resolves or changes something tracked in the private
`mincirklen-core` repo's `PRELAUNCH_CHECKLIST.md`, or in
`MinCirklen-Moderation-Engine`'s own docs, this PR can't edit those (wrong
repo) — but note it in the PR description so it doesn't get forgotten
once this one merges.
