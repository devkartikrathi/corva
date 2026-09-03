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
