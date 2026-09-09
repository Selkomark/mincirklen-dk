---
name: dry-check
description: Check before writing JSX/markup in the web-app whether it duplicates an existing shared component. Use before adding a header, footer, card, or any repeated block of markup to a page in services/web-app/src.
---

Before writing JSX that repeats markup already used on another page (a header, footer, card, badge row, etc.) in `services/web-app/src`, check `services/web-app/src/` for an existing component first. Reuse it.

If you're about to write the same block of markup in a second file, stop and extract it into a shared component instead — don't let a second copy land.

Shared page-level components live at `services/web-app/src/` root, next to `App.tsx`:
- `SiteHeader.tsx` — the marketing/app Navbar (logo, About/Safety links, optional "Join now" CTA via `showJoinCta`, theme toggle). Used by app-flow pages: `LandingPage.tsx`, `pages/NewSessionPage.tsx`.
- `PublicHeader.tsx` — the simpler header for standalone content pages (logo linking home + theme toggle, no nav links). Used by `publicPages/PublicPageView.tsx` and `pages/ModerationTransparencyPage.tsx`. Distinct from `SiteHeader` on purpose — don't merge them.
- `SiteFooter.tsx` — the four-column footer linking every public page. Used by every full-page view: `LandingPage.tsx`, `publicPages/PublicPageView.tsx`, `pages/NewSessionPage.tsx`, `pages/LoginPage.tsx`, `pages/RegisterPage.tsx`, `pages/ModerationTransparencyPage.tsx`.
- `LinkButton.tsx` — an anchor styled as a DS `Button` (the real `Button` renders `<button>`, which has no `href`).
- `ThemeToggle.tsx` — the dark/light toggle used in every page header.
