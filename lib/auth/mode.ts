/**
 * Whether the app runs without authentication.
 *
 * On with CORVA_DEMO=1, or on a fresh clone with no Clerk keys. When it is
 * on, Clerk is not in the request path at all — no provider, no proxy, no
 * session lookup. Everywhere else, including any deployment, sign-in is real.
 */
export const DEMO_MODE =
  process.env.CORVA_DEMO === "1" ||
  // Unset means demo only when there is no sign-in to use — a fresh clone
  // without Clerk keys. With keys (every deployment) it is real sign-in unless
  // someone asks for the demo in so many words: forgetting one variable must
  // never open a production console to the world.
  (process.env.CORVA_DEMO === undefined && !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/**
 * Whether Corva's own console opens without signing in.
 *
 * Separate from `DEMO_MODE` on purpose: the business console can run on real
 * Clerk logins while the operator console stays open for the team building
 * it. Open by default in development and closed in production — an operator
 * console anyone can reach can create and delete businesses — unless
 * `CORVA_OPERATOR_OPEN=1` says otherwise in so many words.
 */
export const OPERATOR_OPEN =
  DEMO_MODE ||
  process.env.CORVA_OPERATOR_OPEN === "1" ||
  (process.env.CORVA_OPERATOR_OPEN !== "0" && process.env.NODE_ENV !== "production");
