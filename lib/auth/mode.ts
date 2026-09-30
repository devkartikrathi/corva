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
  (process.env.CORVA_DEMO === "1" ||
    // Unset means demo only when there is no sign-in to use — a fresh clone
    // without Clerk keys. With keys it is real sign-in unless someone asks
    // for the demo in so many words.
    (process.env.CORVA_DEMO === undefined && !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY));

/**
 * Whether Corva's own console exists at all here.
 *
 * It does not on any Vercel deployment. Onboarding businesses, test calls and
 * everything else under /operator run on the Corva team's own machines, against
 * the same database — a public address for "create a business, delete a
 * business" is a door nobody needs. On Vercel, /operator is simply not found.
 */
export const OPERATOR_AVAILABLE = !process.env.VERCEL;

/**
 * Whether that console opens without signing in, where it exists.
 *
 * Open in development (`npm run dev` on a team machine). A local production
 * build (`next start`) needs `CORVA_OPERATOR_OPEN=1` to open it.
 */
export const OPERATOR_OPEN =
  OPERATOR_AVAILABLE &&
  (DEMO_MODE ||
    process.env.CORVA_OPERATOR_OPEN === "1" ||
    (process.env.CORVA_OPERATOR_OPEN !== "0" && process.env.NODE_ENV !== "production"));
