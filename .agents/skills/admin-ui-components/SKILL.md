---
name: admin-ui-components
description: Use before adding any form control, toggle, date/time input, badge, list, or interactive element to a /manage admin page (services/web-app/src/pages/manage/). Check the design-system component catalog (services/web-app/src/components/) for an existing component before reaching for a raw HTML element.
---

`/manage` is easy to treat as throwaway internal tooling and reach for a
bare `<input>`/`<select>`/`<button>` "just this once." Don't — every admin
tab shares the same design system as the rest of the app
(`services/web-app/src/components/`, browsable via the Catalog,
`bun run dev --mode catalog`), and a raw native control next to DS ones
reads as visibly broken, not just inconsistent. `RolesTab.tsx`,
`UsersTab.tsx`, and `ReviewQueueTab.tsx` are the reference
implementations — every one of them is built entirely from DS
components; treat any new tab that isn't as a bug to fix before moving on.

## Reference: what to reach for

| Need | Use | Not |
|---|---|---|
| Text input | `TextField` | bare `<input>` |
| Any date | `DatePicker` | `<input type="date">` |
| Any time | `TimePicker` | `<input type="time">` |
| Date + time together | `DatePicker` + `TimePicker` side by side | `<input type="datetime-local">` |
| Binary on/off toggle (a mode, a flag) | `Switch` | two `Button`s that swap labels |
| Multi-select from a fixed list | `Checkbox` per item | a multi-`<select>` |
| Single choice from a list | `Select` | bare `<select>` |
| Status/category pill | `Badge` | a colored `<span>` |
| Tabular data | `Table` | a hand-rolled CSS grid |
| A self-contained editable item (a role, a record) | `Card` wrapping its content | an unwrapped block |
| Inline error/success messaging | `Alert` | plain colored text |
| A pending async action | `Button`'s `isPending` (see `async-action-buttons` skill) | a separate spinner element |
| Icon-only control | `IconButton` | a `Button` with just an emoji/glyph child |

Plain `<div>` with an inline flex/gap style for pure layout (stacking
fields, a row of buttons) is fine and already the norm in every admin
tab — there's no DS layout component for that, and forcing `Row`/`Col`
(the responsive grid, meant for page-level marketing layout) onto a
compact admin form is a worse fit, not a better one.

## The DatePicker/TimePicker gotcha

Both take `@internationalized/date` values (`CalendarDate`, `Time`), not
a plain JS `Date` or ISO string. Converting between them is a few lines,
not a reason to fall back to a native input — `pages/start/StartNewPage.tsx`
is the reference:

```ts
import { CalendarDate, Time } from '@internationalized/date'

function combineToISOString(date: CalendarDate, time: Time): string {
  return new Date(date.year, date.month - 1, date.day, time.hour, time.minute).toISOString()
}

// The reverse, for seeding form state from an existing ISO string/Date:
function splitFromDate(d: Date): { date: CalendarDate; time: Time } {
  return {
    date: new CalendarDate(d.getFullYear(), d.getMonth() + 1, d.getDate()),
    time: new Time(d.getHours(), d.getMinutes()),
  }
}
```

## What's intentionally exempt

`ManagePage.tsx`'s sidebar navigation (the dark `SIDEBAR_BG` nav list) is
deliberately custom chrome, not a DS component — `Tabs` is a horizontal
tab-strip and `Menu` is a dropdown trigger, neither fits a persistent
vertical nav, so forcing one on would be a worse semantic match, not a
consistency win. Don't convert it.
