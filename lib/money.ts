/**
 * Money.
 *
 * Corva runs in India, so every figure a person reads — a goodwill ceiling, a
 * plan price, a lifetime value, what a conversation cost to serve — is rupees.
 *
 * Stored as an integer number of **paise**, never as a float of rupees, because
 * money in floating point eventually embarrasses you. Column names say so
 * (`ltv_paise`, `ceiling_paise`), and nothing outside this file decides how a
 * rupee figure is punctuated.
 *
 * Indian grouping is not the western one: ₹12,49,500, not ₹1,249,500. That is
 * what `en-IN` does, and it is the whole reason this is a function rather than
 * a template string at each call site.
 */

/** Rupees → paise. The seed and any hand-written amount go through this. */
export const rupees = (amount: number) => Math.round(amount * 100);

/** Paise → rupees, as a number. For arithmetic, not for printing. */
export const toRupees = (paise: number) => paise / 100;

/**
 * "₹12,49,500" — the default, because whole rupees are what people say out
 * loud and a trailing ".00" on a lifetime value is noise.
 *
 * Pass `decimals: true` for figures where the paise matter (unit costs), or
 * `decimals: "auto"` to show them only when they are not zero.
 */
export function formatRupees(
  paise: number,
  { decimals = false }: { decimals?: boolean | "auto" } = {},
): string {
  const showDecimals = decimals === "auto" ? paise % 100 !== 0 : decimals;
  return `₹${toRupees(paise).toLocaleString("en-IN", {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  })}`;
}

/**
 * Big money, shortened the way Indian businesses actually write it: thousands
 * stay thousands, then lakh, then crore. Used where a column is too narrow for
 * ₹1,88,40,000 and the exact digits are not the point.
 */
export function formatRupeesShort(paise: number): string {
  const value = toRupees(paise);
  const abs = Math.abs(value);
  if (abs >= 1e7) return `₹${trim(value / 1e7)}Cr`;
  if (abs >= 1e5) return `₹${trim(value / 1e5)}L`;
  if (abs >= 1e3) return `₹${trim(value / 1e3)}K`;
  return formatRupees(paise);
}

/** One decimal, but not a pointless ".0". */
const trim = (n: number) => {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

/**
 * What one conversation cost to serve.
 *
 * Sub-rupee amounts are the normal case — a contained AI conversation is a few
 * rupees — so this keeps two decimals until the figure is large enough that
 * they stop meaning anything.
 */
export function formatCost(paise: number): string {
  if (paise >= 10_000) return formatRupees(paise);
  return `₹${toRupees(paise).toFixed(2)}`;
}
