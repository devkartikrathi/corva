/**
 * List-screen state, held in the URL.
 *
 * Every filter, tab, sort and page on a list screen is a search parameter, for
 * three reasons the designs care about: a filtered table can be linked to and
 * shared, the back button undoes a filter, and a saved view is nothing more
 * than a stored copy of this object. There is no second, privileged path — a
 * saved view and a hand-typed address arrive at the same query.
 */

/** What Next hands a page. A repeated key arrives as an array. */
export type RawParams = Record<string, string | string[] | undefined>;

/** The normalised form: one value per key, empty keys dropped. */
export type Params = Record<string, string>;

export function normalise(raw: RawParams): Params {
  const out: Params = {};
  for (const [key, value] of Object.entries(raw)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v !== undefined && v !== "") out[key] = v;
  }
  return out;
}

/** `?a=1&b=2`, or `""` when there is nothing to say. */
export function toQuery(params: Params): string {
  const search = new URLSearchParams(
    // Sorted so the same filter set always produces the same URL, which keeps
    // saved-view comparison and cache keys stable.
    Object.entries(params).sort(([a], [b]) => a.localeCompare(b)),
  ).toString();
  return search ? `?${search}` : "";
}

/**
 * The href for this screen with one parameter changed.
 *
 * Passing `null` removes the key, which is how a chip toggles off. Changing
 * anything other than the page resets the page, because page 4 of a different
 * filter is not a place anyone meant to go.
 */
export function href(
  pathname: string,
  params: Params,
  changes: Record<string, string | null>,
): string {
  const next: Params = { ...params };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  if (!("page" in changes)) delete next.page;
  return `${pathname}${toQuery(next)}`;
}

/** The href that toggles a value on or off for one key. */
export function toggleHref(
  pathname: string,
  params: Params,
  key: string,
  value: string,
): string {
  return href(pathname, params, { [key]: params[key] === value ? null : value });
}

/**
 * The href for a multi-select filter, where the key holds a comma-separated
 * list. Used by the behaviour flags and channel filters, where two selections
 * are a legitimate question ("phone or WhatsApp").
 */
export function toggleManyHref(
  pathname: string,
  params: Params,
  key: string,
  value: string,
): string {
  const current = listOf(params, key);
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  return href(pathname, params, { [key]: next.length ? next.join(",") : null });
}

/** The values of a comma-separated multi-select key. */
export function listOf(params: Params, key: string): string[] {
  return params[key] ? params[key].split(",").filter(Boolean) : [];
}

/** A number parameter, clamped, falling back when it is absent or nonsense. */
export function intOf(params: Params, key: string, fallback: number, min = 0, max = 1e9): number {
  const n = Number(params[key]);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}


/**
 * Whether two query objects describe the same filter.
 *
 * `page` is ignored: paging through a saved view should not stop it reading as
 * the view you opened.
 */
export function sameQuery(a: Params, b: Params): boolean {
  const strip = (p: Params) => {
    const { page: _page, ...rest } = p;
    return toQuery(rest);
  };
  return strip(a) === strip(b);
}
