---
name: i18n-coverage
description: Use whenever adding or changing any user-facing or crawler-facing text in services/web-app — labels, buttons, errors, toasts, aria-labels, alt text, placeholders, document titles, meta tags. Ensures new text ships translated into all 5 supported languages, not silently left hardcoded in English.
---

The platform is translated into English, Swedish, Danish, Norwegian
(`nb`), and Finnish via `react-i18next`. A hardcoded string doesn't fail
loudly — it just quietly shows English inside an otherwise-translated
page, in whichever of the 5 languages the visitor picked. There's no
build-time check that catches this, so it only ever surfaces from actual
QA in a non-English language.

## The pattern

1. **Locale files**: `src/locales/<lng>/<namespace>.json` for `lng` in
   `en`, `sv`, `da`, `nb`, `fi`. Namespaces mirror the app's surfaces:
   `common` (shared chrome — nav, buttons, generic errors/toasts),
   `landing`, `auth`, `start`, `session`, `moderation`, `errors`. Add a
   new key to **all 5 files together in the same change**, never just
   `en` — a stub-then-translate-later split is how gaps happen.
2. In a component: `const { t } = useTranslation('<namespace>')`, then
   `t('some.key')`. In a plain (non-hook) helper function called from a
   component's render — see `formatDuration`/`describeTiming` in
   `pages/start/shared.tsx` and `statusSubtitle`/`formatScheduledAt` in
   `SessionPage.tsx` — thread a `t: TFunction<'namespace'>` parameter
   through instead of hardcoding, importing the type via
   `import type { TFunction } from 'i18next'`.
3. **Every dropdown uses the design system's `Select`/`SelectItem`**
   (`components/Select`), never a native `<select>` — a native select
   renders the OS's own chrome, inconsistent with the rest of the app.
   `LanguageSwitcher.tsx` and the filter panel in `StartJoinPage.tsx` are
   reference implementations, including the `textValue` vs `children`
   trick (`SelectItem`'s `textValue` prop controls what the closed
   trigger shows; `children` controls the open list — use this whenever
   an option needs a longer/richer label in the list than makes sense in
   the collapsed trigger, e.g. the timezone picker's UTC-offset list).
4. Pluralization: use i18next's `key_one`/`key_other` suffixes (e.g.
   `"userCount_one": "{{count}} user"`, `"userCount_other": "{{count}}
   users"`) and call `t('userCount', { count })` — don't hand-roll
   `count === 1 ? '' : 's'` string concatenation.

## Easy to miss — not "content", but still hardcoded English if you don't check

- **`useDocumentTitle(...)`** — the browser tab title. It's easy to
  translate the page body and forget this; grep for
  `useDocumentTitle\(['"]` to find a literal instead of a `t(...)` call.
- **`usePageMeta(...)`** (`<title>`, meta description, OG/Twitter tags)
  and **`useJsonLd(...)`** — translate these on any page whose *body* is
  translated (e.g. `LandingPage.tsx`). Leave them English on pages whose
  body is deliberately untranslated (see below) — a translated meta
  description over an English body is more inconsistent than a fully
  English page.
- **`alt="..."` on images** and **`aria-label="..."`** on icon-only
  buttons/controls — invisible to a sighted user skimming the page, but
  real content for a screen reader in the visitor's own language.
- **`placeholder="..."`** on inputs — visually present but easy to miss
  since it's not "real" rendered text in a review pass.
- **Toast messages and thrown `Error` messages that reach the user** —
  anything passed to `addToast(...)` or surfaced via a caught error's
  `.message` into an `<Alert>`. Sentinel strings compared with `===`
  (e.g. `'not_found'`, `'full'`, the internal `'error'` fallback in
  `sessionShared.tsx`'s fetch helpers) are *not* user-facing and should
  stay as plain string literals — only translate the string that
  actually reaches a person.
- **Shared `components/` used by both the real app and the Catalog
  design-system doc site** (`Button`, `DatePicker`, `Toast`, `Spinner`,
  etc.) — the Catalog build never imports `src/i18n.ts`, so calling
  `useTranslation()` inside a shared component risks breaking the
  Catalog's build/rendering. Instead, add an optional prop with an
  English default (e.g. `DatePicker`'s `openCalendarLabel`,
  `ToastRegionRoot`'s `dismissLabel`) and pass the translated string in
  from the real app's call site only. Catalog keeps the English default;
  it doesn't need translating.

## What's deliberately excluded

The 11 long-form pages in `src/publicPages/pages.ts` (privacy policy,
terms, community guidelines, etc.) and `ModerationTransparencyPage.tsx`
stay English-only on purpose — legal/safety-claim prose carries real
liability if machine-translated, so it's pending human/professional
translation rather than a `t()` pass. Don't "complete" these without
being asked; a scaffold for them already exists in the `publicPages`
namespace.

## Checking your work

After adding a surface, grep the file you touched for leftover literals
before considering it done:
```
grep -nE '"[A-Z][a-z]+ [a-z]|aria-label="[A-Za-z]|placeholder="[A-Za-z]|alt="[A-Za-z]' path/to/File.tsx
```
Then actually switch languages and click through the surface once live
(Account modal → Preferences → Language, or the header `LanguageSwitcher`
on public pages) — a missing key silently renders as the raw key string
(e.g. `session:panel.toggleMenu`), which is easy to spot visually but
invisible in a code-only review.
