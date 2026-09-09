// Single source of truth for the deployed origin — no trailing slash, no base path.
// Every route path (from landingPath()/publicPagePath()/etc.) already includes Vite's
// base ("/MinCirklen.dk/" in production), so callers do `${SITE_ORIGIN}${path}`.
// Update this the day a custom domain (mincirklen.dk) goes live.
export const SITE_ORIGIN = 'https://selkomark.github.io'
export const SITE_NAME = 'MinCirklen'
