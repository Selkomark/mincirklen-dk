---
name: regex-perf
description: Use before writing or reviewing a chain of sequential if/else branches, a route/string parser, or a loop body that runs a regex (or other non-trivial string op like a repeated split/normalize) against the same value more than once. Compute it once and reuse the result instead of re-running it per branch or per iteration.
---

Re-running the same regex against the same input on every branch of a
condition chain is wasted work that scales with the number of branches —
the last branch checked has paid for every regex execution before it,
even when only one result was ever needed.

## The pattern to catch

```ts
// Bad: re-runs the same regex up to N times for N branches, even though
// the input never changes between checks.
if (path.replace(/\/$/, '') === 'a') return A
if (path.replace(/\/$/, '') === 'b') return B
if (path.replace(/\/$/, '') === 'c') return C
```

```ts
// Good: normalize once, compare the plain value from then on.
const normalized = path.endsWith('/') ? path.slice(0, -1) : path
if (normalized === 'a') return A
if (normalized === 'b') return B
if (normalized === 'c') return C
```

This is exactly the bug fixed in `services/web-app/src/App.tsx`'s
`parseRoute` — it called `rest.replace(/\/$/, '')` fresh on every one of
seven route candidates. Also note the replacement doesn't even need a
regex: `path.endsWith('/') ? path.slice(0, -1) : path` does the same
trailing-slash strip without compiling a pattern at all — reach for the
plain string method first, and only use a regex when the operation
genuinely needs pattern matching (character classes, alternation,
capture groups).

## Where else this shows up

- **Loops**: a regex literal or `.match()`/`.test()` call inside
  `.map()`/`.filter()`/`for` that only depends on loop-invariant state —
  hoist it above the loop.
- **Repeated derived values in general**: the same principle applies to
  any non-trivial recomputation (parsing, splitting, normalizing casing)
  done redundantly across branches on an unchanged input, not just
  regex — regex is just the easiest case to miss because each call site
  looks cheap in isolation.

## What NOT to flag

- A short-circuiting chain where only one branch's regex ever actually
  runs per call (e.g. `if (x) {...} else if (regexTest(y)) {...}`) isn't
  the problem — the issue is specifically re-deriving the *same*
  normalized value repeatedly for comparisons against *different*
  literals.
- Two different regexes each doing genuinely different work on the same
  string (e.g. a slugify helper's `.replace(/[^a-z0-9]+/g, '-')` followed
  by `.replace(/(^-|-$)/g, '')`) is normal sequential transformation, not
  redundant recomputation — don't merge those into one pass just to avoid
  two regex calls.
