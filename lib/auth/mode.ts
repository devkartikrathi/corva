/**
 * Whether the app runs without authentication.
 *
 * Demo mode is the default so the consoles open on a fresh clone. When it is
 * on, Clerk is not in the request path at all — no provider, no proxy, no
 * session lookup — which keeps the "no barriers" promise from depending on
 * Clerk being configured correctly.
 *
 * Set CORVA_DEMO=0 to require real authentication.
 */
export const DEMO_MODE = process.env.CORVA_DEMO !== "0";

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
