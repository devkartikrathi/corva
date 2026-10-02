/**
 * Whether the app runs without authentication.
 *
 * On with CORVA_DEMO=1, or on a fresh clone with no Clerk keys. When it is
 * on, Clerk is not in the request path at all — no provider, no proxy, no
 * session lookup. Everywhere else, including any deployment, sign-in is real.
 */
/** The live production deployment on Vercel (not a preview, not a laptop). */
export const PRODUCTION_DEPLOYMENT = process.env.VERCEL_ENV === "production";

export const DEMO_MODE =
  // Never on the live site, whatever the environment says: a stray
  // CORVA_DEMO=1 in the project settings once turned sign-in off for everyone.
  !PRODUCTION_DEPLOYMENT &&
  // Nor on any deployment at all: a preview build shares the real database,
  // and a preview with sign-in switched off is that database with no lock.
  !process.env.VERCEL &&
  (process.env.CORVA_DEMO === "1" ||
    // Unset means demo only when there is no sign-in to use — a fresh clone
    // without Clerk keys. With keys it is real sign-in unless someone asks
    // for the demo in so many words.
    (process.env.CORVA_DEMO === undefined && !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY));
