/**
 * Which brand the console is showing.
 *
 * Split from `context.ts` so the cookie name can be imported by a server
 * action without dragging the whole session module — and so the rule that a
 * cookie is only ever a *hint* has one place to live.
 */
export const BRAND_COOKIE = "corva_brand";

/**
 * Resolve the selected brand against what the membership may actually see.
 *
 * An unknown, stale or forged id falls back to the first visible brand rather
 * than erroring: the cookie expresses a preference, and a preference that can
 * no longer be honoured is not a failure.
 */
export function resolveBrand<T extends { id: string }>(visible: T[], cookieValue?: string): T {
  return visible.find((b) => b.id === cookieValue) ?? visible[0];
}
